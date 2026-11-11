import { el } from "./dom.js";

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const isWebUrl = (u) => /^https?:\/\//i.test(u ?? "");

// Under the answer: every source it cites, with where it is from and how fresh it is.
export function sourceList(sources) {
  const box = el("section", "sources");
  box.append(el("h2", "", "Sources"));
  const list = el("ul");
  for (const s of sources) {
    const item = el("li");
    let title;
    if (isWebUrl(s.url)) {
      title = el("a", "", s.title);
      title.href = s.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    } else title = el("span", "", s.title);
    const when = [
      s.published ? `published ${day.format(new Date(s.published))}` : "no published date",
      s.read_live_at ? `read live ${clock.format(new Date(s.read_live_at))}` : "",
    ].filter(Boolean);
    item.append(title, el("span", "meta", ` · ${s.domain} · ${when.join(" · ")}`));
    list.append(item);
  }
  box.append(list);
  return box;
}
