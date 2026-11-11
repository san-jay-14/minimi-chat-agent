// POST /chat and read the SSE stream. EventSource cannot POST, so this reads the body by hand.

export class ChatError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // "rejected": the server refused the request, "server": the agent failed
  }
}

export async function streamChat(body, { signal, onEvent }) {
  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ChatError([].concat(detail.error ?? res.statusText).join("; "), "rejected");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = frame.split(/\r?\n/).filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (event) onEvent(event, data ? JSON.parse(data) : null);
    }
  }
}
