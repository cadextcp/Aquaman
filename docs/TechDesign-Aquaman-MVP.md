# Tech Design — Aquaman (MVP)

> **Technisches Design für die Open-Source-Aquarium-Pflege- & Tracking-App**
> Version: 1.2 · Status: Verabschiedet · Workflow: Vibe-Coding Step 3 (Tech Design)
> Basierend auf: `docs/PRD-Aquaman-MVP.md` (v1.3) · Fixes aus `docs/plan-review.md` eingearbeitet
>
> **Changelog v1.2** (nach Nachprüfung, `docs/plan-review.md` §N):
> - N.1: **ICS-Event-Identität überarbeitet** — `UID` hängt an `originalDueAt` statt am
>   geplanten Datum, `DTSTART` = `plannedFor`, `SEQUENCE` rein berechenbar, `DTSTAMP` stabil.
>   Grund: seit Auto-Reschedule eine Projektion auf `today` ist, driftet `plannedFor` täglich —
>   eine datumsbasierte UID hätte täglich Löschen+Neuanlegen statt Verschieben erzeugt
> - N.1.6: `occurrencesInRange()` eingeführt — künftige Termine liegen auf einem **festen
>   Raster** aus `originalDueAt`; nur die aktuelle Occurrence wird projiziert
> - N.2: `rescheduleCount` → **`missedSlots()`** (pure Formel; der alte Zähler war nicht
>   berechenbar, weil `plannedFor` nie persistiert wird)
> - N.3: `originalDueAt` wird **bei Entstehung** auf einen bevorzugten Wochentag gelegt
> - N.4: `nextPreferredDay()` inklusiv · Guard für leere Wochentagsmaske · Mo/So-Bit-Konvertierung
>   · `snoozeSource` auf `'user'` reduziert · `AQUAMAN_TIMEZONE` · `aiCalls` behält `provider`/`model`
>   · Token-Vergleich über SHA-256 (kein `RangeError` bei abweichender Länge)
>
> **Changelog v1.1** (nach externem Plan-Review):
> - B4: SQLite-Typen fixiert (`text({mode:'json'})`, 7-Bit-Wochentagsmaske) — keine Postgres-Typen
> - B5: Auto-Reschedule als **reine Lese-Projektion** in `nextDue()` — kein Write, kein Cron; ICS/MCP/Dashboard identisch
> - B6: `APP_TIMEZONE` + `startOfLocalDay()`-Helper; AI-Mitternachts-Reset & ICS-Tage daran gebunden
>   *(in v1.2 umbenannt zu `AQUAMAN_TIMEZONE`)*
> - B7: ICS: expandierte VEVENTs, deterministische UID `{scheduleId}-{plannedDateISO}@aquaman`, `SEQUENCE`, Byte-Identitäts-Test
>   *(⚠️ **durch v1.2 ersetzt** — die UID hängt jetzt an `originalDueAt`, siehe §4.4)*
> - B3: `/api/mcp` (v1.1 des Produkts): vollständig Bearer-gated + Rate-Limit + 404-on-invalid
> - I2: Env durchgängig `AQUAMAN_`-Präfix; I3: nur Bearer-Header (keine URL-Userinfo)
> - R4: Token-Endpunkte mit konstantem Vergleich + Rate-Limiting; 404 statt 401
> - R5: Port-Bindung nur `127.0.0.1` / Docker-Netz; R6: vier Deployment-Fallen als Gotchas
> - R7: zweistufiges Cost-Ceiling (Calls + Tokens); Streaming-`usage` aus finalem Event
> - Phase 1 = vertikaler Schnitt inkl. Docker/CI/NAS-Deployment

---

## 1. Empfohlener Ansatz

**Ein Next.js-15-Monolith (App Router) mit SQLite — ein Container, eine Datenbank-Datei, ein Build.**

