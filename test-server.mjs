// Server locale di prova: simula Netlify (file statici + funzione) con un archivio in memoria.
import http from "node:http"; import fs from "node:fs";
process.env.PASSWORD_TITOLARI ||= "titolari-test";
process.env.PASSWORD_COLLABORATORI ||= "collab-test";
const mod = await import("./netlify/functions/api.mjs");
const mem = new Map();
mod.__setTestStore({
  get: async (k, o) => { const v = mem.get(k); return v == null ? null : (o?.type === "json" ? JSON.parse(v) : v); },
  set: async (k, v) => mem.set(k, v), setJSON: async (k, v) => mem.set(k, JSON.stringify(v)), delete: async (k) => mem.delete(k),
  list: async ({ prefix }) => ({ blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
});
if (process.env.TEST_ICS) { process.env.GCAL_ICS_URL = "http://test/ics"; mod.__setTestFetch(async () => new Response(fs.readFileSync(process.env.TEST_ICS))); }
const types = { ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const body = await new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
    const r = await mod.default(new Request("http://x" + req.url, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const p = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const f = "public" + p;
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[p.slice(p.lastIndexOf("."))] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(8899, () => console.log("ready"));
