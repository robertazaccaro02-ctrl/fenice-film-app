// Fenice Film su Cloudflare: file dell'app (cartella public) + API + archivio dati in un Durable Object.
import { DurableObject } from "cloudflare:workers";
import { handle } from "../server/api.mjs";

const CHUNK = 900 * 1024; // i valori grandi (la proposta con le foto) vengono spezzati

// Archivio dati: un'unica istanza, scritture in ordine, nessun ritardo tra un telefono e l'altro.
export class Archivio extends DurableObject {
  async get(key) {
    const v = await this.ctx.storage.get(key);
    if (v && typeof v === "object" && v.__parti) {
      const parts = await this.ctx.storage.get(Array.from({ length: v.__parti }, (_, i) => `${key}#${i}`));
      return Array.from({ length: v.__parti }, (_, i) => parts.get(`${key}#${i}`) || "").join("");
    }
    return v ?? null;
  }
  async set(key, value) {
    const old = await this.ctx.storage.get(key);
    if (old && typeof old === "object" && old.__parti) await this.ctx.storage.delete(Array.from({ length: old.__parti }, (_, i) => `${key}#${i}`));
    if (typeof value === "string" && value.length > CHUNK) {
      const n = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < n; i++) await this.ctx.storage.put(`${key}#${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      await this.ctx.storage.put(key, { __parti: n });
    } else await this.ctx.storage.put(key, value);
  }
  async del(key) { await this.ctx.storage.delete(key); }
  async keys(prefix) { return [...(await this.ctx.storage.list({ prefix })).keys()]; }
  async getAll(prefix) { return Object.fromEntries(await this.ctx.storage.list({ prefix })); }
}

function storeFor(env) {
  const a = env.ARCHIVIO.get(env.ARCHIVIO.idFromName("fenice-film"));
  const parse = (v) => (v == null ? null : JSON.parse(v));
  return {
    get: async (k, o) => { const v = await a.get(k); return o?.type === "json" ? parse(v) : v; },
    set: (k, v) => a.set(k, String(v)),
    setJSON: (k, v) => a.set(k, JSON.stringify(v)),
    delete: (k) => a.del(k),
    list: async ({ prefix }) => ({ blobs: (await a.keys(prefix)).map((key) => ({ key })) }),
    getAllJSON: async (prefix) => Object.fromEntries(Object.entries(await a.getAll(prefix)).map(([k, v]) => [k, parse(v)])),
  };
}

const SEC = { "X-Robots-Tag": "noindex, nofollow", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" };
const withHeaders = (r, extra = {}) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries({ ...SEC, ...extra })) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/_private")) return new Response("Non trovato", { status: 404, headers: SEC });
    if (url.pathname.startsWith("/api/")) {
      const r = await handle(req, {
        env,
        store: storeFor(env),
        baseProposal: async () => (await env.ASSETS.fetch(new URL("/_private/proposta.html", url))).text(),
      });
      return withHeaders(r);
    }
    const r = await env.ASSETS.fetch(req);
    return withHeaders(r, url.pathname === "/" || url.pathname.endsWith(".html") ? { "cache-control": "no-cache" } : {});
  },
};
