// Lettore iCal (formato .ics di Google Calendar) con ripetizioni, eccezioni e fusi orari.
// Restituisce gli eventi nello stesso formato dell'API di Google Calendar usato dall'app.
const DEFAULT_TZ = "Europe/Rome";

function unfold(text) { return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function unescape(v) { return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }

function parseLine(line) {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params = {};
  for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}

// --- fusi orari ---
const dtfCache = {};
function parts(ms, tz) {
  const f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = +p.value;
  return o;
}
function offset(ms, tz) { const p = parts(ms, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; }
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - offset(guess, tz);
  const o2 = offset(ms, tz);
  ms = guess - o2;
  return ms;
}
function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }

// Valore data/ora -> { allDay, date: "YYYY-MM-DD" } oppure { ms, local:{y,mo,d,h,mi,s}, tz }
function parseDT(prop, calTz) {
  if (!prop) return null;
  const v = prop.value.trim();
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(v)) return { allDay: true, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (m[7] === "Z") { const ms = Date.UTC(y, mo - 1, d, h, mi, s); const tz = calTz; const p = parts(ms, tz); return { ms, tz, local: { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second } }; }
  const tz = prop.params.TZID && validTz(prop.params.TZID) ? prop.params.TZID : calTz;
  return { ms: zonedToUtc(y, mo, d, h, mi, s, tz), tz, local: { y, mo, d, h, mi, s } };
}

