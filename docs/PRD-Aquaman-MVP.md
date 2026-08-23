# PRD — Aquaman (MVP)

> **Produktanforderungen für die Open-Source-Aquarium-Pflege- & Tracking-App**
> Version: 1.2 · Status: Verabschiedet · Workflow: Vibe-Coding Step 2 (PRD)
> Basierend auf: `docs/research-Aquaman.md` (historisch) · `docs/plan-review.md` (eingearbeitet)
>
> **Changelog v1.2** (nach externem Plan-Review):
> - B1/B2: `originalDueAt`/`plannedFor`-Trennung; messbare Erfolgsmetriken
> - B3: MCP-Endpoint vollständig Token-geschützt; **MCP verschoben auf v1.1** (Owner-Entscheidung)
> - B5: Auto-Reschedule als reine Lese-Projektion (kein DB-Write) → ICS immer aktuell
> - B6: `APP_TIMEZONE` eingeführt (Default `Europe/Berlin`)
> - B7: ICS-Strategie festgeschrieben (expandierte VEVENTs, deterministische UIDs)
> - I4: JSON-Export ist MUST; I5: Catch-up-Modus ist MUST; I7: i18n-Sequenz geklärt
> - R1: NH3-Berechnung aus NH4+pH+Temp, NO2-Ziel verschärft, `tankState` (cycling/established)
> - R2: Füttern als "Daily Habit" (Dashboard-Checkbox), kein ICS-Müll
> - Zeitplan realistisch angepasst: 6–8 Wochen Freizeit-Tempo; Docker ab Phase 1

---

## 1. Produktübersicht

| | |
|---|---|
| **Name** | Aquaman |
| **Tagline** | *Self-hosted aquarium care & water tracking with an AI coach* |
| **Ziel** | Open-Source, self-hosted Web-App, die Aquarium-Pflege plant, tracked und via AI Empfehlungen gibt |
| **Launch-Ziel** | Community-tauglich: Jeder Selfhoster kann Aquaman mit `docker compose up` installieren |
| **Timeline** | 6–8 Wochen Freizeit-Tempo (realistisch; früher geschätzte 2–4 Wochen waren für 9 MUST-Features zu optimistisch — siehe Plan-Review §5) |
| **Budget** | 0 €/Monat — AI-API-Keys (z.ai GLM / Anthropic Claude) vorhanden |
| **Hosting** | Docker auf TrueNAS SCALE, erreichbar unter `aquaman.cadex64.de` (Reverse Proxy) |
| **Zeitzone** | `APP_TIMEZONE` (Default `Europe/Berlin`) — alle "heute"/"Mitternacht"-Entscheidungen laufen ausschließlich darüber |

---

## 2. Zielgruppe & Persona

**Primär (Owner):** Aquaristik-Hobbyist mit 2 Aquarien (Süßwasser), TrueNAS-SCALE-Selfhoster, technisch versiert in Betrieb (Docker, Reverse Proxy), aber kein Entwickler (Level A Vibe-coder). Denkt analytisch, will Zahlen, Verläufe und klare "Was ist zu tun"-Antworten. **Hat Stress-Phasen, in denen Pflege liegen bleibt — die App muss das gelassen wegstecken.**

**Sekundär (Community):** Selfhosting-Community (r/selfhosted-Profil) mit Aquarien. Erwartet: Docker-Image, Umgebungsvariablen-Konfiguration, sauberes README, keine Zwangs-Cloud, keine Telefonie nach Hause.

**Anti-Persona:** Einsteiger, die eine App-Store-App mit Account-Zwang suchen — nicht unsere Zielgruppe für v1.

---

## 3. Problemstellung

Aquarien brauchen regelmäßige Pflege: Füttern (täglich), Wasserwechsel (wöchentlich/14-tägig), Düngen, Filterwechsel, Wasserwerte-Messungen. Ohne System:

