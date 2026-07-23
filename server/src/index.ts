import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[tab-tracker] listening on http://localhost:${info.port} (${env.baseUrl})`);
});
