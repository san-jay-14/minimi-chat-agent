import { el } from "./dom.js";

const seconds = (ms) => `${Math.max(1, Math.round(ms / 1000))}s`;

// The real actions the agent took, in order, shown above the answer while it works and
// folded into one line when it ends. It is built only from `step` events: these are
// things the code did (look up memory, search, read a page, check sources), not the
// model's reasoning.
export function createTimeline() {
  const root = el("details", "timeline");
  root.open = true;
  root.dataset.state = "running";
  const summary = el("summary", "", "Working…");
  const list = el("ol", "steps");
  root.append(summary, list);

  const rows = new Map();
  const started = performance.now();

  return {
    el: root,

    // The same id arrives twice: running, then done. The row is updated in place.
    step({ id, label, state, detail }) {
      let row = rows.get(id);
      if (!row) {
        row = { li: el("li"), state: el("span", "sr-only"), label: el("span", "label"), detail: el("span", "detail") };
        const icon = el("span", "icon");
        icon.setAttribute("aria-hidden", "true"); // the state is said in words by row.state
        row.li.append(icon, row.state, row.label, row.detail);
        rows.set(id, row);
        list.append(row.li);
      }
      row.li.dataset.state = state;
      row.state.textContent = state === "running" ? "In progress: " : "Done: ";
      row.label.textContent = label;
      row.label.title = label;
      row.detail.textContent = detail ? ` · ${detail}` : "";
    },

    // `done` is the server's done event. Without it the run was cut short.
    finish(done) {
      for (const row of rows.values()) {
        if (row.li.dataset.state !== "running") continue;
        row.li.dataset.state = "stopped";
        row.state.textContent = "Stopped: ";
      }
      const ms = done?.ms ?? performance.now() - started;
      summary.textContent = !done
        ? `Stopped after ${seconds(ms)}`
        : done.searches
          ? `Researched for ${seconds(ms)}, ${done.searches} search${done.searches === 1 ? "" : "es"}`
          : `Answered in ${seconds(ms)}`;
      root.dataset.state = "done";
      root.open = false;
    },
  };
}
