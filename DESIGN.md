# Design

A chat agent with one tool, `web_search`, built for questions that depend on time and memory: "what changed since Monday?", "what did I ask on 3 November, is it still right?".

## How it works

1. **Server.** Hono streams server-sent events. The first event goes out before any lookup, and the UI shows each step as it happens.
2. **Context builder (plain code).** Works out the current time and timezone, turns "Monday", "3 November" and "last Tuesday" into dates (chrono-node), and finds the user's earlier chats by day and by keyword (BM25) in a JSON file. The result is a short brief placed ahead of the question. "Last Tuesday" can mean two dates, so both are given.
3. **Agent loop.** One model, parallel `web_search` calls, at most 4 turns and 10 searches. The last turn has tools switched off, so it always ends in an answer.
4. **`web_search`.** Takes a `query` (with an optional date window) or a `url` to read live. Results are cleaned, wrapped as untrusted data, and carry their published date. Tavily is the default, Exa is a switch.
5. **Grounding check (plain code).** Prices, percentages and versions next to a citation must appear in the cited result. If not, a "Couldn't verify" line is added. Code also adds the "As of" time and the sources list.
6. **Memory.** The finished turn is saved after the answer completes, per user. A stopped run saves nothing.

## Why this way

- **Time and memory are code, not model.** A model does not know today's date and gets relative dates wrong. Code is exact, fast and testable.
- **One tool, two modes.** Search results go stale. For a price, reading the official page now is better than a snippet.
- **Checks in code, not a second model.** Cheaper, faster and repeatable. The 18 evals work the same way: deterministic checks on recorded search results, no model as judge.
- **No framework.** One short loop is easier to read and explain than a graph.
- **Show the work.** A researched answer takes 5 to 20 seconds, so the UI lists each real step (memory, each search or page read, the source check) while it waits.

## Considered and rejected

- **Worker agents per item:** parallel tool calls in one turn cover multi-item questions with less code.
- **A model as router before the first token:** adds a serial delay, and date parsing and lookup are code anyway.
- **Model-extracted facts at write time:** costs more, and an extraction mistake becomes permanent.
- **Vector database:** a few hundred timestamped turns do not need one.
- **SQLite:** `better-sqlite3` would not install on Node 25 on Windows, so a JSON file.
- **LangChain or LangGraph, and memory as a second tool:** hides the design and adds a round trip.

## With another week

- A real identity layer instead of a client-supplied `user_id`.
- Snapshots of pages, so a price change can be proven rather than inferred.
- Scheduled re-checks of tracked claims.
- Exa for news and Tavily for page reads, and caching of search results.
- Repeated eval runs to measure noise, and the UI on real phones with a screen reader.

## Limits

- "Unchanged" means "not found in what I checked". Search dates are estimates.
- The grounding check looks at figures only, and can pass a wrong price that matches another number in the page.
- Evals are single runs of a non-deterministic model. On the recorded searches, this agent passed 15 of 15 model cases, against 11 without memory and 5 for a plain search-and-answer loop.
- `user_id` is not authenticated, and the JSON store assumes one server process.
