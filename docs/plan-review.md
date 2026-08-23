# Plan-Review — Aquaman (Stand 2026-08-23)

> Review der Planungsartefakte vor Build-Start: `docs/research-Aquaman.md`,
> `docs/PRD-Aquaman-MVP.md` (v1.1), `docs/TechDesign-Aquaman-MVP.md` (v1.0),
> `AGENTS.md`, `CLAUDE.md`, `agent_docs/*`, `MEMORY.md`, `REVIEW-CHECKLIST.md`,
> `.claude/*`, `.agents/*`.
>
> Legende: **B** = Blocker (vor Build klären) · **I** = Inkonsistenz zwischen
> Dokumenten · **R** = Risiko/Lücke · **Q** = Qualität der Doku

---

## 0. Gesamturteil

Die Grundarchitektur ist tragfähig und für einen Level-A-Owner richtig gewählt:
Next.js-Monolith + SQLite + Drizzle, Domänenlogik als pure Funktionen in
`src/lib/domain/*`, Approval-Gate als Sicherheitsgrenze, Cost-Ceiling, harter
Fallback ohne AI, Soft-Delete, sauberes `.gitignore`. Die Gotchas-Sektion in
`AGENTS.md` ist ungewöhnlich gut — sie beschreibt echte Fallen statt
Allgemeinplätze.

**Nicht stimmig sind vor allem drei Dinge:**

1. Das **Kern-Feature (Auto-Reschedule) widerspricht dem Catch-up-Modus** und
   macht die wichtigste Erfolgsmetrik unmessbar.
