#!/usr/bin/env node
// Corso — Monte-Carlo-Verifikation der Corso-Auswahl.
//
// Warum es das gibt: Die Gewichtungsformel `w = 1 + ln(1 + aktive Follower)` ist
// unverändert aus der alten 21:00-Ziehung (0005/0018) in die laufende
// Nachbesetzung (0031, refill_corso) übernommen worden. Die FORMEL ist dieselbe,
// die ZIEHUNGSFREQUENZ nicht: früher ein Los pro Tag, jetzt nimmt jeder lebende
// Moment an jeder Nachbesetzung seiner 24 Stunden teil. Mehr unabhängige Lose
// können den Follower-Bias verstärken — genau das misst dieses Skript.
//
// 🔒 Hintergrund: „gedämpft, mit Grundchance > 0" ist eine Produkt-Leitplanke
// (PRD §4.6 / Entscheidung #1). Authentizität vor Hierarchie: ein Neuling ohne
// Follower muss real und spürbar hineinkommen können.
//
// Aufruf:  node scripts/verify-corso-weighting.mjs [--days 400]
// Reine Simulation — keine DB, kein Netz, keine Secrets.

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const DAYS = arg("--days", 400);
const MIN_PER_DAY = 24 * 60;
const LIFETIME = MIN_PER_DAY; // ein Moment lebt 24 h

// Referenz-Population: 22 aktive Menschen, heavy-tailed wie eine echte Stadt.
// Enthält bewusst den Neuling (0 Follower) und den „Whale" (800) aus der
// ursprünglichen Verifikation, damit die Zahlen vergleichbar bleiben.
const FOLLOWERS = [
  0, 0, 1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 250, 400, 800,
];

const weight = (f) => 1 + Math.log(1 + f);
// Efraimidis-Spirakis, 1:1 wie in SQL: schluessel = random()^(1/w), groesste gewinnen.
const key = (f) => Math.pow(Math.random(), 1 / weight(f));

