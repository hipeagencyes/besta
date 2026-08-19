/**
 * Descarga los conciertos de BESTA desde la API de Bandsintown
 * y los deja normalizados en events.json (que es lo que lee la web).
 *
 * Lo lanza solo GitHub Actions (.github/workflows/eventos.yml).
 * Para probarlo en local:
 *   BIT_APP_ID=tu-api-key node scripts/fetch-events.mjs
 *
 * Variables de entorno:
 *   BIT_APP_ID  (obligatoria)  la API key que te dio Bandsintown
 *   BIT_ARTIST  (opcional)     nombre del artista en Bandsintown. Por defecto "BESTA".
 *                              También vale el ID: "id_15578055"
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "events.json");
const OVERRIDES = join(ROOT, "events-overrides.json");

const APP_ID = process.env.BIT_APP_ID;
const ARTIST = process.env.BIT_ARTIST || "BESTA";

if (!APP_ID) {
  console.error("Falta BIT_APP_ID (la API key de Bandsintown).");
  process.exit(1);
}

/* Bandsintown pide codificar estos caracteres del nombre de artista de forma especial */
function encodeArtist(name) {
  return encodeURIComponent(name)
    .replace(/%2F/gi, "%252F")
    .replace(/%3F/gi, "%253F")
    .replace(/%2A/gi, "%252A")
    .replace(/%22/gi, "%27C");
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.replace(APP_ID, "***")} → ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Respuesta no-JSON: ${body.slice(0, 300)}`);
  }
}

/* "2026-08-15T21:00:00" → { date: "2026-08-15", time: "21:00" }
   Bandsintown usa 00:00:00 cuando la hora aún no está anunciada. */
function splitDatetime(dt) {
  if (typeof dt !== "string" || dt.length < 10) return { date: "", time: "" };
  const date = dt.slice(0, 10);
  const hhmm = dt.slice(11, 16);
  return { date, time: hhmm && hhmm !== "00:00" ? hhmm : "" };
}

/* De todas las offers nos quedamos con la de entradas; si no, la primera que haya */
function pickOffer(offers) {
  if (!Array.isArray(offers) || !offers.length) return null;
  return offers.find(o => /ticket/i.test(o?.type || "")) || offers[0];
}

function normalize(raw) {
  const { date, time } = splitDatetime(raw?.datetime);
  const venue = raw?.venue || {};
  const offer = pickOffer(raw?.offers);
  return {
    id: String(raw?.id ?? ""),
    date,
    time,
    city: venue.city || "",
    region: venue.region || "",
    country: venue.country || "",
    venue: venue.name || "",
    title: (raw?.title || "").trim(),
    description: (raw?.description || "").trim(),
    lineup: Array.isArray(raw?.lineup) ? raw.lineup : [],
    url: raw?.url || "",
    tickets: offer?.url || "",
    ticketsStatus: offer?.status || ""
  };
}

/* Los overrides son nuestros: permiten reescribir cómo se enseña un bolo en la web
   sin tocar lo que hay en Bandsintown. Se buscan por id de evento o por fecha. */
async function loadOverrides() {
  try {
    return JSON.parse(await readFile(OVERRIDES, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`Aviso: no pude leer events-overrides.json (${err.message})`);
    return {};
  }
}

function applyOverride(ev, overrides) {
  const patch = overrides[ev.id] || overrides[ev.date];
  return patch ? { ...ev, ...patch } : ev;
}

/* Pedimos también los conciertos recién pasados: la web los enseña tachados y
   con la chapa de "Finalizado" durante un mes antes de quitarlos de la lista. */
function isoHoyMas(dias) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const RANGO = `${isoHoyMas(-60)},${isoHoyMas(730)}`;

const artistUrl = `https://rest.bandsintown.com/artists/${encodeArtist(ARTIST)}?app_id=${encodeURIComponent(APP_ID)}`;
const eventsUrl = `https://rest.bandsintown.com/artists/${encodeArtist(ARTIST)}/events?app_id=${encodeURIComponent(APP_ID)}&date=${RANGO}`;

const [artist, rawEvents, overrides] = await Promise.all([
  getJSON(artistUrl).catch(err => {
    console.warn(`Aviso: no pude leer la info de artista (${err.message})`);
    return null;
  }),
  getJSON(eventsUrl),
  loadOverrides()
]);

if (!Array.isArray(rawEvents)) {
  throw new Error(`Esperaba una lista de eventos y llegó: ${JSON.stringify(rawEvents).slice(0, 300)}`);
}

const events = rawEvents
  .map(normalize)
  .map(ev => applyOverride(ev, overrides))
  .filter(ev => ev.date)
  .sort((a, b) => a.date.localeCompare(b.date));

const payload = {
  updated: new Date().toISOString(),
  source: "bandsintown",
  artist: {
    name: artist?.name || ARTIST,
    url: artist?.url || "",
    image: artist?.image_url || "",
    followers: artist?.tracker_count ?? null
  },
  events
};

await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`OK · ${events.length} concierto(s) guardados en events.json`);
events.forEach(ev => console.log(`   ${ev.date}${ev.time ? " " + ev.time : ""} · ${ev.city} · ${ev.venue}`));
