import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { auth } from "./auth.js";
import { api } from "./routes/api.js";
import { env } from "./env.js";

const app = new Hono();

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", api);

// Static frontend + SPA fallback
const webRoot = path.relative(process.cwd(), env.webDist) || ".";
app.use("/*", serveStatic({ root: webRoot }));
app.get("*", (c) => {
  const indexPath = path.join(env.webDist, "index.html");
  if (fs.existsSync(indexPath)) return c.html(fs.readFileSync(indexPath, "utf8"));
  return c.text("Frontend build not found — run `npm run build -w web`", 404);
});

serve({ fetch: app.fetch, port: env.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[tab-tracker] listening on http://localhost:${info.port} (${env.baseUrl})`);
});
