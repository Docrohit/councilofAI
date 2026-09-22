import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production");
if (
  process.env.DEPLOYMENT_MODE === "hosted" &&
  !process.env.APP_ORIGIN?.startsWith("https://")
)
  throw new Error("Hosted mode requires an HTTPS APP_ORIGIN.");
const { app, engine, db, benchmarks } = createApp(
  process.env.DATA_DIR || path.join(root, ".council"),
  production,
);
if (production) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4310);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`Council is listening at http://${host}:${port}`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const [id, job] of benchmarks.active) benchmarks.cancel(job.userId, id);
  for (const run of engine.active.values()) run.controller.abort();
  for (
    let i = 0;
    (engine.active.size || benchmarks.active.size) && i < 100;
    i++
  )
    await new Promise((r) => setTimeout(r, 50));
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
