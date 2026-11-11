import { exa } from "./exa.js";
import { tavily } from "./tavily.js";
import type { SearchProvider } from "./types.js";

const KEYS = { tavily: "TAVILY_API_KEY", exa: "EXA_API_KEY" } as const;

// Called per request so the server can start, and serve the page, before keys exist.
export function createProvider(env: NodeJS.ProcessEnv = process.env, name = env.SEARCH_PROVIDER ?? "tavily"): SearchProvider {
  if (name !== "tavily" && name !== "exa") throw new Error(`SEARCH_PROVIDER "${name}" is not implemented. Use tavily or exa.`);
  const key = env[KEYS[name]];
  if (!key) throw new Error(`${KEYS[name]} is not set. Copy .env.example to .env and fill it in.`);
  return name === "tavily" ? tavily(key) : exa(key);
}
