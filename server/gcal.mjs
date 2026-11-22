// Calendario FENICE FILM letto con l'API di Google tramite un "account di servizio" (sola lettura).
// A differenza dell'indirizzo iCal, l'API restituisce anche i colori degli eventi (grigio = assenza).
const DEFAULT_CAL = "195b1f5a76af9ba4765d47a6861c3ff782bbd0f59f8ee15f4a2bfc3ecc85456c@group.calendar.google.com";
let tok = { key: "", value: "", exp: 0 };
const cache = new Map();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

export function parseServiceAccount(raw) {
  if (!raw) return null;
  let sa;
  try { sa = JSON.parse(raw); } catch { throw Object.assign(new Error("GCAL_SERVICE_ACCOUNT non è un JSON valido"), { code: "bad_config" }); }
  if (!sa.client_email || !sa.private_key) throw Object.assign(new Error("Nel JSON mancano client_email o private_key"), { code: "bad_config" });
  return sa;
}

async function accessToken(sa, fetchFn) {
  if (tok.key === sa.client_email && tok.value && Date.now() < tok.exp - 60000) return tok.value;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64urlStr(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + unsigned + "." + b64url(sig),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error("Accesso Google rifiutato: " + (j.error_description || j.error || r.status)), { code: "auth" });
  tok = { key: sa.client_email, value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tok.value;
}

const shift = (k, d) => { const t = new Date(k + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

// Restituisce gli eventi tra due giorni (YYYY-MM-DD), nella forma dell'API Google.
export async function apiEventsBetween(sa, calId, from, to, fetchFn = fetch) {
  const ck = `${calId}|${from}|${to}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 120000) return hit.events;
  const token = await accessToken(sa, fetchFn);
  const events = [];
  let pageToken = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ timeMin: shift(from, -1) + "T00:00:00Z", timeMax: shift(to, 1) + "T23:59:59Z", singleEvents: "true", orderBy: "startTime", maxResults: "2500", timeZone: "Europe/Rome" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await fetchFn(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId || DEFAULT_CAL)}/events?${q}`, { headers: { authorization: "Bearer " + token } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 403) throw Object.assign(new Error("L'account di servizio non vede il calendario FENICE FILM: condividilo con " + sa.client_email), { code: "not_shared" });
    if (!r.ok) throw Object.assign(new Error("Google Calendar " + r.status), { code: "server_unavailable" });
    for (const e of j.items || []) {
      if (e.status === "cancelled") continue;
      events.push({ id: e.id, summary: e.summary || "", status: e.status, start: e.start, end: e.end, colorId: e.colorId, transparency: e.transparency, location: e.location, description: e.description, htmlLink: e.htmlLink });
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  if (cache.size > 30) cache.clear();
  cache.set(ck, { at: Date.now(), events });
  return events;
}