| Aspekt | Entscheidung | Begründung |
|--------|--------------|------------|
| Framework | Next.js 15 (App Router) + React 19 | Frontend + API in einem Projekt; Server Components = wenig Client-JS = leichtgewichtig; AI-Tools produktivsten damit |
| Sprache | TypeScript (strict) | Fehler zur Compile-Zeit fangen — wichtig bei AI-generiertem Code (Level A) |
| UI | Tailwind CSS 4 + shadcn/ui + lucide-react | Schöne Mobile-First-UI ohne Design-Arbeit; Komponenten gehören dem Repo |
| Charts | Recharts | Linien-Verläufe mit Zielbändern, touch-geeignet, klein |
| Datenbank | SQLite (better-sqlite3) + Drizzle ORM | Eine Datei unter `/app/data/aquaman.db`; WAL-Mode; typsichere Queries + Migrationen |
| Forms/Validierung | react-hook-form + zod | Schnelle Mobile-Eingabe; gleiches Schema client- und serverseitig |
| AI | `@anthropic-ai/sdk` mit `baseURL` aus `AQUAMAN_AI_BASE_URL` | Ein Code-Pfad für z.ai GLM UND Claude |
| MCP (Produkt-v1.1) | `@modelcontextprotocol/sdk`, Streamable HTTP, `/api/mcp` | Vollständig Bearer-gated; Domänenschicht wird wiederverwendet |
| ICS | `ical-generator` | Kontrollierbar: deterministische UIDs, expandierte Events |
| State | RSC + Server Actions; Client-State nur für Charts/Forms/Chat | Wenig JS, schnell |
| Tests | Vitest + Testing Library | Scheduler/Snooze/ICS/Ranges sind pure Funktionen → 100 % testbar |
| Lint/Format | ESLint + Prettier | Konsistenz über AI-Sessionen |
| Zeitzone | `AQUAMAN_TIMEZONE` (Default `Europe/Berlin`), `Intl`-basiert | Alle Tagesgrenzen zentral |

**Warum kein separates Backend?** Für 1–5 Nutzer ist ein Next.js-Monolith ideal. Die Architektur ist **API-first vorbereitet**: Alle Domänenfunktionen liegen als pure Funktionen in `src/lib/domain/*` und werden von API-Routen, Server Actions UND (v1.1) MCP-Tools gemeinsam benutzt.

## 2. Alternative Optionen (verworfen)

| Option | Pros | Cons | Entscheidung |
|--------|------|------|--------------|
| FastAPI + React (2 Projekte) | Klare Trennung | 2× Deployment, 2× AI-Kontext | ❌ |
| SvelteKit | Noch leichter | Kleineres Ökosystem | ❌ |
| Postgres + Compose-Stack | Skaliert besser | Overkill; RAM auf TrueNAS | ❌ |
| Go + statisches Frontend | Winziger Container | Vibe-coder kann nichts anpassen | ❌ |
| No-Code | Sofort startbar | Kein ICS/MCP/AI-Coach | ❌ |

## 3. Projektstruktur & Setup

```
aquaman/
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # Mobile-First-Dashboard
│   │   ├── tanks/[id]/           # Detail & Formulare
│   │   ├── tests/                # Wasserwerte
│   │   ├── calendar/             # In-App-Kalender
│   │   ├── coach/                # AI-Chat
│   │   ├── settings/             # Token, Limits, Sprache, Export
│   │   └── api/
│   │       ├── health/route.ts       # Docker-Healthcheck
│   │       ├── calendar.ics/route.ts # ICS-Feed (Token, GET-only)
│   │       ├── uploads/[...]/route.ts# Foto-Auslieferung (Path-Traversal-Schutz!)
│   │       └── mcp/route.ts          # MCP (v1.1) — Bearer-gated
│   ├── components/
│   ├── lib/
│   │   ├── db/                   # Drizzle Schema, Migrationen, Seed
│   │   ├── domain/               # ★ Kernlogik (pure Funktionen)
│   │   │   ├── scheduler.ts      # nextDue() + occurrencesInRange() + missedSlots()
│   │   │   ├── ranges.ts         # Zielbereiche + NH3-Berechnung
│   │   │   ├── dates.ts          # startOfLocalDay(), nextPreferredDay(), localWeekdayIndex()
│   │   │   └── ics.ts            # ICS-Generierung (deterministisch)
│   │   ├── ai/                   # Client, Prompts, Cost-Guard
│   │   └── mcp/                  # (v1.1) Tool-Definitionen
│   └── i18n/                     # en.json (+ de.json ab Ende Phase 2)
├── data/                         # Volume — .gitignore
├── tests/
├── Dockerfile                    # Multi-Stage (build → runner), standalone
├── docker-compose.yml
├── .env.example                  # AQUAMAN_-Präfix durchgängig
└── .github/workflows/docker.yml
```

**Setup-Checkliste (vollständig, 7 Schritte):**
1. `npx create-next-app@latest` (TS, Tailwind, App Router, ESLint)
2. `npx shadcn@latest init` + benötigte Komponenten
3. Drizzle + better-sqlite3 installieren; `next.config.ts`: `output: 'standalone'`, `serverExternalPackages: ['better-sqlite3', 'sharp']`
4. Vitest aufsetzen; erste Tests für `scheduler.ts` + `dates.ts`
5. next-intl aufsetzen (Struktur + `en.json`); `de.json` ab Ende Phase 2 füllen
6. Dockerfile (multi-stage) + docker-compose.yml (Port nur lokal) + Healthcheck
7. GitHub Actions: lint → typecheck → test → build → push ghcr.io

