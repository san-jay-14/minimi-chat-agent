import { el } from "./dom.js";
import { streamingView } from "./render.js";
import { createScroller } from "./scroll.js";
import { sourceList } from "./sources.js";
import { ChatError, streamChat } from "./stream.js";
import { createTimeline } from "./timeline.js";

const $ = (id) => document.getElementById(id);
const scroller = createScroller($("scroll"), $("jump"));

// One quiet spot for screen readers. The conversation itself is not a live region (its
// answers are re-rendered as they stream); only short messages go through here.
const announce = (text) => ($("status").textContent = text);

// Memory is keyed by this id and survives "New chat"; each chat gets its own session id.
let fallbackId = crypto.randomUUID();
const userId = () => {
  try {
    return (localStorage.minimi_user ||= crypto.randomUUID());
  } catch {
    return fallbackId;
  }
};
let sessionId = crypto.randomUUID();
let busy = false;
let lastMessage = "";
let current = null; // AbortController of the run in flight
let runId = 0; // lets a run that was replaced (New chat) finish without touching the page

// While a run is in flight the Send button becomes Stop.
function refresh() {
  const send = $("send");
  send.classList.toggle("stop", busy);
  send.textContent = busy ? "Stop" : "Send";
  send.type = busy ? "button" : "submit";
  send.setAttribute("aria-label", busy ? "Stop generating" : "Send message");
  send.disabled = !busy && !$("input").value.trim();
}

// The box grows with its text, up to the max height in the stylesheet.
function grow() {
  const box = $("input");
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  // A scrollbar only when the max height is reached; otherwise a rounding sliver shows one.
  box.style.overflowY = box.scrollHeight > box.clientHeight + 1 ? "auto" : "hidden";
}

function describe(e) {
  const message = e.message || String(e);
  if (e instanceof TypeError) return ["Can't reach the server", "Check that it is running, then try again."];
  if (e instanceof ChatError && e.kind === "rejected") return ["The server rejected the request", message];
  if (/is not set|missing or invalid/i.test(message)) return ["Server setup needed", message];
  return ["Something went wrong", message];
}

function errorBlock(e, bot) {
  const [title, message] = describe(e);
  const box = el("div", "error");
  box.setAttribute("role", "alert");
  const retry = el("button", "retry", "Retry");
  retry.type = "button";
  retry.addEventListener("click", () => {
    bot.remove();
    $("input").focus(); // the button that had focus is gone
    ask(lastMessage, true);
  });
  box.append(el("strong", "", title), el("p", "", message), retry);
  return box;
}

// Copies the answer as the model wrote it, with the sources it cites spelled out:
// the [R1] markers mean nothing once the text is pasted somewhere else.
function actionBar(getText) {
  const bar = el("div", "actions");
  const copy = el("button", "copy", "Copy");
  copy.type = "button";
  copy.setAttribute("aria-label", "Copy answer");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      copy.textContent = "Copied";
      announce("Answer copied to the clipboard");
    } catch {
      copy.textContent = "Copy failed";
      announce("Could not copy the answer");
    }
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  bar.append(copy);
  return bar;
}

async function ask(message, retry = false) {
  const run = ++runId;
  const stop = (current = new AbortController());
  lastMessage = message;
  $("empty").hidden = true;
  if (!retry) {
    const me = el("div", "msg me");
    me.append(el("h2", "sr-only", "You said"), el("div", "bubble", message)); // headings let a screen reader jump between turns
    $("log").append(me);
  }
  const bot = el("div", "msg bot");
  const timeline = createTimeline();
  const answer = el("div", "answer");
  // Polite live region, held "busy" while it streams so a screen reader waits for the whole
  // answer instead of reading every repaint; released just before the final paint.
  answer.setAttribute("aria-live", "polite");
  answer.setAttribute("aria-busy", "true");
  const view = streamingView(answer, scroller.follow);
  bot.append(el("h2", "sr-only", "Answer"), timeline.el, answer);
  $("log").append(bot);
  scroller.resume();

  busy = true;
  refresh();
  announce("Working on your question");
  let sources = [];
  let done;
  let failed = false;
  try {
    await streamChat(
      { user_id: userId(), session_id: sessionId, message, client_time: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      {
        signal: stop.signal,
        onEvent(event, data) {
          if (event === "step") {
            timeline.step(data);
            scroller.follow();
          } else if (event === "token") view.push(data.text);
          else if (event === "sources") {
            sources = data;
            view.setSources(data);
          } else if (event === "done") done = data;
          else if (event === "error") throw new ChatError(data.message, "server");
        },
      },
    );
    if (sources.length) bot.append(sourceList(sources));
  } catch (e) {
    // Stop keeps whatever was already shown. Anything else is an error to retry.
    if (e.name !== "AbortError") {
      failed = true;
      bot.append(errorBlock(e, bot));
    }
    if (!view.text) answer.remove();
  } finally {
    answer.setAttribute("aria-busy", "false");
    view.finish();
    timeline.finish(done);
    announce(failed ? "Something went wrong" : timeline.el.querySelector("summary").textContent);
    if (view.text && !failed) {
      bot.append(actionBar(() => view.text + (sources.length ? `\n\nSources:\n${sources.map((s) => `[${s.id}] ${s.title} - ${s.url}`).join("\n")}` : "")));
    }
    if (run === runId) {
      busy = false;
      refresh();
      $("input").focus();
    }
    // After everything is in the page, so a late sources list or action bar is never hidden.
    scroller.follow();
  }
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const message = $("input").value.trim();
  if (!message || busy) return;
  $("input").value = "";
  grow();
  ask(message);
});
$("send").addEventListener("click", () => {
  if (busy) current?.abort();
});
$("input").addEventListener("input", () => {
  refresh();
  grow();
});
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("form").requestSubmit();
  }
});
$("examples").addEventListener("click", (e) => {
  const button = e.target.closest(".example");
  if (button && !busy) ask(button.textContent.trim());
});
$("new").addEventListener("click", () => {
  runId++; // the run being replaced must not touch the page when it ends
  current?.abort();
  busy = false;
  sessionId = crypto.randomUUID();
  $("log").replaceChildren();
  $("empty").hidden = false;
  refresh();
  scroller.resume();
  $("input").focus();
});
refresh();
grow();
