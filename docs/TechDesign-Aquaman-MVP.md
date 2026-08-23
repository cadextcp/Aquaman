# Tech Design — Aquaman (MVP)

> **Technisches Design für die Open-Source-Aquarium-Pflege- & Tracking-App**
> Version: 1.0 · Status: Verabschiedet · Workflow: Vibe-Coding Step 3 (Tech Design)
> Basierend auf: `docs/research-Aquaman.md`, `docs/PRD-Aquaman-MVP.md` (v1.1)

---

## 1. Empfohlener Ansatz

**Ein Next.js-15-Monolith (App Router) mit SQLite — ein Container, eine Datenbank-Datei, ein Build.**

| Aspekt | Entscheidung | Begründung |
|--------|--------------|------------|
| Framework | Next.js 15 (App Router) + React 19 | Frontend + API + MCP in einem Projekt; Server Components = wenig Client-JS = leichtgewichtig; AI-Tools produktivsten damit |
| Sprache | TypeScript (strict) | Fehler zur Compile-Zeit fangen — wichtig bei AI-generiertem Code (Level A) |
| UI | Tailwind CSS 4 + shadcn/ui + lucide-react | Schöne Mobile-First-UI ohne Design-Arbeit; Komponenten gehören dem Repo (kein npm-Lock-in) |
| Charts | Recharts | Linien-Verläufe mit Zielbändern, reagiert auf Touch, klein genug |
| Datenbank | SQLite (better-sqlite3) + Drizzle ORM | Eine Datei unter `/app/data/aquaman.db` — Backup = kopieren; typsichere Queries + Migrationen |
| Forms/Validierung | react-hook-form + zod | Schnelle Mobile-Eingabe, Validierung im Client UND Server |
| AI | @anthropic-ai/sdk mit konfigurierbarer `baseURL` | Ein Code-Pfad für z.ai GLM UND Claude (beide Anthropic-Messages-kompatibel) |
| MCP | @modelcontextprotocol/sdk, Streamable HTTP unter `/mcp` | Moderner Standard, läuft im selben Next.js-Container, OpenClaw-kompatibel |
| ICS | Eigene Generierung (`ical-generator`) | Klein, kontrollierbar, All-Day-Events + Snooze-Updates |
| State | React Server Components + Server Actions; Client-State nur für Charts/Forms | Wenig JS, schnell, einfach |
| Tests | Vitest + Testing Library (Kernlogik) | Intervall-/Snooze-/ICS-Logik MUSS getestet sein — AI-Code + Datumsmathe = Fehlerrisiko #1 |
| Lint/Format | ESLint + Prettier | Konsistenter Stil über AI-Sessionen hinweg |

**Warum kein separates Backend?** Für 1–5 Nutzer ist ein Next.js-Monolith ideal: weniger Deployment-Komplexität, keine API-Duplizierung, trotzdem saubere Trennung über `src/lib` (Domänenlogik) vs. `src/app` (Routen). Die Architektur ist **API-first vorbereitet**: Alle Domänenfunktionen liegen als reine Funktionen/Services in `src/lib/*` und werden von API-Routen, Server Actions UND MCP-Tools gemeinsam benutzt — Sensoren & Dritt-Clients (v2) docken ohne Umbau an.

## 2. Alternative Optionen (verworfen)

| Option | Pros | Cons | Entscheidung |
|--------|------|------|--------------|
| FastAPI + React (2 Projekte) | Klare Trennung | 2× Deployment, 2× AI-Kontext nötig | ❌ |
| SvelteKit | Noch leichter | Kleineres Ökosystem, AI-Tools weniger sicher darin | ❌ |
| Postgres + Docker-Compose-Stack | Skaliert besser | Overkill für 2 Aquarien; mehr RAM auf TrueNAS | ❌ (SQLite reicht bis viele 100 Tanks) |
| Go + statisches Frontend | Winziger Container | Vibe-coder kann nichts selbst anpassen | ❌ |
| No-Code (Baserow/NocoDB) | Sofort startbar | Kein ICS, kein MCP, kein AI-Coach, kein echter Open-Source-Code | ❌ |

