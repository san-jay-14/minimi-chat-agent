import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { runAgent } from "./agent/loop.js";
import { buildBrief } from "./context/brief.js";
import { nowLine, resolveTz } from "./context/clock.js";
import type { Memory } from "./context/memory.js";
import { createProvider } from "./search/provider.js";
import type { SearchProvider } from "./search/types.js";

const when = z.iso.datetime({ offset: true });

const Body = z.object({
  user_id: z.string().min(1).max(100).default("anon"),
  session_id: z.string().min(1).max(100).default("default"),
  message: z.string().trim().min(1).max(4000),
  client_time: when.optional(),
  tz: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string(), at: when.optional() }))
    .max(200)
    .optional(),
});

export interface Deps {
  memory: Memory;
  run?: typeof runAgent;
  search?: () => SearchProvider;
}

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
// serveStatic wants a path relative to the working directory.
const publicRoot = relative(process.cwd(), publicDir) || ".";

// Browser copies of the two UI libraries, served from node_modules so the page needs no CDN.
const modules = fileURLToPath(new URL("../node_modules", import.meta.url));
const vendor: Record<string, string> = {
  "marked.js": "marked/lib/marked.esm.js",
  "purify.js": "dompurify/dist/purify.es.mjs",
};

// The SDK's message for a missing key is about "authentication methods". Say what to do.
const friendly = (e: unknown): string => {
  const message = e instanceof Error ? e.message : String(e);
  return (e as { status?: number })?.status === 401 || /resolve authentication/i.test(message)
    ? "ANTHROPIC_API_KEY is missing or invalid. Copy .env.example to .env and fill it in."
    : message;
};

export function createApp({ memory, run = runAgent, search = createProvider }: Deps) {
  const app = new Hono();

  // The page and its small modules. Read per request, so edits show up without a restart.
  app.get("/", (c) => c.html(readFileSync(join(publicDir, "index.html"), "utf8")));
  app.get("/vendor/:name", (c) => {
    const name = c.req.param("name");
    if (!Object.hasOwn(vendor, name)) return c.notFound();
    return c.body(readFileSync(join(modules, vendor[name])), 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });
  app.get("/*", serveStatic({ root: publicRoot }));

  app.post("/chat", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const body = parsed.data;

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });

      // The user pressed Stop or closed the tab: end the agent run, and save nothing.
      const stop = new AbortController();
      stream.onAbort(() => stop.abort());

      // First, before any lookup or model call, so the user sees life immediately.
      const memoryStep = { id: "memory", kind: "memory", label: "Checking memory" } as const;
      await send("step", { ...memoryStep, state: "running" });

      try {
        const provider = search();

        const now = body.client_time ? new Date(body.client_time) : new Date();
        const tz = resolveTz(body.tz);
        if (body.history?.length) memory.seed(body.user_id, body.session_id, body.history, now.toISOString(), tz);

        const brief = buildBrief({ memory, userId: body.user_id, message: body.message, now, tz });
        const found = Number(/MEMORY MATCHES \((\d+)\)/.exec(brief)?.[1] ?? 0);
        await send("step", { ...memoryStep, state: "done", detail: found ? `${found} earlier exchange${found === 1 ? "" : "s"} found` : "nothing earlier on this" });
        // Earlier turns of this chat, as the running conversation.
        const history = memory.session(body.user_id, body.session_id).flatMap((t) => [
          { role: "user" as const, content: t.userMsg },
          { role: "assistant" as const, content: t.assistantMsg },
        ]);

        const result = await run({
          message: body.message,
          brief,
          asOf: nowLine(now, tz),
          history,
          search: provider,
          signal: stop.signal,
          emit: (e) => void (e.type === "step" ? send("step", e.step) : send("token", { text: e.text })),
        });
        if (stop.signal.aborted) return;

        const sources = result.sources.map((s) => ({
          id: s.id, title: s.title, url: s.url, domain: new URL(s.url).hostname.replace(/^www\./, ""), published: s.published, read_live_at: s.crawled,
        }));
        await send("sources", sources);

        // Saved after the answer is complete, never half an answer.
        memory.save({
          userId: body.user_id,
          sessionId: body.session_id,
          userMsg: body.message,
          assistantMsg: result.answer,
          at: now.toISOString(),
          tz,
          sources: result.sources.map((s) => ({ title: s.title, url: s.url, published: s.published, fetched_at: s.crawled ?? undefined })),
        });

        await send("done", { ms: result.ms, searches: result.toolCalls, turns: result.turns });
      } catch (e) {
        if (stop.signal.aborted) return;
        console.error("[chat]", e);
        await send("error", { message: friendly(e) });
      }
    });
  });

  return app;
}