// --- date semplici (YYYY-MM-DD) ---
const dk = (y, mo, d) => { const t = new Date(Date.UTC(y, mo - 1, d)); return t.toISOString().slice(0, 10); };
const addDays = (k, n) => { const t = new Date(k + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ymd = (k) => k.split("-").map(Number);
const dow = (k) => (new Date(k + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = lunedì
const WD = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function parseRule(v) {
  const r = {};
  for (const p of v.split(";")) { const [k, val] = p.split("="); if (k && val) r[k.toUpperCase()] = val; }
  return { freq: r.FREQ, interval: Math.max(1, +r.INTERVAL || 1), count: r.COUNT ? +r.COUNT : null, until: r.UNTIL || null,
    byday: r.BYDAY ? r.BYDAY.split(",").map((x) => { const m = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/); return m ? { n: m[1] ? +m[1] : 0, wd: WD[m[2]] } : null; }).filter(Boolean) : [],
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : [] };
}
function nthWeekday(y, mo, wd, n) {
  if (n > 0) { const first = dk(y, mo, 1); const off = (wd - dow(first) + 7) % 7; const d = 1 + off + (n - 1) * 7; return d <= daysIn(y, mo) ? dk(y, mo, d) : null; }
  const last = dk(y, mo, daysIn(y, mo)); const off = (dow(last) - wd + 7) % 7; const d = daysIn(y, mo) - off + (n + 1) * 7; return d >= 1 ? dk(y, mo, d) : null;
}

// Date (locali) delle ripetizioni, a partire dal giorno iniziale, fino a "stopKey"
function expandDates(startKey, rule, stopKey, untilCheck) {
  const out = [];
  let count = 0;
  const push = (k) => { if (k < startKey) return true; if (rule.count != null && count >= rule.count) return false; if (k > stopKey || !untilCheck(k)) return false; count++; out.push(k); return true; };
  const [sy, smo, sd] = ymd(startKey);
  for (let i = 0; i < 3000; i++) {
    let batch = [];
    if (rule.freq === "DAILY") batch = [addDays(startKey, i * rule.interval)];
    else if (rule.freq === "WEEKLY") {
      const ws = addDays(startKey, -dow(startKey) + i * 7 * rule.interval);
      const wds = rule.byday.length ? rule.byday.map((b) => b.wd).sort() : [dow(startKey)];
      batch = wds.map((w) => addDays(ws, w));
    } else if (rule.freq === "MONTHLY") {
      const t = new Date(Date.UTC(sy, smo - 1 + i * rule.interval, 1)); const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1;
      if (rule.byday.length) batch = rule.byday.map((b) => nthWeekday(y, mo, b.wd, b.n || 1)).filter(Boolean).sort();
      else { const days = rule.bymonthday.length ? rule.bymonthday : [sd]; batch = days.map((d) => (d < 0 ? daysIn(y, mo) + d + 1 : d)).filter((d) => d >= 1 && d <= daysIn(y, mo)).sort((a, b) => a - b).map((d) => dk(y, mo, d)); }
    } else if (rule.freq === "YEARLY") {
      const y = sy + i * rule.interval; if (sd <= daysIn(y, smo)) batch = [dk(y, smo, sd)];
    } else { batch = [startKey]; }
    for (const k of batch) if (!push(k)) return out;
    if (!rule.freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) return out;
  }
  return out;
}

function parseCalendar(text) {
  const lines = unfold(text).split("\n");
  let calTz = DEFAULT_TZ;
  const events = [];
  let cur = null, depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") { cur = { props: {}, exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (/^BEGIN:/.test(line)) { if (cur) depth++; continue; }
    if (/^END:/.test(line)) { if (cur && depth) depth--; continue; }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) { if (p.name === "X-WR-TIMEZONE" && validTz(p.value.trim())) calTz = p.value.trim(); continue; }
    if (depth) continue; // es. VALARM
    if (p.name === "EXDATE") cur.exdates.push(p);
    else cur.props[p.name] = p;
  }
  return { calTz, events };
}

function isoUtc(ms) { return new Date(ms).toISOString().replace(".000Z", "Z"); }

export function eventsBetween(text, fromKey, toKey) {
  const { calTz, events } = parseCalendar(text);
  const fromMs = zonedToUtc(...ymd(fromKey), 0, 0, 0, calTz), toMs = zonedToUtc(...ymd(toKey), 0, 0, 0, calTz);
  const overrides = new Map(); // uid|chiave -> evento modificato
  const out = [];
  const emit = (ev, s, e, allDay, key) => {
    const P = ev.props;
    const status = (P.STATUS && P.STATUS.value.trim().toLowerCase()) || "confirmed";
    if (status === "cancelled") return;
    const o = { id: (P.UID ? P.UID.value.trim() : "ev") + "_" + key, summary: P.SUMMARY ? unescape(P.SUMMARY.value) : "", status };
    if (P.LOCATION && P.LOCATION.value) o.location = unescape(P.LOCATION.value);
    if (P.DESCRIPTION && P.DESCRIPTION.value) o.description = unescape(P.DESCRIPTION.value).slice(0, 500);
    if (P.TRANSP && /transparent/i.test(P.TRANSP.value)) o.transparency = "transparent";
    if (allDay) { o.start = { date: s }; o.end = { date: e }; } else { o.start = { dateTime: isoUtc(s) }; o.end = { dateTime: isoUtc(e) }; }
    out.push(o);
  };
  const inRange = (sMs, eMs) => sMs < toMs && eMs > fromMs;

  for (const ev of events) {
    const P = ev.props;
    if (P["RECURRENCE-ID"]) {
      const rid = parseDT(P["RECURRENCE-ID"], calTz);
      if (rid) overrides.set((P.UID ? P.UID.value.trim() : "") + "|" + (rid.allDay ? rid.date : rid.ms), true);
    }
  }
  for (const ev of events) {
    const P = ev.props;
    const st = parseDT(P.DTSTART, calTz);
    if (!st) continue;
    let en = parseDT(P.DTEND, calTz);
    const uid = P.UID ? P.UID.value.trim() : "";
    const isOverride = !!P["RECURRENCE-ID"];
    if (st.allDay) {
      const durDays = en && en.allDay ? Math.max(1, Math.round((new Date(en.date) - new Date(st.date)) / 864e5)) : 1;
      const one = (k) => { const e = addDays(k, durDays); const sMs = zonedToUtc(...ymd(k), 0, 0, 0, calTz), eMs = zonedToUtc(...ymd(e), 0, 0, 0, calTz); if (inRange(sMs, eMs)) emit(ev, k, e, true, k.replace(/-/g, "")); };
      if (!P.RRULE || isOverride) { one(st.date); continue; }
      const rule = parseRule(P.RRULE.value);
      const until = rule.until ? rule.until.slice(0, 8) : null;
      const ex = new Set(ev.exdates.flatMap((x) => x.value.split(",").map((v) => v.slice(0, 8))));
      for (const k of expandDates(st.date, rule, addDays(toKey, 1), (k) => !until || k.replace(/-/g, "") <= until)) {
        if (ex.has(k.replace(/-/g, "")) || overrides.has(uid + "|" + k)) continue;
        one(k);
      }
    } else {
      const durMs = en && !en.allDay ? Math.max(0, en.ms - st.ms) : (P.DURATION ? parseDuration(P.DURATION.value) : 3600000);
      if (!P.RRULE || isOverride) { if (inRange(st.ms, st.ms + durMs)) emit(ev, st.ms, st.ms + durMs, false, st.ms); continue; }
      const rule = parseRule(P.RRULE.value);
      let untilMs = null;
      if (rule.until) { const u = parseDT({ value: rule.until, params: {} }, st.tz); untilMs = u ? (u.allDay ? zonedToUtc(...ymd(u.date), 23, 59, 59, st.tz) : u.ms) : null; }
      const L = st.local;
      const at = (k) => zonedToUtc(...ymd(k), L.h, L.mi, L.s, st.tz);
      const ex = new Set();
      for (const x of ev.exdates) for (const v of x.value.split(",")) { const d = parseDT({ value: v, params: x.params }, st.tz); if (d) ex.add(d.allDay ? at(d.date) : d.ms); }
      const startKey = dk(L.y, L.mo, L.d);
      for (const k of expandDates(startKey, rule, addDays(toKey, 1), (k) => untilMs == null || at(k) <= untilMs)) {
        const sMs = at(k);
        if (ex.has(sMs) || overrides.has(uid + "|" + sMs)) continue;
        if (inRange(sMs, sMs + durMs)) emit(ev, sMs, sMs + durMs, false, sMs);
      }
    }
  }
  out.sort((a, b) => String(a.start.dateTime || a.start.date).localeCompare(String(b.start.dateTime || b.start.date)));
  return out;
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 3600000;
  return ((+m[2] || 0) * 7 * 864e5) + ((+m[3] || 0) * 864e5) + ((+m[4] || 0) * 3600e3) + ((+m[5] || 0) * 60e3) + ((+m[6] || 0) * 1e3);
}