## 3. Projektstruktur & Setup

```
aquaman/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (dashboard)/          # Mobile-First-Dashboard
│   │   ├── tanks/[id]/           # Aquarium-Detail & -Formulare
│   │   ├── tests/                # Wasserwerte erfassen/charts
│   │   ├── calendar/             # In-App-Kalenderansicht
│   │   ├── coach/                # AI-Chat
│   │   ├── settings/             # Token, AI-Limits, Sprache
│   │   └── api/
│   │       ├── health/route.ts       # Docker-Healthcheck
│   │       ├── calendar.ics/route.ts # ICS-Feed (Token)
│   │       ├── uploads/[...]/route.ts# Foto-Auslieferung
│   │       └── mcp/route.ts          # MCP Streamable HTTP Endpoint
│   ├── components/               # UI (shadcn/ui + eigene)
│   ├── lib/
│   │   ├── db/                   # Drizzle Schema, Migrationen, Seed
│   │   ├── domain/               # ★ Kernlogik (pure Funktionen)
│   │   │   ├── scheduler.ts      # Intervall-, Due-, Snooze-Berechnung
│   │   │   ├── autoReschedule.ts # Auto-Reschedule-Algorithmus
│   │   │   ├── ranges.ts         # Wasserwert-Zielbereiche
│   │   │   └── ics.ts            # ICS-Generierung
│   │   ├── ai/                   # AI-Client, Prompts, Cost-Guard
│   │   └── mcp/                  # MCP-Tool-Definitionen
│   └── i18n/                     # en + de Message-Kataloge
├── data/                         # Volume-Mount (DB + uploads/) — .gitignore
├── public/
├── tests/                        # Vitest (Domain-Logik!)
├── Dockerfile                    # Multi-Stage (build → runner)
├── docker-compose.yml
├── .env.example
└── .github/workflows/docker.yml  # CI: test → build → ghcr.io
```

**Setup-Checkliste:**
1. `npx create-next-app@latest` (TS, Tailwind, App Router, ESLint)
2. `npx shadcn@latest init` + benötigte Komponenten
3. Drizzle + better-sqlite3 installieren, Schema schreiben, `drizzle-kit` konfigurieren
4. Vitest aufsetzen, erste Tests für `scheduler.ts`
6. Dockerfile + compose + Healthcheck
7. GitHub Actions Workflow

## 4. Feature-Implementierung (PRD → Technik)

### 4.1 Tank Management
- Server Actions `createTank/updateTank/deleteTank` mit zod-Validierung
- Pflanzen/Fische als JSON-Felder (`plants: {name, qty}[]`, `fish: {species, qty}[]`) — flexibel, keineExtra-Tabellen für MVP
- Foto: multipart Upload via Server Action → gespeichert unter `data/uploads/<tankId>/logo.<ext>`, Größe limitiert (max 5 MB, sharp-Resize auf 1200px)
- Löschen = Soft-Delete-Flag (Datenintegrität für Logs)

### 4.2 Scheduler & Flexible Scheduling (★ Kernkomplexität)

**Datenmodell-Auszug:**
```ts
schedules: id, tankId, actionType, intervalDays,
  preferredDays: int[] (0=So..6=Sa), autoReschedule: bool,
  lastDoneAt: datetime|null, snoozedUntil: datetime|null, active
maintenanceLogs: id, tankId, actionType, doneAt, note, source (user|ai)
```

**Due-Berechnung (pure Funktion, 100% getestet):**
```
nextDue(tank, schedule, today):
  base  = lastDoneAt ?? schedule.createdAt
  due   = base + intervalDays
  // 1) Snooze überschreibt alles:
  due   = max(due, snoozedUntil)
  // 2) Auf bevorzugten Wochentag schieben (nie zurück!):
  due   = nextPreferredDay(due)
  return due
```

