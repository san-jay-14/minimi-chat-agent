# CLAUDE.md

Read this first, then ARCHITECTURE.md, BUILD_PLAN.md, EVALS.md. README.md is a skeleton you fill at the end.

## What we are building
A chat agent for the Minimi hiring challenge. It has exactly one tool: web search. It must answer fast, get time-sensitive things right, and be good to talk to. Judged on architecture, code, and the README, not on UI polish or feature count.

The example test prompts are about time and memory, not plain search:
- "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"
- "What did I ask you on 3 November? Is your answer still correct today?"
- "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"

The design answers that: know today's date, find what was said before, re-check the web for changes since, and say honestly what could not be verified.

## Hard constraints (from the challenge)
- JavaScript or TypeScript on Node. We use TypeScript.
- Must run with `npm install` then `npm start`. Test this on a fresh clone before finishing.
- Every API key goes in `.env.example`.
- One tool only: `web_search`. (It has an optional live-read mode, see ARCHITECTURE.md. Justify this in the README.)
- Public GitHub repo with a one-page README: how it works, why, what we considered and rejected, what we would do with another week.
- AI coding tools are fine, but the owner must be able to explain every decision. Keep code small and readable.

## Working agreement
- Log every action, decision, change, bug and fix in history.md as you go.
- Ask the owner for any missing file, key, or decision instead of guessing.
- Do only what the current phase asks. Minimal code. No speculative abstractions, no extra features, no framework unless this repo already uses it.
- Write plain, human-sounding code. Comments explain why, not what. No banner comments, no over-commenting.
- Work phase by phase from BUILD_PLAN.md. Finish a phase's "done when" checks before starting the next. Tell the owner what changed after each phase in a few lines.
- Never hardcode keys. Never commit `.env`.

## Verify before coding (not checked yet, do not rely on memory)
- Current Anthropic SDK usage: streaming, tool use, prompt caching (`cache_control`), parallel tool calls, and the current Sonnet model id (default planned: `claude-sonnet-5-5`, set via `MODEL` env).
- Each search provider's current API: endpoint, auth, date filters, whether results carry published and crawled dates, and its page-extract endpoint. Shortlist: Tavily, Exa, Brave, Perplexity Search API.
- `chrono-node` timezone and reference-date options. If awkward, use `luxon` for timezone math.
- Memory is a JSON file store (decided: `better-sqlite3` failed to install on Node 25 / Windows; see history.md).

## Stack decisions (locked)
TypeScript, Node 20+, `tsx` as the runtime (it is a normal dependency so `npm start` works), Hono + `@hono/node-server` for HTTP and SSE, `@anthropic-ai/sdk`, `chrono-node`, `zod`, `dotenv`, `vitest`. No LangChain, no LangGraph, no vector DB.

## Commands (create these scripts)
- `npm start` runs the server.
- `npm run dev` runs with watch.
- `npm test` runs unit tests.
- `npm run eval` runs evals on recorded search results.
- `npm run eval:record` re-records search cassettes (needs real keys).

## Definition of done
Fresh clone, `npm install`, copy `.env.example` to `.env`, `npm start`, open the page, chat. All evals in EVALS.md pass or have a written reason in the README. README is one page and honest.