- **Vergesslichkeit:** Wasserwechsel wird überzogen, Fütterung verpasst
- **Kein Überblick:** Welche Aktion ist wann fällig? Welches Aquarium braucht was?
- **Datenflut ohne Nutzen:** Wasserwerte werden gemessen, aber nicht mit Pflege verknüpft
- **Laienwissen:** Kritische Werte werden nicht erkannt; es fehlt ein Coach, der sagt "Nitrat steigt → Wasserwechsel empfohlen"
- **Stress-Phasen:** Starre Pläne versagen, wenn keine Zeit ist — Aufgaben stauen sich auf, die App wird ignoriert und aufgegeben

**Kernfrage der App:** *"What needs to be done today — and what should I do about my water values?"* — **und: Wie hole ich nach einer Stress-Phase entspannt wieder auf?**

---

## 4. User Journey

```
Morgens: "Was ist heute fällig?"
   → Dashboard (mobil) zeigt:
     "Due today: Fertilize (60L). Daily habits: Feeding (both tanks).
      Behind: Water change (240L) — planned for Saturday (3 days behind)."
   → Nutzer hakt Füttern + Düngen ab (1 Tap je), optional Notiz

Stress-Woche: Keine Zeit für Aquarien?
   → Nutzer macht nichts → Aquaman zeigt Rückstand ehrlich an
     (originalDueAt bleibt stehen), plant aber freundlich nach
     (plannedFor = nächster passender Tag)
   → Kein Aufgaben-Stau, kein schlechtes Gewissen
   → Nach 3 automatischen Verschiebungen fragt die App sanft:
     "Interval too tight? Water change has been moved 3 times."

Alle 1–2 Wochen: Wasserwerte messen
   → Messwerte-Formular (vorbereitet für Aquarien-Typ)
   → Verlauf-Chart zeigt Trends
   → Ziel-Bereiche (freshwater/saltwater) als Referenzbänder
   → NH3 wird aus NH4 + pH + Temperatur berechnet und bewertet

Wenn Werte kritisch / AI-Muster:
   → AI-Empfehlung: "Nitrate rising in 240L tank → water change 30% in 3 days"
   → Nutzer bestätigt → Kalender-Intervall wird angepasst
   → ICS-Feed aktualisiert → Google Calendar zeigt es

Community-Selfhoster:
   → docker compose up → .env mit AI-Keys → fertig
```

---

## 5. MVP-Features (Must-haves)

### 5.1 Aquarien-Verwaltung (Tank Management)

**User Story:** *Als Aquarianer will ich Aquarien mit allen wichtigen Parametern anlegen, damit die App weiß, um welches Becken es geht.*

- Felder: Name, Wassermenge (Liter), Wasser-Typ (fresh/salt), Pflanzen-Besatz (Liste: Name + Menge), Fischbesatz (Liste: Art + Anzahl), Technik (CO2-Anlage ja/nein, Heizung, Filter + Filtertyp), **`tankState`: `cycling` | `established`** (Einfahrphase vs. eingefahren — beeinflusst Bewertung von NO2/NH3-Peaks)
- Foto-Upload pro Aquarium (jpg/png, unter `data/uploads/`, max 5 MB)
- Erstellen, Bearbeiten, Löschen (Soft-Delete), Übersicht aller Aquarien
- **Erfolgskriterium:** Zwei Aquarien in unter 5 Minuten angelegt (inkl. Foto)

### 5.2 Pflegeplan (Maintenance Schedule)

**User Story:** *Als Aquarianer will ich pro Aquarium und Aktion festlegen, in welchem Intervall und an welchen Wochentagen sie anfällt, damit der Kalender automatisch entsteht.*

- Vordefinierte Aktionen: Water change, Fertilize, Filter change/clean + eigene Aktionen
- Pro Tank: Aktion + Intervall (`intervalDays`) + bevorzugte Wochentage (MO–SO, z. B. "nur Wochenende")
- Dashboard-Aggregation: "Heute fällig / Im Rückstand / Diese Woche"
- Pflege-Log: Erledigte Aktionen mit Datum + optionaler Notiz
- **Erfolgskriterium:** Pflegeplan für 2 Aquarien in unter 10 Minuten eingerichtet