**Auto-Reschedule (Default: an):** Beim Dashboard-Load (on-demand, kein Cron): Überfällige Aufgaben, deren `lastDoneAt + interval + 2 Tage` überschritten ist → `snoozedUntil = nächster bevorzugter Tag ab heute` → Plan bleibt sauber, ohne dass Logs gelogen werden (nichts wird als "erledigt" markiert!). Config-Flag pro Schedule + global in Settings.

**Catch-up-Modus:** Wenn > 5 Aufgaben überfällig: Dashboard zeigt Top-1-Priorität (Gewichtung: water change > feed > fertilize > rest; je älter, desto wichtiger) als "If you only do one thing today"-Karte.

**Snooze-Buttons:** "Tomorrow" / "Next weekend" / "+3 days" / DatePicker — Server Action `snooze(taskId, until)`, 1 Tap am Handy.

### 4.3 Wasserwerte
- `waterTests: id, tankId, measuredAt, values: jsonb, note`
- Werte-Schema pro Wasser-Typ aus `ranges.ts` (Ziel-/Warnbereiche aus Recherche, pro Tank überschreibbar via `tank.paramOverrides: jsonb`)
- Chart: Recharts LineChart + ReferenceArea (Zielband), Zeitraum-Filter (30/90/365 Tage)
- Formular: Mobile-first, nur Parameter des Wasser-Typs, zuletzt genutzte Werte als Defaults, Dezimaltastatur

### 4.4 ICS-Feed
- Route `GET /api/calendar.ics?t=<token>` — Token = 32-Zeichen-Secret in `appSettings` (Settings-UI: generieren/rotieren)
- Generiert VEVENTs für alle aktiven Schedules der nächsten 90 Tage (All-Day, DTSTART/DTEND, `X-WR-CALNAME:Aquaman`), inkl. Snooze/Auto-Reschedule-Ergebnis
- `Cache-Control: max-age=3600`; Content-Type `text/calendar; charset=utf-8`
- In-App-Kalender: eigene Monatsansicht (kein Heavy-Addon), Termine klickbar → Snooze/Done

### 4.5 AI-Coach
- Chat-UI (Streaming via AI-SDK-artiges Pattern auf dem Anthropic-Client)
- System-Prompt: Aquaristik-Coach, kontextbewusst — injiziert Tank-Profile, letzte 10 Messwerte, offene/überfällige Aufgaben; freundlich, kein Vorwurf; Schluss-Disclaimer "recommendations, not medical dosing — consult your local fish store for critical issues"
- **Kalender-Vorschlag:** Structured Output via Tool-Use (`propose_schedule`-Tool, zod-Schema) → UI-Karte mit Diff-Ansicht → Approval → Server Action schreibt Schedule
- **Cost-Guard:** `aiCalls`-Tabelle (Tag, Anzahl, Tokens, Kosten-Schätzung); `AQUAMAN_AI_MAX_CALLS_PER_DAY` (Default 20) — überschritten → 429-artige UI-Meldung "AI paused until midnight"
- **Fallback:** Kein Key / API-Fehler → Coach-Tab zeigt "AI offline — core features fully working", Rest unauffällig normal

### 4.6 MCP-Server
- `@modelcontextprotocol/sdk`, Transport Streamable HTTP, gemountet als Route `/api/mcp` (gleicher Port, kein Extra-Prozess)
- Token-Schutz: `Authorization: Bearer <MCP_TOKEN>` (Settings-UI zeigt Konfigurations-URL für OpenClaw)
- Tools (alle nutzen `src/lib/domain/*` wieder):
  - Read: `get_tanks`, `get_water_values(tankId?, days?)`, `get_pending_maintenance(days?)`, `get_ai_usage`
  - Write (Token erforderlich): `add_water_test(tankId, values)`, `log_maintenance(tankId, actionType)`, `snooze_task(scheduleId, until)`
  - `ask_coach(question, tankId?)` → AI (unterliegt Cost-Guard)
