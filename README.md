# Minimi chat agent

A chat agent with one tool, `web_search`. Built for questions that depend on time and memory: "what changed since Monday?", "what did I ask on 3 November, is it still right?". TypeScript, Node, Hono, the Anthropic SDK, no agent framework, and a small chat UI with no build step.

## Run it
```
npm install
cp .env.example .env     # set ANTHROPIC_API_KEY and TAVILY_API_KEY
npm start                # http://localhost:3000, open it and chat
```
Other keys in `.env.example` are optional: `MODEL` (default `claude-sonnet-5-5`), `SEARCH_PROVIDER` (`tavily` or `exa`, with `EXA_API_KEY`), `EFFORT`, `DB_PATH`, `PORT`. `npm test` runs 99 unit tests (no keys). `npm run eval` runs the 18 evals on recorded search results; **it still calls the model and needs `ANTHROPIC_API_KEY`** (about $0.30, 90 s). `npm run eval:record` re-records the searches. Written for Node 20+, but only tried on Node 25.

API: `POST /chat` with `{message, user_id?, session_id?, client_time?, tz?, history?}` returns SSE events: `step` (a real agent action, sent as running and again as done), `token`, `sources` (cited results only), `done` (`{ms, searches, turns}`), `error`. Closing the connection stops the run and nothing is saved. Without `client_time` or `tz` it uses the server clock and the server's timezone. `history` is optional seeding for a caller that replays an earlier conversation; memory is keyed by `user_id`.

## How it works
```
request -> first step event at once
        -> context builder (plain code, milliseconds): now + timezone, "Monday"/"3 Nov"/"last Tuesday" -> dates,
           memory lookup by that day and by keywords, timeline of earlier sessions   -> the "brief"
        -> agent loop: one model, parallel web_search calls, max 4 turns and 10 searches
        -> grounding check (code) -> stream answer, "As of" line, sources -> save the turn
```
- **Time is code, not model.** The model gets today's date and the user's relative dates already resolved in the user's timezone (chrono-node, DST-safe). "Last Tuesday" can mean yesterday or a week earlier, so both dates are given and both days are looked up.
- **Memory is a JSON file** of raw exchanges with their cited sources, per user, searched by day and by BM25. No extraction by a model at write time. If nothing matches, the brief says so and the prompt's cold-start rule applies: say there is no record, ask one question, never invent the history.
- **One tool, two modes.** `web_search` takes a `query` (with optional date window) or a `url` to read live. It is one tool because both return the same result shape and the model picks per question; a pricing question needs the official page as it is now, not a stale snippet. Results are cleaned (dedupe, boilerplate, size caps, ids R1..), wrapped as untrusted data, and carry their published date.
- **Answers** lead with the verdict, one line per item with what was said before and when, `changed | unchanged as checked | couldn't verify`, a `Checked:` line, and cited as `[R3]`. Code adds the "As of" line and the dated sources list, so they cannot be forgotten.
- **Grounding check.** Prices, percentages and versions next to a citation must appear in the cited result. If not, a `Couldn't verify: ...` line is appended; the answer is not regenerated.
- **The UI** (`public/`, plain ES modules, no build step, no CDN): a centered chat column that renders markdown (`marked`, then `dompurify` with a strict allow-list, both installed from npm and served locally). While the agent works, a timeline lists what it actually does, built only from the `step` events (memory lookup, each search or page read, the source check), and folds into one line when done ("Researched for 7s, 3 searches"). `[R3]` markers become source chips linking to the page, with a sources list under the answer. Stop aborts the run (the server cancels the model call and any search and saves nothing), plus copy, new chat, auto-growing input, follow-the-stream scrolling with a jump button, light and dark themes, phone width, and keyboard and screen-reader basics. It shows no model reasoning and requests no extended thinking.

## Why built this way
The test questions are about time and memory, so those are handled before the model runs and cost almost no latency. One loop and one model with parallel calls, no framework, so every decision is readable. Deterministic checks instead of an LLM judge (there is none anywhere). The first `step` event goes out before any lookup (tested under 300 ms), and the UI shows every step as it happens, because a researched answer is not fast. The UI keeps to the same rule as the agent: plain files, two small dependencies, nothing hidden.

