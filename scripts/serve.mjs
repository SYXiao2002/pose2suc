import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT || 8080);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".obj": "text/plain",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};
createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let path = resolve(root, `.${name}`);
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": `${types[extname(path)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Pose2Suc: http://localhost:${port}`),
);