### 5.3 Flexible Scheduling — Snooze & Auto-Reschedule ⭐ (Kern-Insight)

**User Story:** *Als gestresster Aquarianer will ich Termine easy verschieben können — und wenn ich nichts abhake, soll die App selbst produktiv nachplanen, damit sich nichts aufstaut — ohne dass mein Rückstand unsichtbar wird.*

**Datenmodell (fixiert, siehe auch TechDesign §4.2):**
- `originalDueAt` — **bleibt stehen, wird nie verschoben** → Basis für Rückstand, Catch-up-Priorisierung und AI-Kontext
- `plannedFor` — verschiebbar (Snooze/Auto-Reschedule) → Basis für Dashboard-Anzeige und ICS
- `rescheduleCount` — zählt automatische Verschiebungen; ab **≥ 3** fragt die App freundlich "Intervall zu eng?"
- "Überfällig" = `today − originalDueAt > 0` (Fakt) · "rot markieren" = reine UI-Entscheidung (freundlich statt Alarm)

**Verhalten:**
- **Snooze pro Aufgabe:** "Tomorrow", "Next weekend", "+3 days", "Eigenes Datum" — 1 Klick/Tap (`snoozeSource: 'user'`)
- **Auto-Reschedule (Default: an, als reine Lese-Projektion — kein DB-Write, kein Cron):** `plannedFor` wird beim Lesen (Dashboard, ICS, künftiger MCP) aus `originalDueAt` + Reschedule-Regel berechnet. Persistiert wird nur, was der Mensch tut (Done, Snooze). Damit ist der ICS-Feed **immer aktuell**, auch wenn niemand das Dashboard öffnet.
- **Catch-up-Modus:** Bei > 5 Aufgaben im Rückstand zeigt Aquaman die Top-1-Priorität ("If you only do one thing today: water change 240L") statt alles zu listen. **MUST** (Teil dieses Features)
- Keine Bestrafungs-UX: freundlicher, motivierender Ton; Rückstand wird angezeigt, aber eingeordnet
- **Erfolgskriterium:** Snooze in < 5 Sekunden; nach 7 ignorierten Tagen ist `plannedFor` sauber UND der Rückstand bleibt ehrlich sichtbar

### 5.4 Wasserwerte-Tracking (Water Parameters)

**User Story:** *Als Aquarianer will ich Messwerte erfassen und im Verlauf sehen, damit ich Trends erkenne und die AI kontextbezogen beraten kann.*

- Parameter (freshwater): Temperatur (°C), pH, KH (°dKH), GH (°dGH), CO2 (mg/l), NO2 (mg/l), NO3 (mg/l), NH4 gesamt (mg/l), PO4 (mg/l), Fe (mg/l), Cl2 (mg/l), O2 (mg/l)
- **NH3-Berechnung (fixiert):** Freies Ammoniak wird aus NH4-gesamt + pH + Temperatur berechnet (pure Funktion, getestet) und **dieser** Wert wird bewertet: kritisch ab ~0,02 mg/l NH3 — nicht der Rohwert NH4
- **NO2-Ziel verschärft:** Ziel 0 mg/l in eingefahrenen Becken; ab 0,1–0,2 mg/l Warnung. Im `tankState: cycling` sind NO2/NH3-Peaks normal → AI bewertet nachsichtiger
- Parameter (saltwater): + Salinität (SG), Ca, Mg, Alkalinität
- Ziel-/Warnbereiche pro Wasser-Typ, überschreibbar pro Tank
- Verlauf-Chart pro Parameter (Linien-Chart, Zielbereich als Band)
- **Erfolgskriterium:** Messung erfasst in < 30 Sekunden; Chart zeigt mind. letzten Monat

### 5.5 Pflegekalender + ICS-Feed

**User Story:** *Als Aquarianer will ich den Pflegeplan als Kalender in Google Calendar abonnieren, damit ich auch mobil erinnert werde.*