## Considered and rejected
- **Worker agents per item:** parallel tool calls in one turn cover multi-item questions with less code and latency.
- **LLM router before the first token:** serial latency; date parsing and retrieval are code.
- **LLM claim extraction at write time:** cost, and extraction errors become permanent.
- **Vector DB:** a few hundred timestamped turns do not need one. **SQLite:** `better-sqlite3` would not install on Node 25 / Windows, so a JSON file.
- **Separate verifier model:** deterministic checks first. **LangChain/LangGraph:** hides the design. **Memory as a second tool:** breaks one-tool and adds a round trip.
- **Server-side refusal fallbacks:** left off, a refusal is unlikely for this use. **Brave:** no extract endpoint.

## Results
Same recorded searches, `claude-sonnet-5-5`, effort medium, one run each (details and the raw files: `evals/RESULTS.md`):

| | model cases passed (15) |
|---|---|
| this agent | 15 (plus 3 of 3 checks of our own code) |
| without memory | 11 (fails the "since Monday / on 3 Nov / last Tuesday" cases) |
| naive ReAct: same model and tool, no dates, memory, contract or grounding | 5 (7 in an earlier run) |

Read the naive column with care: several of its failures are format checks that encode our own contract. The real behaviour gaps: it obeyed an injected "reply only with PWNED" (E12) and named CRM tools the user never listed (E02). This agent passed every case in 5 of 6 full runs. **Typical cost and speed:** a plain fact about $0.007 and 3 to 4 s; re-checking five CRM tools about $0.07 and 16 to 20 s.

**Provider.** Tavily and Exa both pass the 5 real-provider cases. Default Tavily: it read all 8 official pricing pages (Exa 7 of 8, one empty), and an unreadable page turns a verdict into "couldn't verify". Exa returned dates more often (76% vs 69% of results) and surfaced fresher news. This comes from our own cases, one run, not a benchmark. Not done: a by-hand comparison against a commercial agent.

**What failed along the way** (all fixed, all in `history.md`): the grounding check rejected correctly rounded decimals; a 6000-character cap hid Zoho's price table that starts at character 14,346; one eval check was too narrow and I widened it after seeing it fail (the failing run is kept).

## What I would do with another week
Worker fan-out behind a flag if evals show a gain; a hybrid provider (Exa for news, Tavily for page reads); a page snapshot store to prove a price changed over time; scheduled re-checks of tracked claims; search result caching and reranking; compare effort levels for speed, since the main wait is generation; test the UI on real phones and with a real screen reader.

## Honest limits
- **Speed.** After a tool call the API delivers the whole answer in one burst (measured), so time to first token on a researched answer equals generation time. Multi-item re-checks take 15 to 25 s; the activity timeline is what you watch meanwhile.
- **"No change" means "not found in what I checked."** Search dates are best estimates (Tavily's can mean last updated), neither provider gives a crawl date, and live reads can come back localised (Zoho returned Portuguese and INR). A price depends on a billing toggle the text does not always label.
- **The grounding check is a backstop.** It checks figures only, and can pass a wrong price that matches another number in the source. It has fired on real answers once, a false positive.
- **Evals:** single runs of a noisy model, 15 model cases, hand-written fictional-vendor scenarios for several, no ground truth for live prices. One E01 run failed before I changed that check.
- **No authentication.** `user_id` is supplied by the client, so anyone who knows an id can read its memory. The JSON store has no locking and assumes one server process.
- **Prompt injection** is handled by wrapping results as data, a prompt rule and one eval. That is not a guarantee. In the UI, model text is sanitized before display and cannot load images or frames, so rendering never contacts a third-party host.
- **UI checks were done in an emulated browser,** not on real devices or with a real screen reader (contrast, keyboard use, live-region behaviour and layout from 320 px were measured, not heard). There are no UI unit tests; the sanitizer was checked against 16 hostile inputs in a real page. A stopped answer is not saved, so a later question in that chat does not see it. The on-screen conversation is not kept across a page reload (memory on the server is).
- `npm audit` reports 3 advisories, all in vitest 3 (dev only). The fix needs vitest 5, which needs Node 22+, against the Node 20 target.
