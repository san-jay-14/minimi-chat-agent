import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { Memory } from "./context/memory.js";

const app = createApp({ memory: new Memory(process.env.DB_PATH ?? "./data/memory.json") });
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`));