## 4. Feature-Implementierung

### 4.1 Tank Management

- Server Actions `createTank/updateTank/deleteTank` mit zod-Validierung
- Pflanzen/Fische als `text({mode:'json'})`: `plants: {name, qty}[]`, `fish: {species, qty}[]`
- `tankState: 'cycling' | 'established'` (Default: `established`) — steuert NO2/NH3-Bewertung
- Foto: multipart Upload via Server Action → `data/uploads/<tankId>/photo.<ext>`; max 5 MB; `experimental.serverActions.bodySizeLimit: '6mb'` in next.config; sharp-Resize auf 1200px
- `/api/uploads/[...path]`: harte Pfad-Normalisierung (`path.normalize`, `..`-Reject), Content-Type Whitelist
- Löschen = Soft-Delete (`deletedAt`)

### 4.2 Scheduler & Flexible Scheduling (★ Kernkomplexität)

**Datenmodell-Auszug (SQLite-konform):**
```ts
schedules: id, tankId, actionType, intervalDays,
  preferredDays: integer (7-Bit-Maske, Bit 0 = Mo … Bit 6 = So; 0 ist ungültig),
  autoReschedule: bool (default true),
  lastDoneAt: datetime|null,
  snoozedUntil: datetime|null, snoozeSource: 'user'|null,
  scheduleVersion: integer (inkrementiert bei jeder Zeilenänderung),
  updatedAt: datetime (→ ICS DTSTAMP),
  createdAt, active
maintenanceLogs: id, tankId, actionType, doneAt, note, source ('user'|'ai_proposed'|'mcp')
waterTests: id, tankId, measuredAt, values text-json, note
```

`snoozeSource` kennt in v1 nur `'user'` — Auto-Reschedule schreibt nichts (s. u.). Die Spalte
bleibt, damit MCP-Snoozes ab v1.1 unterscheidbar sind.

**Begriffe (fixiert):**

- **`originalDueAt`** = `nextPreferredDay((lastDoneAt ?? createdAt) + intervalDays)` — **bei
  Entstehung einmal auf einen erlaubten Wochentag gelegt, danach nie verschoben.** Die
  Rasteranpassung passiert bei der Entstehung, nicht nachträglich: sonst läge der Soll-Termin auf
  einem Tag, an dem die Aufgabe gar nicht erledigt werden kann (Intervall 10 + „nur Wochenende" →
  Dienstag), und der Rückstand wäre per Konstruktion 4 Tage zu hoch — Erfolgsmetrik 1a würde einen
  Modellierungsartefakt messen statt Verhalten (Plan-Review N.3).
- **`plannedFor`** = Projektion aus `originalDueAt` + Snooze + Auto-Reschedule-Regel — **wird
  berechnet, nie persistiert.**
- **`overdueDays`** = `today − originalDueAt`, minimal 0 — der ehrliche Rückstand für Catch-up,
  Priorisierung und AI-Kontext.