- Kalender-Ansicht (Monats-/Wochenansicht) in der App
- ICS-Feed: `GET /api/calendar.ics?t=<token>` — Token in Settings generierbar/rotierbar
- **ICS-Strategie (fixiert, siehe TechDesign §4.4):** expandierte Einzel-VEVENTs (kein RRULE), deterministische UID `{scheduleId}-{plannedDateISO}@aquaman`, `SEQUENCE` bei Änderungen, Horizont 90 Tage
- Events: All-Day-Events, Titel z. B. "Aquaman: Water change — 240L Community Tank"
- `plannedFor` (inkl. Snooze/Auto-Reschedule-Projektion) ist die Basis — Feed ist ohne Dashboard-Besuch aktuell
- Google-Refresh ~24 h (dokumentiert); App-Kalender ist "live"
- **Erfolgskriterium:** Google Calendar zeigt den Plan nach Abo korrekt; Snooze verschiebt das Event (kein Duplikat); gleiche Daten → byte-identischer Feed

### 5.6 AI-Coach & Kalender-Befüllung

**User Story:** *Als Laie will ich Tipps zur Pflege und zu kritischen Werten bekommen, damit ich weiß, was zu tun ist — und die AI soll meinen Kalender pflegen.*

- **AI-Chat-Panel:** Fragen mit Tank-Kontext ("Nitrite is 0.5, what should I do?") → kontextbezogene Antwort
- **Kalender-Befüllung:** AI analysiert Tank-Setup (Besatz, Pflanzen, CO2, Messwerte, `tankState`) → schlägt Pflegeplan vor → **Nutzer bestätigt** (Approval-Gate) → gespeichert
- **Werte-Adjustierung:** Kritischer Wert (inkl. berechnetem NH3) → AI schlägt Intervall-Anpassung vor → Bestätigung
- **Stress-Awareness:** AI-Kontext enthält Rückstand (`originalDueAt`-basiert) und `rescheduleCount` — sanfte Priorisierung statt Vorwurf ("Focus on water change first")
- **Provider:** Anthropic-kompatible API — z.ai GLM und Claude via `AQUAMAN_AI_BASE_URL` + Key austauschbar (Env-Präfix `AQUAMAN_` durchgängig)
- **Kostenschutz (zweistufig):** `AQUAMAN_AI_MAX_CALLS_PER_DAY` (Default 20) **und** `AQUAMAN_AI_MAX_TOKENS_PER_DAY` (Deckel auch auf Tokens, da Chat-Kontext wächst) — Zähler transparent in Settings
- **Fallback:** AI offline/ohne Key → alle Kernfunktionen ohne AI nutzbar
- **Disclaimer:** AI-Tipps sind Empfehlungen, keine Medikamenten-Dosierungen; Hinweis auf Fachhandel
- **Erfolgskriterium:** AI-Vorschlag in < 15 s; Kalender-Update nach Bestätigung sichtbar

### 5.7 MCP-Server → **verschoben auf v1.1** (Owner-Entscheidung nach Plan-Review)

**Begründung:** Dashboard + ICS beantworten "Was ist heute zu tun?" bereits vollständig. MCP kostet 2–3 Abende Debugging mit fremden Clients, ohne täglichen Nutzen im MVP. Die Domänenschicht ist API-first gebaut — MCP lässt sich in v1.1 in ~2 Abenden nachrüsten (OpenClaw-Anbindung bleibt roadmap-relevant).

**Für v1.1 festgeschrieben:**
- MCP-Server (Streamable HTTP) unter `/api/mcp` im selben Container
- **Der komplette Endpoint ist Bearer-Token-geschützt** (keine "freien Read-Tools" — das wäre bei der auth-losen App ein offener Datenabfluss, siehe Plan-Review B3). Optional zwei Token-Klassen: read-only und read-write
- Tools: `get_tanks`, `get_water_values`, `get_pending_maintenance`, `add_water_test`, `log_maintenance`, `snooze_task`, `ask_coach`
- Rate-Limiting + 404 bei ungültigem Token (Existenz nicht bestätigen)

