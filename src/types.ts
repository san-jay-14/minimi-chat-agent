export interface Source {
  id?: string;
  title: string;
  url: string;
  published?: string | null;
  fetched_at?: string;
}

export interface Turn {
  id: number;
  userId: string;
  sessionId: string;
  userMsg: string;
  assistantMsg: string;
  at: string; // UTC ISO of the user message
  tz: string;
  sources: Source[];
  hash: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  at?: string;
}