- Keine DELETE/UPDATE-Tools — destruktive Operationen nur via UI

## 5. Design-Implementierung

- **shadcn/ui-Basis** + eigenes `Aqua-Theme`: dunkles Default (CSS vars: `--background` tiefes Blaugrün, `--primary` teal, Akzent cyan), Light-Mode-Toggle (persistiert in localStorage)
- **Mobile-First-Layout:** Bottom-Nav mit 5 Einträgen (Dashboard, Tanks, [+]-FAB, Calendar, More) — Desktop ab `lg:`: Sidebar statt Bottom-Nav; große Touch-Targets (min 44px), safe-area-insets für iOS
- **Dashboard:** KPI-Cards (Due today / Overdue / Tests this month), Catch-up-Karte, Tasks als Swipe-/Tap-Karten mit Done- & Snooze-Buttons
- **Mikro-Feedback:** sanfte Check-Animation (framer-motion, dezent), keine/notification-Erschöpfung — "friendly, not nagging"
- **i18n:** next-intl, Kataloge `src/i18n/en.json` + `de.json` — alle Strings von Anfang an über Keys (PRD: en zuerst, de als zweiter Sprachsatz)

## 6. Datenbank & Storage

**SQLite via better-sqlite3, Drizzle ORM.** Datei: `data/aquaman.db` (WAL-Mode). Migrationen via drizzle-kit (`npm run db:migrate`), Seed-Script für Default-Aktionen & Zielbereiche.

**Tabellen (Überblick):**
```
tanks            id, name, volumeL, waterType, photoPath, plants(jsonb),
                 fish(jsonb), hasCo2, hasHeater, hasFilter, filterType,
                 paramOverrides(jsonb), createdAt, deletedAt
schedules        id, tankId→tanks, actionType, intervalDays,
                 preferredDays(int[]), autoReschedule(bool), lastDoneAt,
                 snoozedUntil, active, createdAt
maintenanceLogs  id, tankId, actionType, doneAt, note, source
waterTests       id, tankId, measuredAt, values(jsonb), note
appSettings      key (PK), value (jsonb)   // icsToken, mcpToken, uiPrefs, aiSettings
aiCalls          id, day, provider, model, promptTokens, completionTokens,
                 costEstimateMicros, purpose
```

**Backups:** `data/` ist ein Docker-Volume; README-Doku: `sqlite3 data/aquaman.db ".backup ..."` oder Volume-Snapshot (TrueNAS macht das eh). Restore = Datei zurückkopieren.

## 7. AI-Assistance-Strategie (Entwicklung)

| Aufgabe | Tool | Warum |
|---------|------|-------|
| Haupt-Build | Claude Code (CLI) | Orchestriert Files, Tests, Git; AGENTS.md-steuerbar |
| Code-Review | Gleicher Agent, zweiter Review-Pass (vibe-review-Skill) | AI-Code von AI prüfen lassen (Level A) |
| Bugs/Hotfixes | Claude Code + Fehlerkonsole/Paste | Iterativ testen mit Owner |
| Deployment | Claude Code führt aus; Owner testet auf TrueNAS | Owner = Tester (PRD) |

**Wichtig:** Der Owner testet jede Feature-Phase auf dem Handy (echte Nutzung); AI fixt die gefundenen Bugs.

## 8. AI-Produkt-Strategie

