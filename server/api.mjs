// API dell'app Fenice Film: accesso con due password (titolari / collaboratori),
// dati condivisi (archivio passato da chi ospita l'app), calendario FENICE FILM letto dall'indirizzo iCal segreto di Google.
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import seed from "../data/seed.json" with { type: "json" };
import updates from "../data/updates.json" with { type: "json" };
import { eventsBetween } from "./ics.mjs";

const COLLECTIONS = ["produzioni", "clienti", "collaboratori", "fornitori", "documenti", "documenti_riservati", "tariffe", "todo", "assenze", "app_esterne"];
// Visibili solo ai titolari
const PRIVATE = new Set(["clienti", "tariffe", "documenti_riservati"]);
// I collaboratori possono scrivere solo qui
const OPEN_WRITE = new Set(["todo", "assenze"]);
const TOKEN_DAYS = 30;
const MAX_DOC = 64 * 1024;

// Impostazioni lette a ogni richiesta (variabili/segreti di Cloudflare o del server di prova)
let ENV = {}, FETCH = null;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const PW_T = () => ENV.PASSWORD_TITOLARI || "";
const PW_C = () => ENV.PASSWORD_COLLABORATORI || "";
function secret() {
  return ENV.APP_SECRET || createHmac("sha256", "fenice-film").update(PW_T() + "|" + PW_C()).digest("hex");
}
function sign(payload) { return createHmac("sha256", secret()).update("v1." + payload).digest("hex"); }
function makeToken(role) { const exp = Date.now() + TOKEN_DAYS * 864e5; const p = exp + "." + role; return p + "." + sign(p); }
function readToken(t) {
  if (!t || typeof t !== "string") return null;
  const [exp, role, sig] = t.split(".");
  if (!exp || !sig || (role !== "t" && role !== "c") || Number(exp) < Date.now()) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp + "." + role));
  return a.length === b.length && timingSafeEqual(a, b) ? role : null;
}
function safeEq(x, y) {
  if (!y) return false;
  const a = createHmac("sha256", "k").update(String(x)).digest(), b = createHmac("sha256", "k").update(String(y)).digest();
  return timingSafeEqual(a, b);
}
const okId = (s) => typeof s === "string" && /^[A-Za-z0-9_\-.]{1,120}$/.test(s);
const okDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function ensureSeeded(st) {
  if (await st.get("_seeded")) return;
  for (const [c, docs] of Object.entries(seed)) for (const [id, d] of Object.entries(docs)) await st.setJSON(`d/${c}/${id}`, d);
  await st.setJSON("_v", { v: Date.now() });
  await st.set("_seeded", "1");
}
// Modifiche ai dati spedite con il codice: ognuna viene applicata una sola volta.
async function applyUpdates(st) {
  let changed = false;
  for (const u of updates) {
    if (!okId(u.id) || (await st.get(`_applied/${u.id}`))) continue;
    for (const o of u.ops || []) {
      if (!COLLECTIONS.includes(o.collection) || !okId(o.docId)) continue;
      const key = `d/${o.collection}/${o.docId}`;
      if (o.op === "delete") await st.delete(key);
      else if (o.op === "update") await st.setJSON(key, Object.assign((await st.get(key, { type: "json" })) || {}, o.data));
      else if (o.op === "set") await st.setJSON(key, o.data);
    }
    await st.set(`_applied/${u.id}`, new Date().toISOString());
    changed = true;
  }
  if (changed) await bump(st);
}
async function readAll(st, role) {
  const cols = COLLECTIONS.filter((c) => role === "t" || !PRIVATE.has(c));
  const out = Object.fromEntries(cols.map((c) => [c, {}]));
  if (st.getAllJSON) {
    for (const [key, d] of Object.entries(await st.getAllJSON("d/"))) { const [, c, id] = key.split("/"); if (out[c] && d) out[c][id] = d; }
    return out;
  }
  const { blobs } = await st.list({ prefix: "d/" });
  await Promise.all(blobs.map(async ({ key }) => {
    const [, c, id] = key.split("/");
    if (!out[c]) return;
    const d = await st.get(key, { type: "json" });
    if (d) out[c][id] = d;
  }));
  return out;
}
const bump = async (st) => { const v = Date.now(); await st.setJSON("_v", { v }); return v; };