### 5.8 Docker & Open-Source-Bereitstellung

**User Story:** *Als Community-Mitglied will ich Aquaman per docker compose starten können.*

- Multi-Stage Dockerfile, Image auf ghcr.io via GitHub Actions
- `docker-compose.yml` + `.env.example` (alle Variablen dokumentiert)
- Volume: `/app/data` (SQLite + Uploads)
- **Port-Bindung nur lokal** (`127.0.0.1:3000:3000` oder gar kein Publish + gemeinsames Docker-Netz mit Reverse Proxy) — umgeht nicht die Proxy-Auth (Plan-Review R5)
- Healthcheck `/api/health`
- MIT-Lizenz, README mit Screenshots + TrueNAS-Guide (inkl. Reverse-Proxy-Hinweis), CONTRIBUTING, SECURITY
- **Deployment ab Phase 1 als vertikaler Schnitt** (siehe §12) — nicht erst am Ende
- **Erfolgskriterium:** Fremder Selfhoster startet die App < 10 Minuten (nur mit README)

### 5.9 Daten-Export/Import — **MUST** (hochgestuft, war nice-to-have)

**User Story:** *Als Selfhoster will ich alle Daten als JSON exportieren/importieren können, damit ich kein Lock-in habe.*

- JSON-Export aller Tabellen (Tanks, Schedules, Logs, Tests, Settings ohne Secrets)
- Einfacher JSON-Import (mit Bestätigung)
- **Erfolgskriterium:** Export → frische Instanz → Import → identischer Datenstand

### 5.10 Should-haves (im MVP, nach den Musts)

- **AI-Adjuster** bei kritischen Werten (Teil von 5.6)
- **Statistik-Übersicht:** Fütterungen/Wasserwechsel diesen Monat, AI-Kosten-Rückblick
- Mikro-Animationen (dezent, Check-Feedback)

### 5.11 Won't-have (v2+)

- ~~MCP-Server~~ → **v1.1** (siehe 5.7)
- Sensor-Anbindung & Echtzeitdaten (Home Assistant) — Architektur API-first vorbereitet
- Mehrbenutzer/OIDC (Authelia/Authentik)
- Web-Push-Erinnerungen
- Futter-/Zukaufsverwaltung, Zucht-Logbuch
- Foto-Vision-AI, Community-Plan-Templates

---

## 6. Erfolgsmetriken (messbar, nach Plan-Review B2)

| # | Metrik | Ziel (Monat 1–3) | Messung |
|---|--------|------------------|---------|
| 1a | **Pflege-Zuverlässigkeit:** Median-Verzug zwischen `originalDueAt` und `doneAt` pro Aktionstyp | < 2 Tage (Water change), < 1 Tag (Fertilize) | aus `maintenanceLogs` + Schedules abgeleitet |
| 1b | **Chronische Überlastung:** Aufgaben mit `rescheduleCount ≥ 3` | → Intervall-Anpassung durchlaufen (AI-Vorschlag oder manuell) | Zähler pro Schedule |
| 2 | **AI-Nutzen:** Umgesetzte AI-Tipps | ≥ 2–3 echte, umgesetzte Empfehlungen | Owner-Selbsteinschätzung + sichtbare Intervall-Änderungen |
| 3 | **Stress-Resilienz:** Nach bewusster 1-Wochen-Pause | `plannedFor` sauber, Rückstand ehrlich sichtbar, Catch-up-Karte korrekt | manueller Test (Definition of Done) |

*Beobachtungsgrößen (keine Launch-Blocker): Wasserwerte-Erfassungen/Monat, ICS-Feed-Abrufe, Community-Installationen. Keine Telemetrie — Nutzung wird aus lokalen Daten abgeleitet.*

## 7. Design-Richtung

