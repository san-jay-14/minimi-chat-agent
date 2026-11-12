# Minimi chat agent

A chat agent with one tool, `web_search`, for questions that depend on time and memory. How it works and why: see [DESIGN.md](DESIGN.md).

TypeScript on Node, Hono, the Anthropic SDK. The chat page is plain ES modules with no build step.

## Run it

```
npm install
cp .env.example .env     # set ANTHROPIC_API_KEY and TAVILY_API_KEY
npm run dev              # http://localhost:3000
```

Other settings in `.env.example` are optional: `MODEL`, `SEARCH_PROVIDER` (`tavily` or `exa`, with `EXA_API_KEY`), `EFFORT`, `DB_PATH`, `PORT`. Written for Node 20 or newer, only tried on Node 25.

## Other commands

- `npm start` runs the server without watching files.
- `npm test` runs the unit tests. No keys needed.
- `npm run eval` runs the 18 evals on recorded search results. It calls the model, so it needs `ANTHROPIC_API_KEY` (about $0.30).
- `npm run eval:record` records fresh search results. Needs real keys.

## API

`POST /chat` with `{ "message": "...", "user_id"?, "session_id"?, "client_time"?, "tz"? }` returns server-sent events: `step`, `token`, `sources`, `done`, `error`. Closing the connection stops the run, and nothing is saved.

## Layout

- `src/agent` the loop, the prompt, the grounding check
- `src/context` date handling, memory, the brief
- `src/search` the tool, Tavily and Exa adapters, result cleaning
- `src/app.ts` the HTTP and SSE layer
- `public` the chat page
- `evals`, `test` evals and unit tests