// Calendario: scarica l'iCal al massimo ogni 2 minuti
let icsCache = { at: 0, text: null };
async function loadIcs() {
  const url = ENV.GCAL_ICS_URL;
  if (!url) return null;
  if (icsCache.text && Date.now() - icsCache.at < 120000) return icsCache.text;
  const r = await (FETCH || fetch)(url, { headers: { "user-agent": "fenice-film-app" } });
  if (!r.ok) throw new Error("ics " + r.status);
  icsCache = { at: Date.now(), text: await r.text() };
  return icsCache.text;
}

// ctx: { env, store, baseProposal: () => Promise<string>, fetch? }
// store: get(key, {type:"json"}?), set, setJSON, delete, list({prefix}) -> {blobs:[{key}]}
export async function handle(req, ctx) {
  ENV = ctx.env || {}; FETCH = ctx.fetch || null;
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  if (!PW_T() || !PW_C()) return json({ error: "Password non configurate (PASSWORD_TITOLARI e PASSWORD_COLLABORATORI nelle impostazioni)." }, 500);

  if (path === "/login" && req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    const pw = body.password || "";
    const role = safeEq(pw, PW_T()) ? "t" : safeEq(pw, PW_C()) ? "c" : null;
    if (!role) {
      await new Promise((r) => setTimeout(r, 600));
      return json({ error: "Password sbagliata" }, 401);
    }
    return json({ token: makeToken(role), role });
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const role = readToken(token);
  if (!role) return json({ error: "Accesso scaduto, inserisci di nuovo la password" }, 401);

  if (path === "/calendar" && req.method === "GET") {
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!okDate(from) || !okDate(to)) return json({ error: "Date non valide" }, 400);
    let text;
    try { text = await loadIcs(); } catch (e) { return json({ error: "Google Calendar non risponde", code: "server_unavailable" }, 502); }
    if (!text) return json({ error: "Calendario non collegato (GCAL_ICS_URL)", code: "not_configured" }, 503);
    return json({ events: eventsBetween(text, from, to) });
  }

  const st = ctx.store;

  // Proposte di partnership: solo titolari
  if (path === "/proposta") {
    if (role !== "t") return json({ error: "Solo i titolari possono aprire le proposte" }, 403);
    if (req.method === "GET") {
      const saved = await st.get("proposte/partnership");
      return new Response(saved || (await ctx.baseProposal()), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
    }
    if (req.method === "POST") {
      const html = await req.text();
      if (!/^<!doctype html>/i.test(html.trim())) return json({ error: "Documento non valido" }, 400);
      if (html.length > 5.5 * 1024 * 1024) return json({ error: "Troppe immagini pesanti", code: "too_large" }, 413);
      await st.set("proposte/partnership", html);
      await st.setJSON("proposte/partnership-info", { at: new Date().toISOString() });
      return json({ ok: true });
    }
  }

  await ensureSeeded(st);
  await applyUpdates(st);

  if (path === "/state" && req.method === "GET") {
    const v = ((await st.get("_v", { type: "json" })) || {}).v || 0;
    if (url.searchParams.get("since") === String(v)) return json({ v, role, unchanged: true });
    return json({ v, role, data: await readAll(st, role) });
  }

  if (path === "/write" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Richiesta non valida" }, 400); }
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 50) : [];
    for (const o of ops) {
      if (!COLLECTIONS.includes(o.collection)) return json({ error: "Sezione non valida" }, 400);
      if (role !== "t" && !OPEN_WRITE.has(o.collection)) return json({ error: "Solo i titolari possono modificare questa sezione" }, 403);
    }
    const results = [];
    for (const o of ops) {
      const id = o.op === "add" ? randomUUID().slice(0, 12) : o.id;
      if (!okId(id)) return json({ error: "Id non valido" }, 400);
      const key = `d/${o.collection}/${id}`;
      if (o.op === "delete") { await st.delete(key); results.push({ id }); continue; }
      if (!o.data || typeof o.data !== "object" || Array.isArray(o.data)) return json({ error: "Dati non validi" }, 400);
      let doc = o.data;
      if (o.op === "update") doc = Object.assign((await st.get(key, { type: "json" })) || {}, o.data);
      else if (o.op !== "set" && o.op !== "add") return json({ error: "Operazione non valida" }, 400);
      if (JSON.stringify(doc).length > MAX_DOC) return json({ error: "Testo troppo lungo" }, 413);
      await st.setJSON(key, doc);
      results.push({ id });
    }
    const v = await bump(st);
    return json({ v, results });
  }

  return json({ error: "Non trovato" }, 404);
}