- **Stil:** Leichtgewichtig, schön, macht Spaß — Dashboard/Grafana-Datenliebe trifft Home-Assistant-Klarheit
- **Mobile-First:** Handy ist das Hauptgerät → Bottom-Navigation (Dashboard, Tanks, +, Calendar, More), große Touch-Targets (min. 44px), 1-Tap-Abhaken; Desktop: Sidebar + breite Charts
- **Farbwelt:** dunkles aquatisches Theme als Default (blau/teal), Light-Mode verfügbar
- **Spaß-Faktor:** sanfte Animationen, große Zahlen/KPIs — dezent, kein Gamification-Overkill
- **Kein Nagging:** freundlicher, ermutigender Ton; Rückstand wird eingeordnet, nicht rot angemarkert
- **i18n (Sequenz fixiert):** UI Englisch zuerst, i18n-Struktur (next-intl, Keys) von Anfang an; `de.json` wird gepflegt, **sobald die UI-Struktur steht** (Ende Phase 2) — nicht tagegleich mit jeder neuen Komponente

## 8. Technische Rahmenbedingungen (Kurzfassung — Details im Tech Design v1.1)

- **Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui + Drizzle + SQLite
- **SQLite-Typen fixiert:** JSON-Felder als `text({mode:'json'})`, Wochentage als 7-Bit-Integer-Maske — keine Postgres-Typen
- **Zeitzone:** `APP_TIMEZONE` (Default `Europe/Berlin`), zentraler Helper `startOfLocalDay()`
- **Deployment:** Docker (multi-stage, standalone) ab Phase 1 auf TrueNAS, Reverse Proxy HTTPS, Port nur lokal gebunden
- **AI:** Anthropic-kompatible API (z.ai GLM / Claude), Env durchgängig `AQUAMAN_AI_*`-Präfix
- **Kein Multi-User-Auth in v1:** Reverse-Proxy-Auth dokumentiert; ICS token-geschützt (+ Rate-Limit, 404 statt 401)
- **Performance:** Dashboard < 2 s lokal, kleine Bundles

## 9. AI/Automation-Scope

**Scope: Core AI Workflow (in-app); MCP folgt in v1.1 (vollständig token-gated)**

| Aspekt | Entscheidung |
|--------|--------------|
| Provider | z.ai GLM & Anthropic Claude (Anthropic-kompatible API, austauschbar) |
| Retention/Training | Provider-Defaults dokumentiert (README); private Nutzung → akzeptabel |
| Modell-sichtbare Daten | Tank-Profile (inkl. `tankState`), Messwerte inkl. berechnetem NH3, Pflege-Logs, Rückstände (`originalDueAt`-basiert), `rescheduleCount` |
| Erlaubte Tool-Klassen | Read + Draft; **keine direkten Writes** — jede AI-Änderung nur über Approval-Gate |
| Structured Output | Tool-Use mit zod-Schema (Kalender-Vorschläge); malformed → reject, never repair |
| Approval-Gate | AI-Vorschläge werden nie automatisch gespeichert — immer Nutzer-Bestätigung |
| Telemetry | `aiCalls`: Calls, Tokens (aus finalen Streaming-Events), Kosten-Schätzung |
| Cost Ceiling | `AQUAMAN_AI_MAX_CALLS_PER_DAY` (20) **und** `AQUAMAN_AI_MAX_TOKENS_PER_DAY` — Pause bis Mitternacht (`APP_TIMEZONE`) |
| Fallback | AI nicht erreichbar → Kernfunktionen voll nutzbar, UI zeigt "AI offline" |
| Evals | Katalog in `agent_docs/testing.md` (Nitrat hoch, NH3 kritisch bei pH 8, CO2-Gasping, 2-Wochen-Pause, Injection-Refusal) |

## 10. Constraints

- **Budget:** 0 € — nur vorhandene Keys & Hardware
- **Timeline:** 6–8 Wochen Freizeit-Tempo (reviewiert)
- **Open Source:** MIT, öffentliches Repo, keine proprietären Abhängigkeiten
- **Selfhosting:** Keine Cloud-Dienste, keine Telemetrie nach außen
- **Betrieb:** TrueNAS SCALE (Docker), aquaman.cadex64.de, HTTPS via Reverse Proxy
- **Sprache:** Englisch zuerst; `de.json` sobald UI-Struktur steht
- **Level A:** AI schreibt den Code, Owner testet