- **Runtime:** Server-seitig ONLY — Keys leben nur im Container-Env, nie im Client-Bundle
- **Client:** `@anthropic-ai/sdk`, `baseURL = env.AI_BASE_URL`, `apiKey = env.AI_API_KEY`, `model = env.AI_MODEL` (Defaults: `https://api.anthropic.com`, `claude-sonnet-4-5`; alternativ `https://api.z.ai/api/anthropic`, `glm-4.6`)
- **Structured Outputs:** Tool-Use mit JSON-Schema (Kalender-Vorschläge) — kein freies Parsen
- **Daten-Grenzen:** AI sieht Tank-Daten, Messwerte, offene Tasks; sieht NIE Tokens/Keys
- **Retention:** Provider-Defaults; Doku-Hinweis für beide Provider (z.ai & Anthropic haben Zero-Retention-Optionen für Enterprise — für private Nutzung Default OK)
- **Fallback:** try/catch + Timeout 30 s + Cost-Guard → App bleibt voll nutzbar
- **Telemetry:** `aiCalls`-Tabelle, Settings-UI zeigt Calls/Tokens/€-Schätzung heute & diesen Monat
- **Cost Ceiling:** Env `AQUAMAN_AI_MAX_CALLS_PER_DAY=20`; Exzess → Coach antwortet "limit reached", Rest der App unberührt
- **Evals (manueller Katalog, Teil von DoD):**
  1. "Nitrate 60 mg/l" → muss Wasserwechsel empfehlen
  2. "CO2 40 mg/l, fish gasping" → muss CO2-reduzieren/Belüftung empfehlen
  3. "Nothing done for 2 weeks" → muss priorisiert water change nennen, freundlich
  4. Kalender-Vorschlag für 240L-Community-Tank → plausibles JSON-Schema
- **Sicherheit:** Prompt-Injection-Defense — AI-Antworten fließen NIE ungeprüft in DB; Kalender-Vorschläge nur über validiertes Tool-Schema + Approval-Gate

## 9. Agent-Orchestrierung

- **In-App:** Single-Call-Pattern (kein Agent-Loop) — Coach = 1 API-Call mit kontextiertem System-Prompt; deterministisch, günstig, testbar
- **Extern (OpenClaw):** Aquaman ist der Tool-Server (MCP), OpenClaw orchestriert — wir stellen nur die Tools + `ask_coach`
- **Approval-Gates:** AI → Vorschlag → Mensch bestätigt → Write (PRD-Anforderung); MCP-Write-Tools erfordern Token
- **Keine Background-Jobs in v1** — Auto-Reschedule läuft on-demand beim Dashboard-Load (idempotent), Cron-Worker ist v2

## 10. Builder-Exit-Review

| Punkt | Status |
|-------|--------|
| Source-Ownership | 100% eigenes Repo (MIT), keine No-Code-Plattform |
| Export | JSON-Export aller Tabellen (Settings → Export); SQLite-Datei gehört dir |
| GitHub Sync | Repo IST die Quelle, CI baut Image bei jedem Tag |
| Lokaler Build | `docker build .` funktioniert ohne Drittanbieter |
| Secrets | Nur Env-Vars, `.env.example` dokumentiert, `.env` in `.gitignore` |
| Rollback | Docker-Image-Tags (v0.1.0…), compose pinnt Version; DB-Migrationen rückwärtskompatibel schreiben |
| Exit-Plan | Falls Projekt eingestellt: SQLite + JSON-Export = alle Daten; App läuft offline ewig weiter |

## 11. Deployment-Plan

**Ziel:** `aquaman.cadex64.de` auf TrueNAS SCALE.

1. **CI (GitHub Actions, public repo = kostenlos):** push Tag → `npm ci && npm run lint && npm run typecheck && npm test && npm run build` → Docker multi-stage Build → Push `ghcr.io/<owner>/aquaman:<tag>` + `latest`
2. **TrueNAS SCALE:** Custom App / Launch Docker Compose:
   ```yaml
   services:
     aquaman:
       image: ghcr.io/<owner>/aquaman:latest
       environment:
         - AI_BASE_URL=https://api.z.ai/api/anthropic
         - AI_API_KEY=${AI_API_KEY}
         - AI_MODEL=glm-4.6
         - AQUAMAN_AI_MAX_CALLS_PER_DAY=20
       volumes:
         - /mnt/tank/apps/aquaman/data:/app/data
       ports: ["3000:3000"]
       restart: unless-stopped
       healthcheck:
         test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
         interval: 60s
   ```