/** Zieht `n` Gewinner gewichtet ohne Zuruecklegen aus `cands` ({user, followers}). */
function drawWeighted(cands, n) {
  if (n <= 0 || cands.length === 0) return [];
  return cands
    .map((c) => ({ c, k: key(c.followers) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, n)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// ALTES MODELL: eine Ziehung pro Tag um 21:00, `slots` Momente, eingefroren.
// Ein Moment wird von genau EINER Ziehung gesehen (Ziehungen liegen 24 h
// auseinander, genau wie die Lebensdauer).
// ---------------------------------------------------------------------------
function simulateDaily(slots) {
  const posted = FOLLOWERS.map(() => 0);
  const drawn = FOLLOWERS.map(() => 0);

  for (let day = 0; day < DAYS; day++) {
    // Jeder postet einmal am Tag zu zufaelliger Zeit; Kandidat der Ziehung ist,
    // wessen Moment um 21:00 noch lebt — bei einem Post pro Tag also jeder.
    const cands = FOLLOWERS.map((f, user) => {
      posted[user]++;
      return { user, followers: f };
    });
    for (const w of drawWeighted(cands, slots)) drawn[w.user]++;
  }
  return FOLLOWERS.map((f, u) => ({ followers: f, share: drawn[u] / posted[u] }));
}

// ---------------------------------------------------------------------------
// NEUES MODELL: `slots` Plaetze, jede Minute Nachbesetzung (refill_corso).
// Eine Belegung endet exakt dann, wenn ihr Moment 24 h alt wird — der Slot wird
// frei und der naechste passende Moment rueckt nach.
// Regeln 1:1 aus refill_corso(): ein Moment pro Autor im Corso, kein
// Wiedereintritt eines Moments, pro Autor der neueste passende Moment.
// ---------------------------------------------------------------------------
function simulateRunning(slots) {
  const posted = FOLLOWERS.map(() => 0);
  const entered = FOLLOWERS.map(() => 0);
  let occupancyMinutes = 0;
  let entries = 0;

  // Momente: { user, followers, expiresAt, seen } — `seen` = war schon im Corso.
  let moments = [];
  const occupied = new Map(); // slot -> { user, expiresAt, enteredAt }

  // Postzeitpunkte fuer den ganzen Lauf vorbereiten: jeder postet einmal pro Tag.
  const postAt = new Map(); // Minute -> [user, ...]
  for (let day = 0; day < DAYS; day++) {
    FOLLOWERS.forEach((_, user) => {
      const t = day * MIN_PER_DAY + Math.floor(Math.random() * MIN_PER_DAY);
      if (!postAt.has(t)) postAt.set(t, []);
      postAt.get(t).push(user);
    });
  }

  const total = DAYS * MIN_PER_DAY;
  for (let t = 0; t < total; t++) {
    // Neue Momente
    for (const user of postAt.get(t) ?? []) {
      posted[user]++;
      moments.push({ user, followers: FOLLOWERS[user], expiresAt: t + LIFETIME, seen: false });
    }

    // (1) Belegungen schliessen, deren Moment 24 h erreicht hat
    for (const [slot, occ] of occupied) {
      if (occ.expiresAt <= t) {
        occupancyMinutes += t - occ.enteredAt;
        occupied.delete(slot);
      }
    }

    // Tote Momente aus dem Kandidaten-Topf werfen (Speicher + Laufzeit)
    if (t % 60 === 0) moments = moments.filter((m) => m.expiresAt > t);

    // (2) Kandidaten: lebend, noch nie im Corso, Autor belegt keinen Slot.
    //     Pro Autor nur der NEUESTE passende Moment.
    const busy = new Set([...occupied.values()].map((o) => o.user));
    const newestPerUser = new Map();
    for (const m of moments) {
      if (m.expiresAt <= t || m.seen || busy.has(m.user)) continue;
      const prev = newestPerUser.get(m.user);
      if (!prev || m.expiresAt > prev.expiresAt) newestPerUser.set(m.user, m);
    }

    // (3) Freie Slots gewichtet nachbesetzen
    const free = [];
    for (let s = 0; s < slots; s++) if (!occupied.has(s)) free.push(s);
    if (free.length === 0 || newestPerUser.size === 0) continue;

    const winners = drawWeighted([...newestPerUser.values()], free.length);
    winners.forEach((m, i) => {
      m.seen = true;
      entered[m.user]++;
      entries++;
      occupied.set(free[i], { user: m.user, expiresAt: m.expiresAt, enteredAt: t });
    });
  }

  return {
    rows: FOLLOWERS.map((f, u) => ({ followers: f, share: entered[u] / posted[u] })),
    avgOccupancyHours: occupancyMinutes / Math.max(entries, 1) / 60,
    entriesPerDay: entries / DAYS,
  };
}

// ---------------------------------------------------------------------------
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pick = (rows, f) => rows.find((r) => r.followers === f);

const old8 = simulateDaily(8);
const new8 = simulateRunning(8);
const new10 = simulateRunning(10);

console.log(
  `\nCorso — Auswahl-Verifikation  (${DAYS} simulierte Tage, ${FOLLOWERS.length} aktive Menschen)`,
);
console.log(`Gewicht: w = 1 + ln(1 + Follower), Ziehung ohne Zuruecklegen (Efraimidis-Spirakis)\n`);

const table = [
  ["Follower", "ALT 21:00 (8)", "NEU laufend (8)", "NEU laufend (10)"],
  ["--------", "-------------", "---------------", "----------------"],
];
for (const f of [0, 8, 50, 150, 400, 800]) {
  table.push([
    String(f).padStart(8),
    pct(pick(old8, f).share).padStart(13),
    pct(pick(new8.rows, f).share).padStart(15),
    pct(pick(new10.rows, f).share).padStart(16),
  ]);
}
for (const row of table) console.log("  " + row.join("  "));

const ratio = (rows) => pick(rows, 800).share / pick(rows, 0).share;
console.log(`\n  Spreizung Whale(800) / Neuling(0):`);
console.log(`    ALT 21:00,  8 Slots : ${ratio(old8).toFixed(2)}x`);
console.log(`    NEU laufend, 8 Slots: ${ratio(new8.rows).toFixed(2)}x`);
console.log(`    NEU laufend, 10 Slots: ${ratio(new10.rows).toFixed(2)}x`);

console.log(`\n  Durchsatz im laufenden Modell (10 Slots):`);
console.log(`    Einzuege pro Tag        : ${new10.entriesPerDay.toFixed(1)}`);
console.log(`    mittlere Standzeit      : ${new10.avgOccupancyHours.toFixed(1)} h`);
console.log("");