## 11. Definition of Done

- [ ] Alle Must-have-Features (5.1–5.6, 5.8, 5.9) implementiert & getestet
- [ ] `originalDueAt`/`plannedFor`-Trennung umgesetzt; Rückstand ehrlich, Plan sauber
- [ ] Snooze & Auto-Reschedule (Lese-Projektion) funktionieren und fließen identisch in Dashboard & ICS ein
- [ ] ICS: stabile UIDs — Snooze verschiebt Event ohne Duplikat; byte-identischer Feed bei gleichen Daten
- [ ] NH3-Berechnung aus NH4+pH+Temp implementiert & getestet; NO2-Ziele verschärft; `tankState` berücksichtigt
- [ ] Mobile-First-UI: alle Kernaktionen am Handy in ≤ 2 Taps
- [ ] Docker-Image auf ghcr.io, `docker compose up` startet die App; Port nur lokal gebunden
- [ ] ICS-Feed in Google Calendar abonniert & korrekt
- [ ] Token-geschützte Endpoints: falsches Token → 404; Rate-Limit greift
- [ ] AI-Coach beantwortet Kontext-Fragen korrekt & mit Disclaimer
- [ ] Approval-Gates: kein AI-Schreibzugriff ohne Bestätigung
- [ ] Kostendeckel (Calls + Tokens) greift & zählt transparent
- [ ] AI-Fallback: App ohne AI-Key voll funktionsfähig
- [ ] JSON-Export/Import funktioniert
- [ ] README: Installation < 10 Min nachvollziehbar (inkl. Reverse-Proxy-Sicherheitshinweis)
- [ ] `.env.example` vollständig (durchgängig `AQUAMAN_`-Präfix), keine Keys im Repo
- [ ] MIT-Lizenz, CONTRIBUTING, SECURITY vorhanden
- [ ] Stress-Test: 1 Woche Ignorieren → Plan sauber, Catch-up korrekt (Metrik 3)
- [ ] Erste echte Nutzung: beide Aquarien + Pflegeplan + ICS-Feed produktiv

---

```json
{
  "appName": "Aquaman",
  "oneLiner": "Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling and ICS calendar feed",
  "targetUsers": "Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE",
  "phase": "Foundation",
  "mustHave": [
    "Tank management with photos, specs & tankState (cycling/established)",
    "Maintenance schedules with weekday selection",
    "Flexible scheduling: snooze + auto-reschedule as read-projection, originalDueAt/plannedFor separation, catch-up mode",
    "Water parameter tracking with charts incl. NH3 calculation from NH4+pH+temp",
    "ICS calendar feed for Google Calendar (expanded VEVENTs, deterministic UIDs)",
    "AI coach & calendar auto-fill with approval gates (calls+tokens cost ceiling)",
    "Daily habit tracking for feeding (dashboard checkbox, no ICS spam)",
    "Docker deployment via docker compose (local-only port binding)",
    "JSON export/import of all data"
  ],
  "niceToHave": [
    "AI interval adjustment on critical values",
    "Usage statistics (feedings, water changes, AI cost)",
    "Subtle check animations"
  ],
  "notInMvp": [
    "MCP server (moved to v1.1 — fully bearer-token gated)",
    "Sensor integration & real-time data",
    "Multi-user / OIDC auth",
    "Web push notifications",
    "Food/inventory management",
    "Breeding logbook",
    "Photo vision AI",
    "Community plan templates"
  ],
  "successMetrics": [
    "Median delay between originalDueAt and doneAt < 2 days (water change) / < 1 day (fertilize)",
    "Tasks with rescheduleCount >= 3 lead to interval adjustment",
    "At least 2-3 real AI recommendations implemented by owner",
    "After 1-week stress pause: plan clean, backlog honest, catch-up card correct"
  ]
}
```
