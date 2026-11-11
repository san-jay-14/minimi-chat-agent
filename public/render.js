import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";

// Single newlines become line breaks: the answer ends with "As of ..." and
// "Couldn't verify: ..." lines that must not run together.
marked.setOptions({ gfm: true, breaks: true });

// The model's text is untrusted (it quotes web pages). Allow only plain text
// formatting, and no images or frames, so rendering can never fetch from a third-party host.
const SAFE = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td"],
  ALLOWED_ATTR: ["href", "title"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text, { async: false }), SAFE);

const CITE = /\[(R\d+(?:\s*[,;]\s*R\d+)*)\]/g;
const isWebUrl = (u) => /^https?:\/\//i.test(u ?? "");

// What a [R3] marker becomes. `byId` is null until the sources event arrives.
function chip(id, byId) {
  if (!byId) {
    const wait = document.createElement("span");
    wait.className = "chip pending";
    wait.textContent = id;
    wait.setAttribute("aria-hidden", "true"); // a placeholder: the real link replaces it a moment later
    return wait;
  }
  const source = byId.get(id);
  if (!source) return document.createTextNode(`[${id}]`); // cited but not a real source: leave it visible
  const node = document.createElement(isWebUrl(source.url) ? "a" : "span");
  node.className = "chip";
  node.textContent = source.domain ?? new URL(source.url).hostname;
  node.title = [source.title, source.published].filter(Boolean).join(" · ");
  if (node.tagName === "A") {
    node.setAttribute("aria-label", `Source: ${source.title} (${node.textContent})`); // "neon.com" alone says little
    node.href = source.url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
  }
  return node;
}

// Runs on the already sanitized tree, and builds elements with the DOM API only, so
// untrusted text cannot become a link by itself. Code and existing links are left alone.
function linkCitations(root, sources) {
  const byId = sources && new Map(sources.map((s) => [s.id, s]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.includes("[R")) nodes.push(n);
  for (const node of nodes) {
    if (node.parentElement?.closest("a, code, pre")) continue;
    const out = document.createDocumentFragment();
    let last = 0;
    for (const m of node.data.matchAll(CITE)) {
      out.append(node.data.slice(last, m.index));
      m[1].split(/[,;]/).forEach((id, i) => {
        if (i) out.append(" ");
        out.append(chip(id.trim(), byId));
      });
      last = m.index + m[0].length;
    }
    out.append(node.data.slice(last));
    node.replaceWith(out);
  }
}

export function renderInto(el, text, sources = null) {
  const page = document.createElement("template");
  page.innerHTML = renderMarkdown(text);
  linkCitations(page.content, sources);
  el.replaceChildren(page.content);
}

// Paints at most once per animation frame, so a fast stream cannot cause flicker or
// repeated layout. finish() paints at once: frames do not run in a background tab.
export function streamingView(el, onPaint = () => {}) {
  let text = "";
  let sources = null;
  let frame = 0;
  const paint = () => {
    frame = 0;
    renderInto(el, text, sources);
    onPaint();
  };
  // A forced paint drops the queued one: painting twice makes a screen reader announce twice.
  const paintNow = () => {
    cancelAnimationFrame(frame);
    paint();
  };
  return {
    push(chunk) {
      text += chunk;
      if (!frame) frame = requestAnimationFrame(paint);
    },
    // Once the sources are known, the placeholders in the text become real chips.
    setSources(list) {
      sources = list;
      paintNow();
    },
    finish: paintNow,
    get text() {
      return text;
    },
  };
}
