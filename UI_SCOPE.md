# UI_SCOPE.md

Scope brief for the chat UI. You decide where the code lives and which files to add or change. Read CLAUDE.md and ARCHITECTURE.md first. The working agreement in CLAUDE.md still applies: ask me instead of guessing, minimal code, no speculative extras.

## Why this exists
The challenge is judged on architecture, not looks ("not the prettiest screen"). The UI should feel like a modern chat product and make the agent's behavior visible, but it must not cost more than a short, time-boxed effort and must not change the agent's core behavior.

## Goal
A chat interface that follows the interaction patterns of Claude's chat UI: centered conversation column, streaming answer, a live activity timeline while the agent works, source chips, a stop button, and a calm, clean layout.

## Brand rule
Copy the interaction patterns and general feel, not the brand. No Claude or Anthropic name, logo, sparkle mark, or trademarked assets. Use our own product name and a simple own mark, and our own color choices. It must not be mistakable for the real Claude product.

## Must have
1. Layout: single centered column, readable width, sticky input at the bottom, empty-state greeting with a few example prompts (the three challenge prompts are good examples).
2. Streaming: render tokens as they arrive with markdown (headings, lists, tables, code blocks, links), without flicker or layout jumps. Sanitize rendered HTML.
3. Activity timeline ("thinking state"): shown above the answer while the agent works. Steps such as "Checking memory", "Searching: <query>", "Reading: <url>", "Checking sources". A running step shows a spinner, a finished step shows a tick. When the answer completes, the timeline collapses to a one-line summary like "Researched for 6s, 3 searches" that can be expanded. This is a timeline of real agent actions, not model chain-of-thought. Do not request extended thinking from the model for this.
4. Citations: `[R#]` markers in the answer render as small source chips (title or domain, link to the source). A sources list sits under the answer with title, domain, and published date.
5. Controls: stop button that aborts the in-flight request and keeps the partial answer; copy button on answers; new chat; auto-growing input (Enter sends, Shift+Enter newline); disabled send while empty.
6. Scrolling: auto-scroll while streaming, but stop following if the user scrolls up, with a "jump to latest" button.
7. States: first-load empty state, error state with a retry button, and a clear message when the server rejects or the key is missing.
8. Responsive: works on a phone-width screen. Dark mode via `prefers-color-scheme`.
9. Accessibility basics: keyboard usable, visible focus, labels on buttons, `aria-live` on the streaming answer.
10. Persistence of the visible chat across page reloads is optional. Keep a stable `user_id` in local storage and a `session_id` per chat so memory works across chats (this is required, see ARCHITECTURE.md).

## Event contract (backend change, small)
Replace the plain `status` event with structured `step` events. Keep other events as they are. Adjust names if the existing code makes another shape cleaner, but keep these fields.
- `step`: `{ id, kind: "memory" | "search" | "read" | "check", label, state: "running" | "done", detail? }`. The same `id` is sent again with `state: "done"` when the step finishes.
- `token`: unchanged.
- `sources`: unchanged, plus `domain` is fine to add.
- `done`: add `ms` and `searches` (already roughly planned in ARCHITECTURE.md).
- `error`: unchanged.
The first `step` event must still go out before the first model call. Update ARCHITECTURE.md's API section to match.

## Constraints
- No build step for the UI. `npm install` then `npm start` must still be all it takes.
- No CDN dependencies at runtime. Libraries (for markdown and sanitizing) are installed from npm and served locally by our server. Keep the list to what is needed, expected to be a markdown renderer and a sanitizer.
- No frontend framework unless you can justify it in a sentence and the page still needs no build step. Plain modules are the default.
- Do not change the agent loop, memory, grounding, or search behavior to suit the UI. Event emission is the only allowed core change.
- Keep the UI code small and readable. The owner must be able to explain it.

## Out of scope
Accounts and login, file uploads, voice, chat history sidebar, model picker, settings panel, image generation, analytics, animations beyond the spinner and a subtle fade-in.

## Time-box and order
Aim for a short effort. Suggested order: event contract, static layout and states, streaming markdown, timeline, citations and sources, controls and scrolling, responsive and dark mode, accessibility pass. Stop after each step and show the owner what changed in a few lines.

## Acceptance
- Fresh clone, `npm install`, `npm start`, open the page: empty state shows, a question streams in with a live timeline that collapses at the end, citations are clickable chips, stop works mid-stream, and a follow-up question keeps context.
- The three challenge prompts work in the UI exactly as they do through curl.
- Looks right at phone width and in dark mode.
- No console errors, no network requests to third-party hosts.
- The UI has no Claude or Anthropic branding.
- Evals still pass.

## Before you start
Look at the existing UI and server event code, then tell the owner in under 10 lines which files you plan to add or change and why. Ask about anything unclear. Then begin.