3. **Reverse Proxy (bestehender):** HTTPS-Host `aquaman.cadex64.de` → Container:3000; Empfehlung: Basic-Auth oder mTLS/Authelia davor (Doku im README — App selbst ist Single-User ohne Login in v1)
4. **MCP für OpenClaw:** `https://<mcp-token>@aquaman.cadex64.de/api/mcp` bzw. Bearer-Header
5. **Backup:** TrueNAS-Dataset-Snapshot für `/mnt/tank/apps/aquaman/data`

**Erster Launch lokal:** `docker compose up` → Setup-Screen (Sprache wählen, ICS/MCP-Token generieren, AI optional) → Tanks anlegen.

## 12. Kosten-Aufstellung

| Posten | Entwicklung | Betrieb/Monat |
|--------|-------------|---------------|
| GitHub + Actions + ghcr | 0 € | 0 € |
| TrueNAS-Hosting | 0 € | 0 € |
| Domain | 0 € | 0 € |
| AI (GLM-4.6, ~20 Calls/Tag) | 0 € (Keys vorhanden) | ~0,5–2 € (gedeckelt, abschaltbar) |
| **Gesamt** | **0 €** | **≈ 0–2 €** |

## 13. Scaling-Pfad

| Nutzerzahl | Maßnahme |
|------------|----------|
| 1–5 (Status quo) | SQLite + ein Container — fertig |
| ~10–50 (Familie/Freunde, v2) | Multi-User via OIDC (Authelia/Authentik-Header), weiterhin SQLite |
| ~100+ | Optionaler Postgres-Switch (Drizzle macht das fast gratis), Redis für ICS-Cache |
| Sensoren (v2) | MQTT/HTTP-Ingest-Route → gleiche `waterTests`-Tabelle (`source: sensor`); Charts ohnehin bereit — API-first zahlt sich aus |

## 14. Limitationen (ehrlich)

- **Google-ICS-Refresh ~24 h** — Snooze erscheint in Google erst am nächsten Tag; App/Kurzbefehl ist "live" (Doku + Web-Push in v2)
- **Single-User ohne Login in v1** — Schutz über Reverse Proxy nötig, sonst offen im Netz (großer README-Warnhinweis)
- **Kein Cron/Background** — Auto-Reschedule & Kostenzähler laufen on-demand; "Mitternachts-Reset" erfolgt beim ersten Aufruf des neuen Tages
- **SQLite** — kein gleichzeitiges Multi-Write-Skalieren (für 1–5 Nutzer irrelevant)
- **AI-Tipps = Empfehlungen** — kein Ersatz für Fachhandel, Disclaimer überall sichtbar
- **Foto-Upload ohne Vision-AI** — Fotos sind nur Deko/Referenz in v1

---

## Meta

```json
{
  "appName": "Aquaman",
  "stack": {
    "frontend": "Next.js 15 (App Router) + React 19 + TypeScript",
    "backend": "Next.js API Routes + Server Actions (Node.js runtime)",
    "database": "SQLite + Drizzle ORM (better-sqlite3)",
    "auth": "None in v1 (reverse-proxy auth documented; OIDC planned v2)",
    "styling": "Tailwind CSS + shadcn/ui (dark aqua theme, mobile-first)",
    "deployment": "Docker (multi-stage) on TrueNAS SCALE via ghcr.io image"
  },
  "commands": {
    "setup": "npm ci && npm run db:migrate && npm run db:seed",
    "dev": "npm run dev",
    "test": "npm test",
    "typecheck": "npm run typecheck",
    "lint": "npm run lint",
    "build": "npm run build"
  },
  "aiScope": "in-app AI + MCP tool server (Anthropic-compatible: z.ai GLM / Claude)"
}
```