- **`missedSlots(schedule, today)`** = Anzahl bevorzugter Wochentage im Intervall
  `(originalDueAt, today]`. **Ersetzt den früheren `rescheduleCount`** (Plan-Review N.2: „wie oft
  wurde verschoben" war nicht berechenbar, weil `plannedFor` nie persistiert wird und ein
  persistierter Zähler dem „Auto-Reschedule schreibt nie" widerspräche). Misst dasselbe — wie oft
  die Aufgabe drangekommen wäre —, ist eine pure Funktion ohne Historie und trägt drei Konsumenten:
  UI-Hinweis ab `≥ 3` („Interval too tight?"), Erfolgsmetrik 1b und den `SEQUENCE`-Anteil im ICS-Feed.

**Wochentags-Helper (pure, `dates.ts`):**

- `nextPreferredDay(date, mask)` ist **inklusiv**: liegt `date` selbst auf einem bevorzugten Tag,
  wird `date` zurückgegeben. Exklusiv wäre eine überfällige Aufgabe an ihrem eigenen Wochenendtag um
  einen vollen Zyklus weitergeschoben worden (Plan-Review N.4.1).
- Maske `0` ist per zod ungültig (mindestens ein Bit). Die Funktion behandelt `0` zusätzlich
  defensiv als „jeder Tag", damit sie unter keinen Umständen endlos sucht (N.4.2).
- **Bit-Konvertierung:** Die Maske zählt `Bit 0 = Mo`, `Date.getDay()` liefert `0 = So`. Nie direkt
  vergleichen — immer `localWeekdayIndex(date, tz)` aus `dates.ts` benutzen (zonenrichtig via `Intl`,
  Ergebnis `0 = Mo`). Garantierte Off-by-one-Falle (N.4.3).

**Due-Berechnung (pure Funktion, 100 % getestet):**
```
nextDue(schedule, today):
  base        = (lastDoneAt ?? createdAt) + intervalDays
  originalDue = nextPreferredDay(base)                   // Raster bei Entstehung, dann fix
  due = originalDue
  if (snoozedUntil && snoozedUntil > due)
      due = nextPreferredDay(snoozedUntil)               // Snooze überschreibt
  if (due < today && autoReschedule)
      due = nextPreferredDay(today)                      // Projektion, KEIN Write
  return {
    originalDueAt: originalDue,
    plannedFor:    due,
    overdueDays:   max(0, today − originalDue),
    missedSlots:   missedSlots(schedule, today),
  }
```

**Auto-Reschedule = reine Lese-Projektion** (Plan-Review B5): Kein DB-Write, kein Cron. Dashboard,
ICS-Feed und künftige MCP-Tools rufen dieselbe `nextDue()` auf → überall identischer, immer aktueller
Plan. Persistiert wird nur menschliches Handeln (Done → `lastDoneAt`, Snooze → `snoozedUntil`).

**Occurrence-Expansion (`occurrencesInRange`, neu — Plan-Review N.1.6):**

`nextDue()` liefert genau den aktuellen Termin. Kalenderansicht und ICS-Feed brauchen einen
90-Tage-Horizont:

```
occurrencesInRange(schedule, from, to, today):
  base       = lastDoneAt ?? createdAt
  current    = nextDue(schedule, today)
  emit current if current.plannedFor within [from, to]
  for n = 1, 2, 3, …:
    originalDue_n = nextPreferredDay(base + (n+1) × intervalDays)   // FESTES RASTER
    plannedFor_n  = originalDue_n                                    // künftige: nicht projiziert
    if plannedFor_n > to: break
    if plannedFor_n <= current.plannedFor: continue                  // vom Rückstand überholt
    if plannedFor_n >= from: emit { originalDue_n, plannedFor_n }
```

**Nur die aktuelle Occurrence wird projiziert; alle künftigen liegen auf dem festen Raster aus
`originalDueAt`.** Würde man stattdessen ab `plannedFor` weiterketten, verschöbe sich bei jedem Tag
Rückstand die komplette 90-Tage-Kette — und mit ihr jede UID im Feed (~13 Events bei einem
Wochenintervall, täglich neu). Das Raster bleibt an der Realität („alle 7 Tage"), nur der akute
Termin wird nachgeplant.

**Füttern als Daily Habit (Plan-Review R2):** Füttern ist KEIN Schedule, sondern Dashboard-Checkbox
pro Tank/Tag. `maintenanceLogs`-Eintrag mit `actionType: 'feed'` beim Abhaken. Kein ICS-Event
(90 × täglich = Kalender-Müll), einfache Streak-Anzeige.

**Catch-up-Modus:** > 5 Aufgaben mit `overdueDays > 0` → Top-1-Karte (Priorität: water change >
fertilize > filter > rest; höherer `overdueDays` wiegt mehr). Freundlicher Ton.

**Snooze:** Server Action `snooze(scheduleId, until)` → schreibt `snoozedUntil` +
`snoozeSource: 'user'`, inkrementiert `scheduleVersion` und `updatedAt`; 1 Tap am Handy.

### 4.3 Wasserwerte

- Formular zeigt nur Parameter des Wasser-Typs; Defaults = zuletzt genutzte Werte; Dezimaltastatur
- `ranges.ts`: Ziel-/Warnbereiche pro Typ (fresh/salt), pro Tank überschreibbar (`tanks.paramOverrides` text-json)
- **NH3-Berechnung:** `nh3FromNh4(nh4Total, ph, tempC)` — reine Funktion (Formel nach Emerson et al. 1975, pKa-abhängig von Temperatur); bewertet wird NH3 mit kritisch ab ~0,02 mg/l
- NO2: Ziel 0 (established), Warnung ab 0,1 mg/l; bei `tankState: cycling` kein Alarm bei Peaks (Hinweiston statt Warnung)
- Charts: Recharts LineChart + ReferenceArea (Zielband), Filter 30/90/365 Tage

### 4.4 ICS-Feed

- Route: `GET /api/calendar.ics?t=<token>` — Token: `crypto.randomBytes(24).toString('base64url')`,
  Vergleich über SHA-256 beider Seiten + `crypto.timingSafeEqual` (gleiche Länge garantiert),
  rotierbar über Settings
- Ungültiges Token → **404** (Existenz nicht bestätigen); Rate-Limit: In-Memory 30 Fehlversuche/IP/h → 429
- **Inhalt:** je aktivem Schedule `occurrencesInRange(schedule, today, today + 90 Tage, today)`
  (§4.2) — expandierte Einzel-VEVENTs, **kein RRULE**. Daily Habits (Füttern) erzeugen keine Events

**Event-Identität (überarbeitet gegenüber v1.1 — Plan-Review N.1):**

| Feld | Wert | Warum |
|------|------|-------|
| `UID` | `{scheduleId}-{originalDueAtISO}@aquaman` | **Nicht** das geplante Datum. `originalDueAt` ist per Definition unveränderlich (§4.2) und damit der einzige stabile Schlüssel einer Occurrence |
| `DTSTART` | `plannedFor`, All-Day (`;VALUE=DATE:YYYYMMDD`) | bewegt sich bei Snooze und Reschedule — das Event *wandert*, statt gelöscht und neu angelegt zu werden |
| `SEQUENCE` | `scheduleVersion + missedSlots(schedule, today)` | monoton wachsend und rein berechenbar; steigt sowohl bei Zeilenänderungen (Snooze, Intervall-Edit) als auch bei Reschedule-Drift |
| `DTSTAMP` | `schedule.updatedAt` (UTC) | **nicht** `now` — sonst ist der Feed nie byte-identisch und der Test in `agent_docs/testing.md` kann nie grün werden |

**Warum nicht das geplante Datum in der UID:** Seit Auto-Reschedule eine Projektion auf `today` ist
(§4.2), ändert sich `plannedFor` an *jedem* Tag, an dem eine Aufgabe offen bleibt — nicht nur bei
Snooze. Eine datumsbasierte UID wäre damit laufend neu. Google sähe Löschen + Neuanlegen statt
Verschieben: am Event gesetzte Erinnerungen gingen verloren, und weil der ICS-Sync nicht
transaktional ist, wären im Refresh-Fenster kurzzeitig beide Events sichtbar — genau das Duplikat,
das die DoD ausschließt. Mit `originalDueAt` als Schlüssel bleibt es ein echtes Verschieben, und
`SEQUENCE` erfüllt überhaupt erst seinen Zweck (bei wechselnder UID kann es nie feuern).

- Events: Titel "Aquaman: Water change — 240L Community Tank"; `X-WR-CALNAME:Aquaman`
- Ausgabe nach UID sortiert → **byte-identisch bei identischen Eingaben** (Schedule-Zeilen + `today`).
  Der Unit-Test injiziert `today` über einen Clock-Parameter, weil `plannedFor` davon abhängt
- `Cache-Control: public, max-age=3600`; Content-Type `text/calendar; charset=utf-8`; GET-only
- Der Feed ist ohne Dashboard-Besuch aktuell (Projektion sitzt in `nextDue()`)
- In-App-Kalender nutzt dieselbe `occurrencesInRange()` — eine Quelle, keine zweite Terminlogik

### 4.5 AI-Coach

- Chat-UI (Streaming); System-Prompt injiziert: Tank-Profile (inkl. `tankState`), letzte 10 Messwerte inkl. berechnetem NH3, Rückstände (`overdueDays`) + `missedSlots`, offene Aufgaben
- **Structured Output:** Tool-Use `propose_schedule` (zod-Schema) → Approval-Karte → Server Action schreibt erst nach Bestätigung
- **Cost-Guard (zweistufig):** `aiCalls`-Tabelle (Tag, Calls, Prompt/Completion-Tokens aus **finalem Streaming-Event** `usage`, Kosten-Schätzung); Limits: `AQUAMAN_AI_MAX_CALLS_PER_DAY` (20) + `AQUAMAN_AI_MAX_TOKENS_PER_DAY` (z. B. 200k) — Überschreitung → AI pausiert bis Mitternacht `AQUAMAN_TIMEZONE`
- **Fallback:** kein Key / Fehler / Limit → "AI offline — core features fully working"
- Disclaimer: Empfehlungen, keine Medikamenten-Dosierung; Fachhandel-Hinweis

### 4.6 MCP-Server → **Produkt-v1.1** (nicht MVP)

- `@modelcontextprotocol/sdk`, Streamable HTTP, Route `/api/mcp`
- **Gesamter Endpoint Bearer-gated** (`Authorization: Bearer <AQUAMAN_MCP_TOKEN>`), konstanter Vergleich, Rate-Limit, 404 bei ungültigem Token
- Optional zwei Token-Klassen: read-only / read-write
- Tools: `get_tanks`, `get_water_values`, `get_pending_maintenance` (nutzt `nextDue()`), `add_water_test`, `log_maintenance`, `snooze_task`, `ask_coach` — alle rufen `src/lib/domain/*` auf
- Keine DELETE/UPDATE-Tools

## 5. Design-Implementierung

- shadcn/ui + eigenes Aqua-Theme (dunkles Blaugrün, teal Primary, cyan Akzent), Light-Mode-Toggle
- Mobile: Bottom-Nav (Dashboard, Tanks, +, Calendar, More) — Desktop ≥ lg: Sidebar; Touch-Targets ≥ 44px; safe-area-insets
- Dashboard: KPI-Cards (Due today / Behind / Tests this month), Catch-up-Karte, Daily-Habit-Checkboxen (Füttern), Task-Karten mit Done/Snooze
- Framer-motion: dezente Check-Animation
- i18n: next-intl; `en.json` ab Start, `de.json` ab Ende Phase 2 (Struktur steht von Anfang an)

## 6. Datenbank & Storage

**SQLite (better-sqlite3, WAL), Drizzle.** Datei: `/app/data/aquaman.db`. Migrationen via drizzle-kit; Seed: Default-Aktionen + Zielbereiche.

**Tabellen:**
```
tanks            id, name, volumeL, waterType, photoPath, plants text-json,
                 fish text-json, hasCo2, hasHeater, hasFilter, filterType,
                 tankState ('cycling'|'established'), paramOverrides text-json,
                 createdAt, deletedAt
schedules        id, tankId→tanks, actionType, intervalDays,
                 preferredDays integer (7-Bit, Bit 0 = Mo; 0 ungültig),
                 autoReschedule bool, lastDoneAt, snoozedUntil,
                 snoozeSource ('user'|null), scheduleVersion,
                 updatedAt (→ ICS DTSTAMP), createdAt, active
maintenanceLogs  id, tankId, actionType, doneAt, note, source
waterTests       id, tankId, measuredAt, values text-json, note
appSettings      key (PK), value text-json    // icsToken, mcpToken, uiPrefs, aiSettings
aiCalls          id, day (local date), provider, model, calls,
                 promptTokens, completionTokens, costEstimateMicros
                 // provider+model bleiben drin: ohne sie ist die Kostenschätzung
                 // falsch, sobald AQUAMAN_AI_MODEL gewechselt wird — und der
                 // Provider-Wechsel ist ein Kernversprechen des Stacks
```

**Alle JSON-Felder: `text({ mode: 'json' })` — SQLite hat kein jsonb/array. Wochentage: 7-Bit-Integer-Maske.** Backups: Volume-Snapshot / Datei-Kopie (Doku im README).

## 7. AI-Assistance-Strategie (Entwicklung)

| Aufgabe | Tool | Warum |
|---------|------|-------|
| Haupt-Build | Claude Code (CLI) | Orchestriert Files, Tests, Git; AGENTS.md-steuerbar |
| Code-Review | vibe-review-Skill / zweiter Pass | AI-Code von AI prüfen (Level A) |
| Bugs/Hotfixes | Claude Code + Konsole | Owner testet auf echtem Handy |
| Deployment | Claude Code führt aus; Owner verifiziert auf TrueNAS | Owner = Tester |

## 8. AI-Produkt-Strategie

- **Runtime:** server-seitig only — Keys nur im Container-Env
- **Client:** `@anthropic-ai/sdk`; `baseURL = AQUAMAN_AI_BASE_URL` (Default `https://api.anthropic.com`), `apiKey = AQUAMAN_AI_API_KEY`, `model = AQUAMAN_AI_MODEL` — **vor Build-Start gegen aktuelle z.ai-Doku verifizieren** (Stand Feb 2026 verifiziert, im August erneut prüfen — siehe Plan-Review Q2)
- **Structured Outputs:** Tool-Use + zod; malformed → reject, never repair
- **Daten-Grenzen:** AI sieht Tank-/Mess-/Log-Daten; NIE Tokens/Keys
- **Retention:** Provider-Defaults; README-Hinweis
- **Fallback:** try/catch + 30 s Timeout + Cost-Guard → App voll nutzbar
- **Telemetry:** `aiCalls` (Provider/Modell/Calls/Tokens/€-Schätzung, heute & Monat) in Settings sichtbar
- **Cost Ceiling:** zweistufig (Calls + Tokens), Pause bis lokale Mitternacht
- **Evals (DoD):** Nitrat 60 → Wasserwechsel-Empfehlung; NH4 0,5 bei pH 8 → NH3-Kritisch-Erkennung; CO2 40 + Gasping → Sofortmaßnahmen; 2-Wochen-Pause → priorisiert & freundlich; Injection-Versuch → Refusal
- **Sicherheit:** AI-Antworten = untrusted input; Writes nur über validierte Server Actions + Approval-Gate

## 8a. Zeit-/Kalender-Grundlagen (neu, Plan-Review B6)

- `AQUAMAN_TIMEZONE` (Default `Europe/Berlin`) in `.env` — durchgängiges Präfix wie alle übrigen
  Variablen (Plan-Review N.4.5)
- `src/lib/domain/dates.ts`: `startOfLocalDay(date, tz)`, `addDays`, `fmtLocalDate`,
  `localMidnightOf(date, tz)`, `localWeekdayIndex(date, tz)` (0 = Mo), `nextPreferredDay(date, mask)`
  — ausschließlich über `Intl.DateTimeFormat` mit `timeZone`-Option; **kein** `date.getDate()` /
  `new Date().setHours(0,0,0,0)` (Server-Zonen-Falle)
- Alle Konsumenten: Dashboard-Due, ICS-Tagesbildung, `aiCalls.day`, AI-Limit-Reset — nur über diese Helper
- Unit-Tests: 23:30-Berlin vs. 00:30-Berlin um die Mitternachtsgrenze; Sommerzeitwechsel;
  `nextPreferredDay` inklusiv (Eingabetag ist bevorzugt → unverändert zurück); Maske `0` terminiert;
  `localWeekdayIndex` für alle sieben Tage gegen die Bitmaske

## 8b. Token-Endpoints & Absicherung (neu, Plan-Review R4/R5)

- ICS- und (v1.1) MCP-Token: `crypto.randomBytes(24).toString('base64url')` (32 Zeichen)
- Vergleich: **beide Seiten erst SHA-256-hashen, dann `crypto.timingSafeEqual`** — die Funktion wirft
  einen `RangeError`, wenn die Buffer unterschiedlich lang sind; ein Token falscher Länge würde sonst
  einen 500er auslösen (und die Länge verraten). Hashen macht beide Seiten fix 32 Byte (Plan-Review N.4.7)
- Rate-Limit: In-Memory-Map (IP → Fehlversuche), 30/h → 429; Reset bei Erfolg
- Ungültiges Token → **404**, nie 401 (keine Existenz-Bestätigung)
- Docker-Netzwerk: Port-Bindung `127.0.0.1:3000:3000` ODER kein Publish + Proxy im gleichen Docker-Netz — LAN-Zugriff auf :3000 umgeht sonst die Proxy-Auth
- README: fetter Sicherheitshinweis + empfohlene Proxy-Konfiguration

## 9. Agent-Orchestrierung

- In-App: Single-Call-Pattern — Coach = 1 API-Call mit kontextiertem System-Prompt
- Extern (OpenClaw, v1.1): Aquaman ist MCP-Tool-Server; OpenClaw orchestriert
- Approval-Gates: AI → Vorschlag → Mensch bestätigt → Write
- Keine Background-Jobs — Auto-Reschedule ist Lese-Projektion; AI-Limit-Reset on-demand beim ersten Aufruf des neuen Tages

## 10. Builder-Exit-Review

| Punkt | Status |
|-------|--------|
| Source-Ownership | 100 % eigenes Repo (MIT) |
| Export | JSON-Export (MUST); SQLite-Datei gehört dir |
| GitHub Sync | Repo ist Quelle; CI baut bei jedem Tag |
| Lokaler Build | `docker build .` ohne Drittanbieter |
| Secrets | Nur Env-Vars; `.env.example` komplett; `.env` ignoriert |
| Rollback | Image-Tags (v0.1.0…); Migrationen rückwärtskompatibel |
| Exit-Plan | SQLite + JSON-Export = alle Daten; App läuft offline ewig |

## 11. Deployment-Plan

**Phase 1 = vertikaler Schnitt** (Plan-Review §5): leere Next.js-App + SQLite-Volume + Healthcheck + CI + **Deployment auf TrueNAS** — danach Features als `docker compose pull`.

1. **CI:** push → lint → typecheck → test → build → Docker multi-stage → `ghcr.io/cadextcp/aquaman:<tag>` + `latest`
2. **TrueNAS SCALE Custom App:**
   ```yaml
   services:
     aquaman:
       image: ghcr.io/cadextcp/aquaman:latest
       environment:
         - AQUAMAN_TIMEZONE=Europe/Berlin
         - AQUAMAN_AI_BASE_URL=https://api.z.ai/api/anthropic
         - AQUAMAN_AI_API_KEY=${AQUAMAN_AI_API_KEY}
         - AQUAMAN_AI_MODEL=glm-4.6
         - AQUAMAN_AI_MAX_CALLS_PER_DAY=20
         - AQUAMAN_AI_MAX_TOKENS_PER_DAY=200000
       volumes:
         - /mnt/tank/apps/aquaman/data:/app/data
       ports:
         - "127.0.0.1:3000:3000"   # R5: nur lokal — Reverse Proxy übernimmt
       restart: unless-stopped
       healthcheck:
         test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
         interval: 60s
   ```
3. **Reverse Proxy:** HTTPS-Host `aquaman.cadex64.de` → Container:3000; Basic-Auth/Authelia davor empfohlen
4. **Backup:** TrueNAS-Dataset-Snapshot für `/mnt/tank/apps/aquaman/data`
5. **MCP für OpenClaw (Produkt-v1.1):** Bearer-Header, `Authorization: Bearer <token>`

## 12. Build-Phasen (überarbeitet)

| Phase | Inhalt | Ergebnis |
|-------|--------|----------|
| **1. Vertical Slice** | Next.js-Scaffold, Drizzle-Schema (alle Tabellen), Theme, i18n-Struktur, Health-Route, Vitest, **Dockerfile + CI + Deployment auf TrueNAS** | Live-URL zeigt leere App; jede weitere Phase = `docker compose pull` |
| **2. Core Features** | Tank-CRUD + Fotos, Schedules, Daily Habits (Füttern), Snooze, Dashboard, Wasserwerte + Charts (inkl. NH3), `de.json` | Produktionsreif ohne AI |
| **3. Calendar & ICS** | `occurrencesInRange()`, In-App-Kalender, ICS-Feed (UID auf `originalDueAt`, stabiler `DTSTAMP`, byte-identisch-Test), Google-Test | Kalender in Google abonnierbar |
| **4. AI-Coach** | AI-Client, Coach-Chat, `propose_schedule` + Approval-UI, Cost-Guard (Calls+Tokens), Fallback | Special Sauce live |
| **5. Launch** | JSON-Export/Import, Statistiken, README/TrueNAS-Guide, SECURITY/CONTRIBUTING, LICENSE, Release v0.1.0 | Öffentliche v0.1.0 |
| **6. v1.1 (nach Launch)** | MCP-Server (Bearer-gated), OpenClaw-Verdrahtung, ggf. read-only/read-write-Tokens | Remote-Zugriff via OpenClaw |

## 13. Kosten-Aufstellung

| Posten | Entwicklung | Betrieb/Monat |
|--------|-------------|---------------|
| GitHub + Actions + ghcr | 0 € | 0 € |
| TrueNAS-Hosting | 0 € | 0 € |
| AI (gedeckelt) | 0 € (Keys vorhanden) | ~0,5–2 € |
| **Gesamt** | **0 €** | **≈ 0–2 €** |

## 14. Scaling-Pfad

| Nutzerzahl | Maßnahme |
|------------|----------|
| 1–5 | SQLite + ein Container |
| ~10–50 (v2) | OIDC via Authelia/Authentik; weiterhin SQLite |
| ~100+ | Optionaler Postgres-Switch (Drizzle); Redis für ICS-Cache |
| Sensoren (v2) | MQTT/HTTP-Ingest → `waterTests` (`source: 'sensor'`) |

## 15. Limitationen (ehrlich)

- Google-ICS-Refresh ~24 h — Snooze erscheint in Google erst am nächsten Tag; App ist "live" (Web-Push v2)
- Single-User ohne Login — Schutz via Reverse Proxy; ICS token-gated + Rate-Limit; README-Warnhinweis
- Kein Cron — AI-Limit-Reset & Reschedule on-demand/projektiv
- SQLite — kein paralleles Multi-Write (irrelevant bei 1–5 Nutzern)
- AI-Tipps = Empfehlungen; Disclaimer sichtbar
- Foto-Upload ohne Vision-AI in v1
- MCP erst in v1.1 — Remote-Fragen via OpenClaw erst dann

---

## Meta

```json
{
  "appName": "Aquaman",
  "stack": {
    "frontend": "Next.js 15 (App Router) + React 19 + TypeScript",
    "backend": "Next.js API Routes + Server Actions (Node.js runtime)",
    "database": "SQLite + Drizzle ORM (better-sqlite3) — text-json columns, 7-bit weekday mask",
    "auth": "None in v1 (reverse-proxy auth documented; ICS token-gated; MCP in v1.1 fully bearer-gated)",
    "styling": "Tailwind CSS + shadcn/ui (dark aqua theme, mobile-first)",
    "deployment": "Docker (multi-stage, standalone) on TrueNAS SCALE via ghcr.io image; local-only port binding"
  },
  "commands": {
    "setup": "npm ci && npm run db:migrate && npm run db:seed",
    "dev": "npm run dev",
    "test": "npm test",
    "typecheck": "npm run typecheck",
    "lint": "npm run lint",
    "build": "npm run build"
  },
  "aiScope": "in-app AI (Anthropic-compatible: z.ai GLM / Claude); MCP tool server follows in product v1.1"
}
```
