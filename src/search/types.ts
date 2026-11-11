// What an adapter returns, before cleaning.
export interface RawResult {
  title: string;
  url: string;
  published: string | null; // ISO date, null when the source has none
  crawled: string | null; // ISO instant the page was fetched, null when the provider does not say
  text: string;
}

export interface SearchQuery {
  query: string;
  startDate?: string;
  endDate?: string;
  maxResults: number;
}

export interface SearchProvider {
  name: string;
  search(q: SearchQuery, signal?: AbortSignal): Promise<RawResult[]>;
  read(url: string, signal?: AbortSignal): Promise<RawResult>;
}

// What the model sees, after cleaning. Ids are assigned by code.
export interface Result {
  id: string;
  title: string;
  url: string;
  published: string | null;
  crawled: string | null;
  snippet: string;
  content?: string; // live reads only
}

export class SearchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