2. Die **MCP-Sicherheitsregel widerspricht sich selbst** („Read-Tools frei" vs.
   „Endpoint Bearer-geschützt") — in der freien Variante wären alle Daten und
   das AI-Budget öffentlich.
3. Das **Datenmodell ist an zwei Stellen Postgres, nicht SQLite** — das bricht
   sofort beim ersten `drizzle-kit generate`.

Dazu kommen ~15 Doku-Widersprüche (Pfade, Env-Namen, MUST-vs-Nice-to-have) und
ein spürbar korruptes Research-Dokument, aus dem ein Agent falsche Tool-Namen
abschreiben wird.

---

## 1. Blocker — logische Widersprüche im Kern

### B1 — Auto-Reschedule hebelt den Catch-up-Modus aus

- PRD §5.3: Auto-Reschedule ist **Default an** und schiebt überfällige Aufgaben
  automatisch auf den nächsten passenden Tag.
- PRD §5.3 / TechDesign §4.2: Catch-up-Modus triggert, **wenn > 5 Aufgaben
  überfällig sind**.

Beides zusammen kann nie eintreten: Wenn Auto-Reschedule bei jedem
Dashboard-Load Überfälliges nach vorne schiebt, ist *nie* etwas überfällig — der
Zähler erreicht die 5 nie, die Catch-up-Karte erscheint nie. Genau der Fall, für
den das Feature gebaut wurde (Stress-Woche), wird durch das Feature unsichtbar.

**Fix-Vorschlag:** Zwei getrennte Begriffe im Modell führen —
- `originalDueAt` (bleibt stehen, wird nie verschoben) → Basis für „Rückstand",
  Catch-up-Priorisierung und AI-Kontext
- `plannedFor` (verschiebbar) → Basis für Dashboard-Anzeige und ICS

„Überfällig" heißt dann `today - originalDueAt > 0`, „nicht rot markiert" ist
eine reine UI-Entscheidung. Zusätzlich `rescheduleCount` mitzählen: nach z. B.
3 automatischen Verschiebungen fragt die App einmal freundlich nach
(„Intervall zu eng?"), statt endlos zu schieben.

### B2 — Auto-Reschedule macht die Haupt-Erfolgsmetrik unfalsifizierbar

PRD §6, Metrik 1: *„0 dauerhaft verpasste Pflege-Termine (Snooze/Auto-Reschedule
zählt als 'gehandelt')"*. Da Auto-Reschedule per Default **automatisch** läuft,
ist jede Aufgabe per Definition „gehandelt" — die Metrik ist immer erfüllt und
misst nichts.

**Fix:** Metrik auf etwas Messbares umstellen, z. B. „Median-Verzug zwischen
`originalDueAt` und tatsächlichem `doneAt` pro Aktionstyp < X Tage" und
„Anzahl Aufgaben mit `rescheduleCount ≥ 3`". Beides fällt in den Daten sowieso
an. Ebenso Metrik „Dashboard-Check ≥ 1×/Tag": ohne Telemetrie (explizit nicht
gewollt) nicht messbar — entweder streichen oder aus `maintenanceLogs`
ableiten.

### B3 — MCP: „Read-Tools frei" ist ein offener Datenabfluss

Widerspruch zwischen den Dokumenten:

| Quelle | Aussage |
|---|---|
| Research §2.7, §7.1 | „Read-Tools immer erlaubt, Write-Tools nur mit Token-Schutz" |
| PRD §5.7, §9 | „Read-Tools frei, Write-Tools nur mit Token" |
| TechDesign §4.6 | „Token-Schutz: `Authorization: Bearer <MCP_TOKEN>`" (Endpoint-Ebene) |

Wenn „Read frei" wörtlich gilt, kann jeder im Internet unter
`https://aquaman.cadex64.de/api/mcp` alle Tankdaten, Messwerte und Logs
abrufen — die App hat in v1 **keine andere Auth**. Schlimmer: `ask_coach` ist
ein Read-artiges Tool und würde fremden Traffic direkt gegen dein AI-Budget
laufen lassen (Cost-Ceiling schützt die Rechnung, aber der Coach ist dann für
dich tot).

**Fix:** Der **gesamte** `/api/mcp`-Endpoint ist Bearer-gated. Die
Read/Write-Unterscheidung bleibt trotzdem sinnvoll, aber als *zweite* Ebene
(z. B. zwei Tokens: read-only und read-write), nicht als „ohne Token".
Dokumente entsprechend angleichen, das ist aktuell an drei Stellen falsch.

### B4 — Datenmodell benutzt Postgres-Typen auf SQLite

TechDesign §4.2 / §6:
- `preferredDays: int[]` — **SQLite hat keinen Array-Typ.**
- `values: jsonb`, `plants(jsonb)`, `paramOverrides(jsonb)` — **SQLite hat
  keinen `jsonb`-Spaltentyp** (die `jsonb_*`-Funktionen ab 3.45 sind etwas
  anderes; Drizzle-SQLite kennt `text({ mode: 'json' })` bzw. `blob`).

Das bricht beim ersten Schema-Schreiben. Ein AI-Agent, der die Tabelle im
TechDesign wörtlich abschreibt, produziert einen nicht generierbaren Schema-File.

**Fix:** Im TechDesign explizit festlegen:
`preferredDays` als `text({mode:'json'})` (`number[]`) **oder** als 7-Bit-Maske
`integer` (kompakter, sortierbar, keine JSON-Parsing-Kosten in `nextDue()`);
alle `jsonb` → `text({ mode: 'json' })`.

### B5 — ICS-Feed liefert einen veralteten Plan (und ein schreibendes GET)

TechDesign §9: *„Auto-Reschedule läuft on-demand beim Dashboard-Load"*.
PRD §5.5: *„Snooze/Auto-Reschedule fließen automatisch in den ICS-Feed ein"*.

Google Calendar ruft `/api/calendar.ics` ab, **ohne** dass jemand das Dashboard
öffnet. Nach einer Woche ohne App-Nutzung — also genau im Stress-Szenario —
liefert der Feed den nicht-rescheduleten, alten Plan aus. Zusätzlich:
`Cache-Control: max-age=3600` auf einer Route, die in der Datenbank schreibt,
ist ein Seiteneffekt-GET (Proxy/Google-Cache kann den Write beliebig oft oder
gar nicht auslösen).

**Fix (empfohlen):** Auto-Reschedule als **reine Projektion beim Lesen**
implementieren, nicht als Write. `nextDue()` bekommt die Reschedule-Regel
eingebaut und ist damit für Dashboard, ICS und MCP identisch — kein Write, kein
Cron, kein Stale-State, und die Funktion bleibt zu 100 % unit-testbar.
Persistiert wird nur, was der Mensch tut (Done, Snooze).

### B6 — Keine Zeitzone im gesamten Plan

Die App ist vollständig datumsgetrieben, aber weder PRD noch TechDesign noch
`.env`-Liste kennen eine Zeitzone.

- `AGENTS.md` sagt „UTC-noon day arithmetic" — das ist eine gute Heuristik, löst
  aber nicht „Was ist **heute** fällig?" für einen Nutzer in Europe/Berlin, der
  um 23:30 aufs Handy schaut.
- „AI pausiert **bis Mitternacht**" (PRD §5.6, TechDesign §4.5): Mitternacht in
  welcher Zone? `aiCalls.day` braucht dieselbe Antwort.
- ICS All-Day-Events sind zonenfrei — gut —, aber der *Tag*, an dem sie landen,
  wird serverseitig bestimmt.

**Fix:** `APP_TIMEZONE` (Default `Europe/Berlin`) als Env-Variable, ein einziger
Helper `startOfLocalDay(date, tz)` in `src/lib/domain/`, und alle „heute"-
Entscheidungen (Due, ICS-Tag, AI-Tageslimit) gehen ausschließlich darüber.

### B7 — ICS: keine Strategie für UIDs, Wiederholung und Horizont

`nextDue()` liefert **einen** nächsten Termin. Der Feed soll aber **90 Tage**
Events enthalten (TechDesign §4.4). Ungeklärt:

- Wird als `RRULE` ausgegeben oder als expandierte Einzel-VEVENTs?
  (Snooze betrifft nur *eine* Occurrence → mit RRULE brauchst du
  `RECURRENCE-ID`+`EXDATE`, das ist deutlich mehr Aufwand als es klingt.)
- **Stabile `UID`s** sind nicht spezifiziert. Wenn die UID sich bei jeder
  Generierung ändert, zeigt Google Calendar Duplikate oder verliert Termine —
  das ist *der* klassische ICS-Bug und trifft ein MUST-Feature.
- `DTSTAMP`, `SEQUENCE` (Änderungen an bestehenden Events) fehlen.

**Fix:** Expandierte VEVENTs (kein RRULE) mit deterministischer UID
`{scheduleId}-{plannedDateISO}@aquaman` und `SEQUENCE` aus einem
`updatedAt`-Zähler. Dazu ein Unit-Test „gleiche Daten → byte-identischer Feed"
und „Snooze verschiebt Event, erzeugt kein zweites".

---

## 2. Inkonsistenzen zwischen den Dokumenten

| # | Thema | Widerspruch | Empfehlung |
|---|---|---|---|
| I1 | MCP-Pfad | Research + PRD §5.7: `/mcp` · TechDesign §3/§4.6/§11 + `agent_docs`: `/api/mcp` | Auf `/api/mcp` vereinheitlichen, PRD korrigieren |
| I2 | Env-Namen | Research: `AQUAMAN_AI_BASE_URL/_API_KEY/_MODEL` · TechDesign/AGENTS: `AI_BASE_URL/AI_API_KEY/AI_MODEL`, aber `AQUAMAN_AI_MAX_CALLS_PER_DAY` | Durchgängig `AQUAMAN_`-Präfix. `AI_API_KEY` ist in einem geteilten Docker-Env zu generisch (Kollisionsgefahr) |
| I3 | MCP-Auth-Form | TechDesign §4.6: Bearer-Header · §11.4: `https://<mcp-token>@host/api/mcp` (URL-Userinfo) | Nur Bearer. URL-Userinfo ist deprecated und wird von vielen Clients verworfen |
| I4 | JSON-Export | PRD §5.9 + JSON-Block: *nice-to-have* · PRD §11 DoD: Pflicht-Checkbox | Entscheiden — Export ist billig und passt zum „kein Lock-in"-Versprechen, also eher MUST |
| I5 | Catch-up-Modus | PRD §5.3: Teil eines MUST-Features · PRD JSON-Block: `niceToHave` · `agent_docs/product_requirements.md`: MUST | Eine Zuordnung wählen (siehe auch B1) |
| I6 | MCP-Priorität | Research §4.1: **SHOULD** · PRD: **MUST** | Scope ist zwischen Step 1 und 2 gewachsen, unkommentiert — bewusst entscheiden (siehe §5) |
| I7 | Sprache/i18n | PRD §7: „Deutsch als zweite Sprache (**v2-final**)" · TechDesign §5 + AGENTS-Gotcha: `de.json` von Anfang an, „bricht die deutsche Locale still" | Klarstellen: i18n-*Struktur* in v1, `de.json` gepflegt ab wann? |
| I8 | MEMORY.md | `CLAUDE.md`: „**Do not** add instructions to manually update a `MEMORY.md`" · `MEMORY.md` existiert und sagt „Update this after major decisions" | Direkter Selbstwiderspruch. Entweder `MEMORY.md` löschen oder die Regel in `CLAUDE.md` streichen |
| I9 | Skills doppelt | `.agents/skills/` und `.claude/skills/` sind Kopien — und **schon jetzt gedriftet** (`vibe-build`, `vibe-review` unterscheiden sich) | Eine Quelle, die andere als Symlink oder gelöscht |
| I10 | agent_docs vs. docs | `agent_docs/product_requirements.md` dupliziert die PRD; sie widersprechen sich bereits bei I5 | `agent_docs` auf Verweise + Deltas reduzieren, nicht kopieren |
| I11 | Read-first-Reihenfolge | `AGENTS.md`: PRD → TechDesign → brief → stack → testing · `CLAUDE.md`: AGENTS → brief → stack → testing (PRD/TechDesign fehlen, `code_patterns.md` fehlt in beiden Listen) | Angleichen |
| I12 | Review-Checkliste | „Auth-protected routes and actions were tested while logged out" — es gibt in v1 **keine** Auth | Item ersetzen durch: „Token-geschützte Endpoints (`/api/calendar.ics`, `/api/mcp`) mit falschem/fehlendem Token getestet → 401/404" |
| I13 | AGENTS.md-Template | Enthält noch Meta-Anweisungen („How to fill this in", „Delete this section unless…", „If this file still has bracketed placeholders…") | Löschen — die Datei wird in *jeder* Session geladen, das sind ~15 verschwendete Zeilen und sie widerspricht ihrer eigenen Regel |
| I14 | testing.md | „Single test: `npm test`" ist ein nicht ausgefüllter Platzhalter | `npm test -- <pfad>` (Vitest) |
| I15 | Setup-Checkliste | TechDesign §3 springt von 4 auf 6 — Schritt 5 fehlt | Vermutlich „ESLint/Prettier" oder „next-intl"; ergänzen |

---

## 3. Risiken & Lücken (fachlich / technisch)

### R1 — Die Wasserwert-Referenzen sind an den kritischen Stellen zu grob

Diese Zahlen landen in `ranges.ts` und damit direkt im AI-Prompt. Falsche
Grenzwerte → falsche Empfehlung → tote Fische. Zwei Punkte aus Research §1.3:

- **NH3/NH4 als *ein* Feld mit Ziel „< 0,5 mg/l"**: Ammonium (NH4⁺) ist
  weitgehend harmlos, freies Ammoniak (NH3) ist ab ca. **0,02 mg/l** schädlich.
  Welcher Anteil vorliegt, hängt von **pH und Temperatur** ab. Ein
  Gesamt-Wert von 0,5 mg/l ist bei pH 6,5 unkritisch und bei pH 8,2 akut
  tödlich. Ein einzelner Grenzwert kann das nicht abbilden.
- **NO2 Ziel „< 0,3 mg/l"** ist zu lax: In einem eingefahrenen Becken gehört
  Nitrit bei **0**; ab ~0,1–0,2 mg/l ist bereits etwas im Argen.

**Fix:** (a) NH3 aus Gesamt-Ammonium + pH + Temperatur berechnen (eine kleine
pure Funktion in `ranges.ts`, gut testbar) und *diesen* Wert bewerten;
(b) NO2/NH3-Zielbereiche verschärfen; (c) ein `tankState`-Feld
(`cycling` | `established`) einführen — im Einfahrbetrieb sind NO2-Peaks normal
und die AI darf nicht in Panik verfallen. Punkt (c) fehlt im Plan komplett.

### R2 — Füttern (1–2×/täglich) passt nicht ins Schedule-Modell

Research §1.4 listet Füttern als 1–2×/Tag; `intervalDays` ist ein Integer ≥ 1 —
zweimal täglich ist nicht darstellbar. Und selbst 1×/Tag erzeugt im ICS über
90 Tage **90 All-Day-Events pro Tank**, die den Google-Kalender zumüllen.

**Fix:** `intervalDays` durch `{ unit: 'day'|'week', every: n, timesPerDay: n }`
ersetzen *oder* Füttern bewusst als eigenen, ICS-freien „Daily Habit"-Typ
behandeln (Checkbox auf dem Dashboard, kein Kalendereintrag). Zweites ist
einfacher und passt besser zur Realität.

### R3 — `snoozedUntil` ist mit zwei Bedeutungen überladen

Nutzer-Snooze („ich will das am Wochenende machen") und System-Reschedule
(„du warst zu beschäftigt") schreiben in dasselbe Feld. Damit lässt sich weder
in der UI unterscheiden noch dem AI-Coach erklären, noch ein System-Bump
rückgängig machen. Siehe B1 — mit `originalDueAt`/`plannedFor` + `snoozeSource`
löst sich das mit.

### R4 — Öffentliche Token-Endpoints ohne Rate-Limiting

`/api/calendar.ics?t=…` und `/api/mcp` sind die einzigen öffentlich erreichbaren
Türen einer sonst auth-losen App. Der Plan nennt „32-Zeichen-Secret", aber
nirgends Rate-Limiting oder Brute-Force-Schutz. Die Review-Checkliste fragt
danach („Rate limiting … considered"), der Plan beantwortet es nicht.

**Fix:** Token kryptographisch zufällig (`crypto.randomBytes(24).toString('base64url')`),
Vergleich in konstanter Zeit, plus ein simpler In-Memory-Limiter (z. B. 30
Fehlversuche/IP/Stunde → 429). Bei ungültigem Token **404** statt 401
zurückgeben, damit die Existenz des Feeds nicht bestätigt wird.

### R5 — `ports: ["3000:3000"]` umgeht die Reverse-Proxy-Auth

TechDesign §11.2 published Port 3000 auf dem NAS. Die gesamte v1-Sicherheit
beruht laut Plan auf Basic-Auth/Authelia **im Reverse Proxy** — wer im LAN
direkt `http://nas:3000` aufruft, umgeht das vollständig.

**Fix:** `ports: ["127.0.0.1:3000:3000"]` oder gar kein Port-Mapping und der
Proxy hängt im selben Docker-Netz. Gehört als fetter Hinweis ins README.

### R6 — Konkrete Deployment-Fallen, die noch nicht im Plan stehen

Alle vier kosten erfahrungsgemäß je einen halben Abend:

1. **`better-sqlite3` + Next.js standalone**: braucht `output: 'standalone'`
   und `serverExternalPackages: ['better-sqlite3']`, sonst versucht der Bundler
   das native Modul zu packen. Zusätzlich muss das Native-Binary für die
   Runtime-Arch gebaut sein (Build-Stage und Runner-Stage gleiche Basis!).
2. **`sharp`** hat dieselbe Native-Problematik; bei Multi-Arch-Images (falls das
   NAS arm64 ist) müssen beide Module pro Plattform gebaut werden.
3. **Healthcheck `wget`**: existiert in Alpine (busybox), **nicht** in
   `node:*-slim` (Debian). Entweder Base-Image festlegen oder
   `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1))"`.
4. **Server-Action-Body-Limit**: Next.js erlaubt default **1 MB**; der Plan
   nennt 5 MB Foto-Upload (TechDesign §4.1). Ohne
   `experimental.serverActions.bodySizeLimit` schlägt jeder größere Upload fehl.
   Außerdem: `/api/uploads/[...]` braucht harte Path-Traversal-Absicherung, da
   der Pfad aus der URL kommt.

Diese vier gehören in die `Gotchas`-Sektion von `AGENTS.md`, *bevor* der Build
startet — dort wirken sie, im TechDesign werden sie überlesen.

### R7 — Cost-Ceiling deckelt Calls, nicht Kosten

`AQUAMAN_AI_MAX_CALLS_PER_DAY=20` begrenzt die Anzahl. Ein Coach-Chat ist aber
mehrstufig mit wachsendem Kontext — Call 20 kann das Zehnfache von Call 1
kosten. Die `aiCalls`-Tabelle erfasst Tokens bereits; der Deckel sollte sie
auch nutzen (`AQUAMAN_AI_MAX_TOKENS_PER_DAY` als zweite, harte Grenze). Bei
Streaming (TechDesign §4.5) muss die `usage`-Angabe aus dem finalen Event
gelesen werden, sonst zählst du gar nichts.

---

## 4. Qualität der Dokumente

### Q1 — `docs/research-Aquaman.md` ist an ~15 Stellen korrupt

Das ist nicht nur kosmetisch: Ein Agent, der die MCP-Tool-Namen aus §2.3
abschreibt, generiert **falsche Tool-Namen**.

Gefundene Artefakte:

- `AUmAMAN_AI_API_KEY` (§2.2) — soll `AQUAMAN_AI_API_KEY` heißen
- `mamm__get_pending_maintenance`, `mcp__get_water_values`, `mcp__add_water_test`
  (§2.3) — inkonsistente/kaputte Präfixe; PRD und TechDesign nennen sie korrekt
  ohne Präfix
- Überschriften: `### 2./MCP-Integration`, `###  doc 2.6`, `### 3. Key 3.2`,
  `**### 2.5 Docker…`
- `20226-02` (Quellenangabe MCP-Spec)
- `~$/model15/M tokens` (Claude-Sonnet-Output-Preis)
- `-API 0 €` (ghcr.io-Zeile)
- `refreshBeachten:`, `Glaskar... / Glas reinigen`, `keineExtra-Tabellen`
- Homebox-Quelle: `https://github.com/sysctl-labs/hints homebox` — kaputte URL
  (das Projekt liegt unter `sysadminsmedia/homebox`)
- MoSCoW-Tabelle §4.1 ist strukturell zerstört: `| ** Pflegeplan** |`,
  `| **M4.1 MoSCoW**`, `| **CO-END | ... |`, und
  `| **SHOULD** | Firebase-Sync irgendwo... | (verworfen — kein Cloud-Zwang) |`
  steht als SHOULD *und* als verworfen in derselben Zeile
- PRD §3: „Wie hole ich **stresslose** wieder auf?", „doppelt/doppelt verpasst"
- TechDesign §5: „keine/notification-Erschöpfung"

**Empfehlung:** Research-Dokument einmal komplett durchgehen und bereinigen,
oder — pragmatischer — es als „historisch, nicht maßgeblich" markieren und
`AGENTS.md` Read-First auf PRD + TechDesign beschränken. Aktuell steht es aber
in beiden Dokumenten als Grundlage.

### Q2 — Research ist 6 Monate alt, die Preise sind es auch

Research-Stand: **Februar 2026**. Heute: **August 2026**. Betroffen sind genau
die Angaben, die schnell veralten:

- Modell-IDs `claude-sonnet-4-5`, `glm-4.6` als Defaults im TechDesign §8
- Preistabelle §3.1 (das Dokument warnt selbst: „vor Launch prüfen")
- Aussage „z.ai ist Anthropic-Messages-kompatibel" — vor dem Build einmal gegen
  die aktuelle z.ai-Doku verifizieren, daran hängt die gesamte
  Ein-Code-Pfad-Strategie
- Konkurrenzpreise §1.1

Das ist kein Blocker, aber die Defaults im Code sollten **jetzt** verifiziert
werden, nicht erst beim Launch.

---

## 5. Scope & Zeitplan — der ehrliche Teil

**2–4 Wochen Freizeit-Tempo für neun MUST-Features ist deutlich zu optimistisch.**
Die MUST-Liste enthält mindestens vier eigenständige Teilprojekte:

| Feature | Realistischer Aufwand (Freizeit, Level A) |
|---|---|
| Scheduler + Snooze + Auto-Reschedule + Tests | 4–6 Abende (Datumsmathematik ist der Bug-Hotspot #1, das sagt der Plan selbst) |
| ICS-Feed korrekt (UIDs, Snooze, Google-Verhalten) | 3–4 Abende + Wartezeit auf Google-Refresh beim Testen |
| AI-Coach + Tool-Use + Approval-UI + Cost-Guard | 4–5 Abende |
| MCP-Server + OpenClaw-Verdrahtung | 2–3 Abende, davon die Hälfte Debugging fremder Clients |
| Tanks, Wasserwerte, Charts, Mobile-UI, i18n | 5–7 Abende |
| Docker, CI, ghcr, TrueNAS, Reverse Proxy | 2–4 Abende |

**Empfehlung:** MCP aus dem MVP nehmen (im Research war es korrekterweise noch
SHOULD, siehe I6). Es ist das einzige MUST, dessen Ausfall **keine** tägliche
Funktion kostet — Dashboard und ICS beantworten „Was ist heute zu tun?" bereits.
Die Domänenschicht ist ohnehin API-first geplant, MCP lässt sich in v1.1 in
zwei Abenden nachrüsten. Ebenso: `de.json` erst füllen, wenn die UI steht
(Struktur ja, Übersetzung später).

**Phasenreihenfolge korrigieren:** Research §6 legt Docker in **Phase 4**. Das
ist der klassische Selfhosting-Projekt-Killer — der erste `docker compose up`
auf dem echten NAS deckt native Module, Arch, Volumes, Proxy und Healthcheck
auf einmal auf, und zwar am Ende, wenn keine Zeit mehr ist. Besser: ein
**dünner vertikaler Schnitt in Phase 1** (leere Next.js-App + SQLite-Volume +
Healthcheck + CI + Image auf TrueNAS deployed), danach Features. Ab da ist
jedes Feature nur noch ein `docker compose pull`.

---

## 6. Was gut ist (nicht ändern)

- **Domänenkern als pure Funktionen** in `src/lib/domain/*`, geteilt von
  Server Actions, API-Routen und MCP — die richtige Entscheidung, und sie macht
  genau die riskante Datumsmathematik testbar.
- **„Auto-Reschedule schreibt NIE in `maintenanceLogs`"** — die Pflegehistorie
  nicht zu fälschen ist die wichtigste einzelne Regel im ganzen Plan, weil sie
  gleichzeitig Datenintegrität und AI-Kontext schützt.
- **Approval-Gate als explizit benannte Sicherheitsgrenze** in einer auth-losen
  App — sauber durchdacht, konsistent in PRD, TechDesign, AGENTS und
  `code_patterns.md`.
- **Kein Agent-Loop in-app** (Single-Call mit Kontext) — deterministisch,
  günstig, testbar; die Orchestrierung bleibt beim externen Client.
- **Fallback ohne AI** ist überall mitgedacht, inkl. UI-Zustand.
- **Structured Output nur via Tool-Use + zod, „reject, never repair"** — genau
  richtig.
- **Soft-Delete** wegen referenzierender Logs.
- **SQLite als Datei + Volume-Snapshot** — für den Anwendungsfall die richtige
  Wahl, Backup-Story ist trivial und dokumentiert.
- Die **Gotchas-Sektion** in `AGENTS.md` beschreibt echte Fallen (UTC-noon,
  `SQLITE_BUSY` bei Hot Reload, `drizzle-kit generate` vergessen) statt
  Allgemeinplätze. Genau so soll die Datei aussehen.

---

## 7. Empfohlene Reihenfolge vor Build-Start

1. **B1/B3/B4/B5/B6** entscheiden und in PRD + TechDesign einarbeiten
   (Datenmodell `originalDueAt`/`plannedFor`, MCP komplett token-gated,
   SQLite-Typen, Reschedule als Projektion, `APP_TIMEZONE`).
2. **B7** ICS-Strategie (expandierte VEVENTs, deterministische UIDs) festschreiben.
3. **R1** Wasserwert-Ranges korrigieren (NH3-Berechnung, NO2 verschärfen,
   `cycling`-Zustand) — das ist Fachlogik, die später niemand mehr hinterfragt.
4. **R6** die vier Deployment-Fallen in die `AGENTS.md`-Gotchas aufnehmen.
5. **I1–I15** in einem Durchgang bereinigen (v1.2 der PRD, v1.1 des TechDesign).
6. **Q1** Research bereinigen oder als „historisch" markieren; **Q2** Modell-IDs
   und Preise gegen die aktuellen Anbieterseiten verifizieren.
7. **Scope-Entscheidung** treffen: MCP in v1 oder v1.1?
8. Erst dann Phase 1 — und zwar als vertikaler Schnitt inklusive Docker/CI/NAS.

---

# Nachprüfung der eingearbeiteten Korrekturen

> Geprüft gegen Commit `8550677` („docs: incorporate plan review — PRD v1.2,
> TechDesign v1.1"), Stand 2026-08-23. Basis: PRD v1.2, TechDesign v1.1,
> `AGENTS.md`, `agent_docs/*`, `MEMORY.md`, `REVIEW-CHECKLIST.md`, Skills.

## N.0 Ergebnis

**28 von 30 Punkten sind sauber erledigt** — mehrere davon besser als
vorgeschlagen (die Verlegung von Auto-Reschedule in eine reine Lese-Projektion
löst B1, B5 und die ICS-Aktualität in einem Zug).

**Ein Punkt ist offen und hat sich durch den Fix vergrößert: B7 (ICS-UIDs).**
Die Kombination aus „UID enthält das geplante Datum" (B7-Fix) und „`plannedFor`
driftet täglich" (B5-Fix) erzeugt ein Problem, das vorher nicht existierte.

**Zwei Punkte sind neu entstanden**, beide im Datenmodell der Scheduling-Fixes
(`rescheduleCount` nicht berechenbar; `originalDueAt` ignoriert `preferredDays`).

Nichts davon zwingt zu Umbau — es sind Präzisierungen in zwei Absätzen des
TechDesign, bevor `scheduler.ts` und `ics.ts` geschrieben werden.

---

## N.1 Offen: B7 — die ICS-UID-Strategie trägt nicht

Der ICS-Teil ist der einzige Fix, der die eigentliche Frage nicht beantwortet.
Vier zusammenhängende Probleme:

### N.1.1 UIDs churnen täglich, nicht nur bei Snooze

TechDesign §4.4 setzt `UID = {scheduleId}-{plannedDateISO}@aquaman` und
begründet die Instabilität so:

> *„stabil über Snooze hinweg? **Nein:** Snooze ändert `plannedFor` → alte UID
> entfällt, neue entsteht. Google behandelt verschwundene UID als gelöschtes
> Event → sauberer Effekt: Event wandert."*

Das übersieht den B5-Fix. Auto-Reschedule ist jetzt eine **Projektion auf
`today`** — `plannedFor` ändert sich also nicht nur bei Snooze, sondern **an
jedem Tag, an dem eine Aufgabe offen bleibt**. Konkret, Wasserwechsel mit
`preferredDays = {Sa, So}`, überfällig seit Montag:

| Tag | `plannedFor` | UID |
|---|---|---|
| Mo | Sa 29.08. | `sched1-2026-08-29@aquaman` |
| Sa 29.08. (nicht erledigt) | So 30.08. | `sched1-2026-08-30@aquaman` ← neu |
| So 30.08. (nicht erledigt) | Sa 05.09. | `sched1-2026-09-05@aquaman` ← neu |

Bei `preferredDays = alle Tage` passiert das **täglich**. Aus Googles Sicht ist
das jedes Mal *Löschen + Neuanlegen*, kein Verschieben:

- Eine vom Nutzer am Event gesetzte Erinnerung ist weg
- Googles ICS-Sync ist nicht transaktional — im Refresh-Fenster sind kurzzeitig
  beide Events sichtbar; genau das Duplikat, das die DoD ausschließt
- Der Effekt trifft die Stress-Woche, also exakt den Fall, für den das Feature
  gebaut wurde

### N.1.2 `SEQUENCE` kann nie feuern

§4.4 setzt `SEQUENCE = scheduleVersion`. `SEQUENCE` ist der iCalendar-Mechanismus
für *„dieses Event (gleiche UID) hat sich geändert"*. Unter dem aktuellen Schema
gibt es diesen Fall nicht: ändert sich das Datum, ändert sich die UID; ändert
sich das Datum nicht, ändert sich nichts. Zusätzlich wird `scheduleVersion` nur
bei Zeilenänderungen hochgezählt — die Reschedule-Drift ist aber gerade *kein*
Write. `SEQUENCE` ist damit tote Konfiguration.

### N.1.3 „byte-identisch" widerspricht `DTSTAMP = now`

Im selben Abschnitt stehen:

> `DTSTAMP = now` (UTC) … → **byte-identisch bei gleichen Daten** (Unit-Test!)

`DTSTAMP` ändert sich per Definition bei jedem Request. Der Test in
`agent_docs/testing.md` („same data → byte-identical feed") kann so nie grün
werden.

### N.1.4 PRD und TechDesign widersprechen sich hier direkt

- PRD §11 (DoD): *„ICS: **stabile UIDs** — Snooze verschiebt Event ohne Duplikat"*
- TechDesign §4.4: *„stabil über Snooze hinweg? **Nein**"*

Die DoD fordert etwas, das das TechDesign explizit ausschließt.

### N.1.5 Empfohlener Fix (ein Absatz)

UID an die **Identität der Occurrence** binden, nicht an ihr aktuelles Datum:

```
UID      = {scheduleId}-{originalDueAtISO}@aquaman   // fix, solange die Occurrence lebt
DTSTART  = plannedFor                                 // bewegt sich
SEQUENCE = Anzahl bisheriger DTSTART-Wechsel dieser UID
DTSTAMP  = stabiler Wert (z. B. schedule.updatedAt), NICHT now
```

Damit ist es ein echtes Verschieben: Google behält das Event, Erinnerungen
bleiben, `SEQUENCE` erfüllt seinen Zweck, es gibt kein Duplikatfenster, und der
Byte-Identitäts-Test wird erfüllbar. `originalDueAt` ist ohnehin bereits als
„bewegt sich nie" definiert (B1) — es ist der natürliche Schlüssel.

### N.1.6 Weiterhin ungeklärt: wie entstehen Occurrence 2…N?

Der ursprüngliche Punkt B7 („`nextDue()` liefert einen Termin, der Feed braucht
90 Tage") ist unbeantwortet geblieben. §4.4 sagt „alle Occurrences je Schedule
expandiert", aber `nextDue()` gibt weiterhin genau ein
`{originalDueAt, plannedFor}` zurück. Es fehlt eine benannte Funktion, etwa
`occurrencesInRange(schedule, from, to)`.

Die dabei zu treffende Entscheidung ist nicht kosmetisch:

| Variante | Basis für Occurrence *n* | Folge |
|---|---|---|
| **A — Kette** | `plannedFor + n × intervalDays` | Driftet die erste Occurrence, driftet die ganze Kette → **alle ~13 UIDs ändern sich täglich** |
| **B — festes Raster** | `originalDueAt + n × intervalDays` | Nur die erste Occurrence bewegt sich; die restlichen 12 bleiben stabil |

**Empfehlung: B.** Das Raster bleibt an der Realität („alle 7 Tage"), nur der
aktuelle Termin wird nachgeplant. Zusammen mit N.1.5 verschwindet der Churn fast
vollständig.

---

## N.2 Neu entstanden: `rescheduleCount` ist so nicht berechenbar

Drei Stellen, drei verschiedene Aussagen:

| Quelle | Aussage |
|---|---|
| PRD §5.3 | „`rescheduleCount` — zählt automatische Verschiebungen; ab ≥ 3 fragt die App" |
| PRD §6, Metrik 1b | „Zähler **pro Schedule**" (impliziert persistiert) |
| TechDesign §4.2 | „**abgeleiteter** Zähler: wie oft `plannedFor > originalDueAt` um > 1 Tag **gewachsen ist**, seit `lastDoneAt`" |

Und: im Schema (TechDesign §4.2 und §6) gibt es **keine Spalte** dafür.

Das Problem: „wie oft ist `plannedFor` gewachsen" ist eine Aussage über eine
Historie. `plannedFor` wird laut B5-Fix aber **nie persistiert** und ist eine
Funktion von `today`. Aus `(lastDoneAt, intervalDays, preferredDays,
snoozedUntil, today)` lässt sich der heutige Wert berechnen — die Anzahl
vergangener Änderungen nicht. Ein Zähler zu persistieren würde wiederum dem
„Auto-Reschedule schreibt nie" widersprechen.

**Fix:** als reine Formel neu definieren, dann ist es ohne Persistenz berechenbar
und passt zum Rest:

```
missedSlots(schedule, today) =
  Anzahl bevorzugter Wochentage im Intervall (originalDueAt, today]
```

Das misst dasselbe („wie oft hätte es drangekommen sein können"), ist eine pure
Funktion, testbar, und trägt sowohl den „Intervall zu eng?"-Hinweis (≥ 3) als
auch Metrik 1b. Betrifft PRD §5.3, PRD §6 und TechDesign §4.2.

---

## N.3 Neu entstanden: `originalDueAt` ignoriert `preferredDays`

TechDesign §4.2 definiert:

```
originalDue = (lastDoneAt ?? createdAt) + intervalDays
```

— ohne Anpassung an `preferredDays`. Danach wird `plannedFor` über
`nextPreferredDay()` auf einen erlaubten Tag geschoben, `originalDueAt` bleibt
aber der rohe Wert.

Damit kann `originalDueAt` auf einem Tag liegen, an dem die Aufgabe gar nicht
erledigt werden kann. Beispiel: Wasserwechsel, `intervalDays = 10`,
`preferredDays = {Sa, So}`, zuletzt erledigt an einem Samstag → `originalDueAt`
fällt auf einen **Dienstag**; frühester machbarer Termin ist der folgende
Samstag. Der Nutzer ist damit **per Konstruktion 4 Tage „im Rückstand"**, ohne
irgendetwas versäumt zu haben.

Konsequenzen:
- Der „ehrliche Rückstand" (der ganze Sinn von B1) ist systematisch zu hoch
- **Metrik 1a** („Median-Verzug `originalDueAt` → `doneAt` < 2 Tage bei
  Wasserwechsel") ist für jedes Intervall unerreichbar, das kein Vielfaches des
  Wochentags-Rasters ist — die frisch eingeführte Erfolgsmetrik misst dann einen
  Modellierungsartefakt
- Die Catch-up-Priorisierung („je älter der Rückstand, desto wichtiger")
  gewichtet Aufgaben mit ungünstigem Intervall dauerhaft zu hoch

**Fix:** `originalDueAt = nextPreferredDay(lastDoneAt + intervalDays)` — einmal
berechnet, danach unverändert. Der „nie verschoben"-Vertrag bleibt intakt; die
Anpassung passiert bei der Entstehung, nicht nachträglich.

---

## N.4 Kleinere Punkte (je ein bis zwei Zeilen)

| # | Fundstelle | Punkt |
|---|---|---|
| N.4.1 | TechDesign §4.2 | **`nextPreferredDay(today)` — inklusiv oder exklusiv?** Nicht definiert. Ist es exklusiv, wird eine überfällige Aufgabe **an ihrem eigenen bevorzugten Tag** um einen vollen Zyklus (bei „nur Wochenende": eine Woche) weitergeschoben. Semantik explizit festlegen und beide Fälle testen |
| N.4.2 | TechDesign §4.2 / §6 | **`preferredDays == 0`** (kein Tag gewählt) lässt `nextPreferredDay()` endlos suchen. Guard + Validierung „mindestens ein Bit gesetzt" |
| N.4.3 | `AGENTS.md`, Gotchas | Maske ist „Bit 0 = Mo … Bit 6 = So", JS `Date.getDay()` liefert aber **0 = Sonntag**. Die Konvertierung ist eine garantierte Off-by-one-Falle und steht nirgends — gehört als eigene Zeile in die Gotchas, mit Helper in `dates.ts` |
| N.4.4 | TechDesign §4.2 | `snoozeSource: 'user' \| 'system'` — der Wert `'system'` ist tot, seit Auto-Reschedule nichts mehr schreibt. Entweder auf `'user'` reduzieren oder kommentieren, warum der Wert reserviert bleibt |
| N.4.5 | PRD §1, TechDesign §11 | **`APP_TIMEZONE` trägt kein `AQUAMAN_`-Präfix** — genau die Uneinheitlichkeit, die I2 beseitigen sollte. `AQUAMAN_TIMEZONE` |
| N.4.6 | TechDesign §6 | `aiCalls` hat `provider`, `model` und `purpose` verloren (vorher vorhanden). Ohne `model` ist die Kostenschätzung falsch, sobald `AQUAMAN_AI_MODEL` gewechselt wird — und Provider-Wechsel ist ein Kernversprechen des Stacks. Mindestens `model` behalten |
| N.4.7 | TechDesign §8b | `crypto.timingSafeEqual` wirft einen `RangeError`, wenn die Buffer **unterschiedlich lang** sind — ein Angreifer mit falscher Token-Länge löst damit einen 500er aus. Vorher Länge prüfen oder beide Seiten hashen und die Hashes vergleichen |
| N.4.8 | TechDesign §8b | Tippfehler: „`127.0.0.1:3000:3000` **OER** kein Publish" → „ODER" |
| N.4.9 | `docs/research-Aquaman.md` | Der ⚠️-Hinweisblock steht **über** der `# `-Überschrift; in gerenderten Ansichten wirkt das Dokument dadurch titellos. Unter die H1 verschieben |

---

## N.5 Bestätigt erledigt

| Punkt | Status | Beleg |
|---|---|---|
| **B1** Catch-up unerreichbar | ✅ | `originalDueAt`/`plannedFor` getrennt; „Überfällig = `today − originalDueAt > 0`"; Catch-up jetzt auslösbar (PRD §5.3) |
| **B2** Metrik unfalsifizierbar | ✅ | Metrik 1a/1b jetzt aus lokalen Daten ableitbar, ohne Telemetrie (PRD §6) — Einschränkung siehe N.3 |
| **B3** MCP-Datenabfluss | ✅ | Endpoint komplett bearer-gated, „keine freien Read-Tools" explizit begründet; zusätzlich auf v1.1 verschoben; in PRD, TechDesign, `agent_docs` und `AGENTS.md` konsistent |
| **B4** Postgres-Typen | ✅ | `text({mode:'json'})` + 7-Bit-Maske, in Schema, `AGENTS.md` und `tech_stack.md` gespiegelt |
| **B5** ICS liefert alten Plan | ✅ | Bester Fix im Commit: reine Lese-Projektion, kein Write, kein Cron, kein Seiteneffekt-GET; Dashboard/ICS/MCP teilen `nextDue()` |
| **B6** Keine Zeitzone | ✅ | `APP_TIMEZONE`, `dates.ts` (Intl-basiert), Verbot von `setHours(0,0,0,0)`, Tests für Mitternachtsgrenze + Sommerzeit (Namensnit: N.4.5) |
| **B7** ICS-Strategie | ⚠️ | siehe N.1 — teilweise beantwortet, Kern offen |
| **R1** NH3/NO2-Grenzwerte | ✅ | `nh3FromNh4(nh4, ph, tempC)` nach Emerson et al. 1975 (korrekte Quelle), kritisch ab 0,02 mg/l; NO2-Ziel 0; `tankState: cycling\|established` inkl. Eval-Prompt „NH4 0,5 bei pH 8,2" |
| **R2** Füttern 2×/Tag & ICS-Flut | ✅ | Daily Habit als Dashboard-Checkbox, `maintenanceLogs`-Eintrag, kein ICS-Event |
| **R3** `snoozedUntil` überladen | ✅ | `snoozeSource` ergänzt (Nit: N.4.4) |
| **R4** Kein Rate-Limiting | ✅ | `randomBytes(24)`, konstanter Vergleich, 404 statt 401, 30/h → 429 (Nit: N.4.7) |
| **R5** Port umgeht Proxy-Auth | ✅ | `127.0.0.1:3000:3000` in Compose, PRD, `AGENTS.md` und Review-Checkliste |
| **R6** Deployment-Fallen | ✅ | Alle vier als eigener Gotchas-Block: `serverExternalPackages`, gleiche Build-/Runner-Arch, `node -e fetch` statt `wget`, `bodySizeLimit: '6mb'` + Path-Traversal-Schutz |
| **R7** Deckel nur auf Calls | ✅ | Zweistufig (Calls **und** Tokens), `usage` aus finalem Streaming-Event — der Streaming-Punkt war leicht zu übersehen |
| **I1–I15** | ✅ | Alle 15 zugeordnet und geschlossen; `.agents/skills/` und `.claude/skills/` verifiziert **byte-identisch** (alle sechs), Kanonizität in `AGENTS.md` festgehalten; `MEMORY.md`-Konflikt sauber gelöst (Zweck „für andere Agents und Menschen" statt Löschen) |
| **Q1** Korruptes Research-Doc | ✅ | Als historisch/nicht maßgeblich markiert, `AGENTS.md` verweist entsprechend. Pragmatisch statt Vollbereinigung — tragfähig, weil kein Dokument mehr normativ darauf verweist (Nit: N.4.9) |
| **Q2** 6 Monate alte Daten | ✅ | Re-Verify-Auftrag an drei Stellen verankert (TechDesign §8, `tech_stack.md`, `MEMORY.md` „Known Issues") |
| **Scope/Zeitplan** | ✅ | 6–8 Wochen, MCP → v1.1, Docker als Phase-1-Vertical-Slice, sechs Phasen mit Ergebnis je Phase |

Über das Verlangte hinaus ergänzt und sinnvoll: der Abschnitt
**„Critical Unit-Test Cases (write these FIRST)"** in `agent_docs/testing.md`
und die Umstellung der Review-Checkliste von einer nicht existierenden
Auth-Prüfung auf konkrete Token-/Upload-/Port-Checks.

---

## N.6 Was jetzt zu tun ist

Vor `scheduler.ts` und `ics.ts` — es sind Textänderungen, keine Umbauten:

1. **N.1.5 + N.1.6** — UID auf `originalDueAt` umstellen, `DTSTAMP` stabilisieren,
   `occurrencesInRange()` benennen und Variante B (festes Raster) festschreiben.
   Danach PRD §5.5 und die DoD-Zeile mit dem TechDesign in Übereinstimmung bringen.
2. **N.3** — `originalDueAt = nextPreferredDay(lastDoneAt + intervalDays)`,
   einmalig bei Entstehung. Ohne das misst Metrik 1a das falsche.
3. **N.2** — `rescheduleCount` als `missedSlots()`-Formel neu definieren
   (PRD §5.3, §6 und TechDesign §4.2 gleichlautend).
4. **N.4.1–N.4.3** — Inklusivitäts-Semantik, Leer-Maske-Guard und die
   Mo-vs-So-Bit-Konvertierung festlegen; alle drei gehören in dieselben Tests,
   die `agent_docs/testing.md` bereits vorsieht.
5. Restliche Nits (N.4.4–N.4.9) beim nächsten Durchgang mitnehmen.

Danach ist der Plan aus meiner Sicht baureif.

---

## N.7 Status der Nachprüfungs-Punkte

Eingearbeitet in **PRD v1.3** und **TechDesign v1.2** (plus `AGENTS.md`,
`agent_docs/*`, `MEMORY.md`):

| Punkt | Umsetzung |
|---|---|
| N.1.1–N.1.5 | `UID = {scheduleId}-{originalDueAtISO}@aquaman`; `DTSTART = plannedFor`; `SEQUENCE = scheduleVersion + missedSlots`; `DTSTAMP = schedule.updatedAt`. TechDesign §4.4 neu geschrieben, PRD §5.5 und DoD-Zeile angeglichen — der Widerspruch „stabile UIDs" vs. „Nein" ist aufgelöst |
| N.1.6 | `occurrencesInRange(schedule, from, to, today)` in TechDesign §4.2; Variante B (festes Raster) festgeschrieben, mit Begründung und Überhol-Guard |
| N.2 | `rescheduleCount` durchgängig ersetzt durch `missedSlots(schedule, today)` — pure Formel, drei Konsumenten (UI-Hinweis, Metrik 1b, `SEQUENCE`) |
| N.3 | `originalDueAt = nextPreferredDay((lastDoneAt ?? createdAt) + intervalDays)`, einmalig bei Entstehung; Metrik 1a mit Hinweis auf die Rasterung |
| N.4.1 | `nextPreferredDay()` als **inklusiv** definiert, mit Test |
| N.4.2 | Maske `0` per zod ungültig + defensiver Fallback „jeder Tag" gegen Endlossuche |
| N.4.3 | `localWeekdayIndex(date, tz)` (0 = Mo) eingeführt; Mo-vs-So-Falle als eigene Gotcha-Zeile |
| N.4.4 | `snoozeSource` auf `'user' \| null` reduziert, Spalte für v1.1-MCP reserviert |
| N.4.5 | `APP_TIMEZONE` → `AQUAMAN_TIMEZONE` in allen Dateien |
| N.4.6 | `aiCalls` behält `provider` + `model`, mit Begründung im Schema |
| N.4.7 | Token-Vergleich: erst SHA-256 beider Seiten, dann `timingSafeEqual` |
| N.4.8 | Tippfehler „OER" korrigiert |
| N.4.9 | Warnblock im Research-Doc unter die H1 verschoben |

Die Changelog-Zeilen der Vorversionen bleiben als Historie stehen, sind aber dort
als ersetzt markiert, wo sie sonst falsch gelesen werden könnten (UID-Schema,
`APP_TIMEZONE`).
