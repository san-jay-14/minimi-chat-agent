# BUILD_PLAN.md

Work in order. Do not start a phase until the previous "done when" is true. After each phase, give the owner a short summary and ask for anything missing.

## Phase 0: Scaffold
- `package.json` (scripts from CLAUDE.md, `engines.node >= 20`, `tsx` as a normal dependency), `tsconfig.json`, `.gitignore` (node_modules, .env, db file), `.env.example`, folder layout from ARCHITECTURE.md with empty or stub files.
- `.env.example` keys: `ANTHROPIC_API_KEY`, `MODEL`, `SEARCH_PROVIDER` (tavily|exa|brave), `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY` (only the chosen provider's key is required), `DB_PATH`, `PORT`.
- Done when: `npm install` and `npm start` run a server that answers `GET /` with a placeholder page, on a clean clone.

## Phase 1: Time and memory
- `clock.ts`, `dates.ts`, `memory.ts`, `brief.ts` as specified.
- Unit tests: relative dates ("Monday", "last Tuesday", "3 Nov", "since Monday") against fixed `now` and several timezones, including a near-midnight case; memory save, keyword retrieval, day-window retrieval in the request timezone, user isolation, idempotent seeding from `history`.
- Done when: tests pass, and a script prints the brief for a seeded conversation.

## Phase 2: Search layer
- `search/types.ts`, one adapter first (start with Tavily), `clean.ts`, `tool.ts`, `cassette.ts`.
- Verify the provider's current API before coding (see CLAUDE.md).
- Unit tests for the cleaner (dedupe, caps, ids, dates kept) and for the tool input validation (exactly one of query or url).
- Done when: a script runs a real search and a live page read and prints cleaned, id-tagged, date-tagged results; cassette record then replay returns identical results.

## Phase 3: Agent loop
- `agent/prompt.ts`, `agent/loop.ts`. Streaming, tool loop, parallel calls, caps, prompt caching, `status` events, final no-tools turn on cap.
- Done when: a CLI script answers a plain fact (1 search), a chit-chat message (0 searches), and a 3-entity comparison (parallel searches in one turn), and respects the caps.

## Phase 4: Answer contract and grounding
- `agent/grounding.ts` and the contract wording in the prompt.
- Unit tests: missing id, number not in cited text, number present, multiple citations in one sentence.
- Done when: a seeded "has anything changed since Monday" run produces per-item verdicts, an As-of line, dated sources, and a Checked line.

## Phase 5: Server and UI
- `server.ts` with `POST /chat` (SSE) and `GET /`, `public/index.html` (single file, streaming render, shows status line and sources, new-chat button).
- Support `history` seeding and `user_id`.
- Done when: the full flow works in the browser and with curl, `status` arrives before the first model token, and the turn is saved to memory.

## Phase 6: Evals and provider choice
- Implement everything in EVALS.md. Record cassettes with real keys. Run the same cases on each shortlisted provider that is implemented (at least two: add Exa or Brave adapter, small).
- Pick the provider on results and cost/latency, write the reason down.
- Done when: `npm run eval` passes on cassettes, and a results table (our agent vs naive baseline, plus one commercial agent run by hand) exists for the README.

## Phase 7: README and final check
- Fill README.md (one page). Keep it honest, including what failed.
- Fresh-clone test: clone to a new folder, `npm install`, `.env` from `.env.example`, `npm start`, chat, run `npm run eval`.
- Done when: all of the above pass and the owner has read the README and can explain every decision.
