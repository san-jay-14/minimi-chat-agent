import { readFileSync } from "node:fs";
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

const page = new URL("../public/index.html", import.meta.url);

export function createApp({ memory, run = runAgent, search = createProvider }: Deps) {
  const app = new Hono();

  // Read per request so edits show up without restarting the dev server.
  app.get("/", (c) => c.html(readFileSync(page, "utf8")));

  app.post("/chat", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const body = parsed.data;

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });

      // First, before any lookup or model call, so the user sees life immediately.
      await send("status", { text: "Checking the date and your history" });

      try {
        const provider = search();

        const now = body.client_time ? new Date(body.client_time) : new Date();
        const tz = resolveTz(body.tz);
        if (body.history?.length) memory.seed(body.user_id, body.session_id, body.history, now.toISOString(), tz);

        const brief = buildBrief({ memory, userId: body.user_id, message: body.message, now, tz });
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
          emit: (e) => void send(e.type, { text: e.text }),
        });

        const sources = result.sources.map((s) => ({ id: s.id, title: s.title, url: s.url, published: s.published, read_live_at: s.crawled }));
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

        await send("done", { toolCalls: result.toolCalls, turns: result.turns, ms: result.ms });
      } catch (e) {
        console.error("[chat]", e);
        await send("error", { message: e instanceof Error ? e.message : String(e) });
      }
    });
  });

  return app;
}
