# PRD — Aquaman (MVP)

> **Produktanforderungen für die Open-Source-Aquarium-Pflege- & Tracking-App**
> Version: 1.1 · Status: Verabschiedet · Workflow: Vibe-Coding Step 2 (PRD)
> Basierend auf: `docs/research-Aquaman.md` · v1.1: + Flexible Scheduling, Mobile-First-Design

---

## 1. Produktübersicht

| | |
|---|---|
| **Name** | Aquaman |
| **Tagline** | *Self-hosted aquarium care & water tracking with an AI coach* |
| **Ziel** | Open-Source, self-hosted Web-App, die Aquarium-Pflege plant, tracked und via AI Empfehlungen gibt |
| **Launch-Ziel** | Community-tauglich: Jeder Selfhoster kann Aquaman mit `docker compose up` installieren |
| **Timeline** | 2–4 Wochen Freizeit-Tempo |
| **Budget** | 0 €/Monat — AI-API-Keys (z.ai GLM / Anthropic Claude) vorhanden |
| **Hosting** | Docker auf TrueNAS SCALE, erreichbar unter `aquaman.cadex64.de` (Reverse Proxy) |

---

## 2. Zielgruppe & Persona

**Primär (Owner):** Aquaristik-Hobbyist mit 2 Aquarien (Süßwasser), TrueNAS-SCALE-Selfhoster, technisch versiert in Betrieb (Docker, Reverse Proxy), aber kein Entwickler (Level A Vibe-coder). Denkt analytisch, will Zahlen, Verläufe und klare "Was ist zu tun"-Antworten. **Hat Stress-Phasen, in denen Pflege liegen bleibt — die App muss das gelassen wegstecken.**

**Sekundär (Community):** Selfhosting-Community (r/selfhosted-Profil) mit Aquarien. Erwartet: Docker-Image, Umgebungsvariablen-Konfiguration, sauberes README, keine Zwangs-Cloud, keine Telefonie nach Hause.

**Anti-Persona:** Einsteiger, die eine App-Store-App mit Account-Zwang suchen — nicht unsere Zielgruppe für v1.

---

## 3. Problemstellung

Aquarien brauchen regelmäßige Pflege: Füttern (täglich), Wasserwechsel (wöchentlich/14-tägig), Düngen, Filterwechsel, Wasserwerte-Messungen. Ohne System:

- **Vergesslichkeit:** Wasserwechsel wird überzogen, Fütterung doppelt/doppelt verpasst
- **Kein Überblick:** Welche Aktion ist wann fällig? Welches Aquarium braucht was?
- **Datenflut ohne Nutzen:** Wasserwerte werden gemessen, aber nicht mit Pflege verknüpft
- **Laienwissen:** Kritische Werte werden nicht erkannt; es fehlt ein Coach, der sagt "Nitrat steigt → Wasserwechsel empfohlen"
- **Stress-Phasen:** Starre Pläne versagen, wenn keine Zeit ist — Aufgaben stauen sich auf, die App wird ignoriert und aufgegeben

**Kernfrage der App:** *"What needs to be done today — and what should I do about my water values?"* — **und: Wie hole ich stresslose wieder auf?**

---

## 4. User Journey

```
Morgens: "Was ist heute fällig?"
   → Dashboard (oder OpenClaw remote) zeigt:
     "Due today: Feeding (both tanks), Fertilizing (60L).
      Overdue: Water change (240L, 3 days)."
   → Nutzer hakt erledigte Aktionen ab (1 Klick, optional Notiz)

Stress-Tag: Keine Zeit für Aquarien?
   → Nutzer macht nichts → Aquaman schiebt überfällige Aufgaben
     automatisch zum nächsten passenden Tag (Auto-Reschedule)
   → Kein Aufgaben-Stau, kein schlechtes Gewissen, keine rote Flut
   → Optional: Snooze-Button ("Morgen / Wochenende / +3 Tage") für alles

Alle 1–2 Wochen: Wasserwerte messen
   → Messwerte-Formular (vorbereitet für Aquarien-Typ)
   → Verlauf-Chart zeigt Trends
   → Ziel-Bereiche (freshwater/saltwater) als Referenzbänder

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

- Felder: Name, Wassermenge (Liter), Wasser-Typ (fresh/salt), Pflanzen-Besatz (Liste: Name + Menge), Fischbesatz (Liste: Art + Anzahl), Technik (CO2-Anlage ja/nein, Heizung, Filter + Filtertyp)
- Foto-Upload pro Aquarium (jpg/png, im Dateisystem unter `data/uploads/`)
- Erstellen, Bearbeiten, Löschen, Übersicht aller Aquarien
- **Erfolgskriterium:** Zwei Aquarien in unter 5 Minuten angelegt (inkl. Foto)

### 5.2 Pflegeplan (Maintenance Schedule)

**User Story:** *Als Aquarianer will ich pro Aquarium und Aktion festlegen, in welchem Intervall und an welchen Wochentagen sie anfällt, damit der Kalender automatisch entsteht.*

- Vordefinierte Aktionen: Water change, Fertilize, Filter change/clean, Feed + eigene Aktionen
- Pro Tank: Aktion + Intervall (Tage) + bevorzugte Wochentage (MO–SO, z. B. "nur Wochenende")
- Dashboard-Aggregation: "Heute fällig / Überfällig / Diese Woche"
- Pflege-Log: Erledigte Aktionen mit Datum + optionaler Notiz
- **Erfolgskriterium:** Pflegeplan für 2 Aquarien in unter 10 Minuten eingerichtet

### 5.3 Flexible Scheduling — Snooze & Auto-Reschedule ⭐ (Kern-Insight)

**User Story:** *Als gestresster Aquarianer will ich Termine easy verschieben können — und wenn ich nichts abhake, soll die App selbst produktiv nachplanen, damit sich nichts aufstaut.*

- **Snooze pro Aufgabe:** "Morgen", "Wochenende", "+3 Tage", "Eigenes Datum" — 1 Klick/Tap
- **Auto-Reschedule (konfigurierbar, Default: an):** Überfällige, unabgehakte Aufgaben wandern automatisch zum nächsten passenden Wochentag — der Plan bleibt sauber, statt roter Aufgaben-Berg
- **Catch-up-Modus:** Nach Stress-Phase zeigt Aquaman sanft die 1–3 wichtigsten Aufgaben ("If you only do one thing today: water change 240L") statt alles zu listen
- Keine Bestrafungs-UX: keine rot leuchtenden Stau-Listen, kein Nagging; freundlicher, motivierender Ton
- **Erfolgskriterium:** Nutzer verschiebt in < 5 Sekunden; nach 7 Tagen Ignorieren ist der Plan trotzdem aktuell & sauber

### 5.4 Wasserwerte-Tracking (Water Parameters)

**User Story:** *Als Aquarianer will ich Messwerte erfassen und im Verlauf sehen, damit ich Trends erkenne und die AI kontextbezogen beraten kann.*

- Parameter (freshwater): Temperatur (°C), pH, KH (°dKH), GH (°dGH), CO2 (mg/l), NO2 (mg/l), NO3 (mg/l), NH3/NH4 (mg/l), PO4 (mg/l), Fe (mg/l), Cl2 (mg/l), O2 (mg/l)
- Parameter (saltwater): + Salinität (SG), Ca, Mg, Alkalinität
- Ziel-/Warnbereiche aus Recherche eingebaut (pro Wasser-Typ, überschreibbar pro Tank)
- Verlauf-Chart pro Parameter (Linien-Chart, Zielbereich als Band)
- **Erfolgskriterium:** Messung erfasst in < 30 Sekunden; Chart zeigt mind. letzten Monat

### 5.5 Pflegekalender + ICS-Feed

**User Story:** *Als Aquarianer will ich den Pflegeplan als Kalender in Google Calendar abonnieren, damit ich auch mobil erinnert werde.*

- Kalender-Ansicht (Monats-/Wochenansicht) in der App
- ICS-Feed: `/api/calendar.ics?t=<token>` — Token in Settings generierbar/rotierbar
- Events: All-Day-Events, Titel z. B. "Aquaman: Water change — 240L Community Tank"
- Snooze/Auto-Reschedule fließen automatisch in den ICS-Feed ein
- Google-Refresh ~24 h (dokumentiert); App-Kalender ist "live"
- **Erfolgskriterium:** Google Calendar zeigt den Plan nach Abo korrekt; Planänderung erscheint im Feed

### 5.6 AI-Coach & Kalender-Befüllung

**User Story:** *Als Laie will ich Tipps zur Pflege und zu kritischen Werten bekommen, damit ich weiß, was zu tun ist — und die AI soll meinen Kalender pflegen.*

- **AI-Chat-Panel:** Fragen mit Tank-Kontext ("Nitrite is 0.5, what should I do?") → kontextbezogene Antwort
- **Kalender-Befüllung:** AI analysiert Tank-Setup (Besatz, Pflanzen, CO2, Messwerte) → schlägt Pflegeplan vor → **Nutzer bestätigt** (Approval-Gate) → gespeichert
- **Werte-Adjustierung:** Kritischer Wert → AI schlägt Intervall-Anpassung vor (z. B. Nitrat hoch → Wasserwechsel häufiger) → Bestätigung
- **Stress-Awareness:** AI-Kontext enthält "letzte erledigte Pflege" — bei Rückstand sanfte Priorisierung statt Vorwurf ("Focus on water change first")
- **Provider:** Anthropic-kompatible API — z.ai GLM und Claude via Base-URL + Key austauschbar
- **Kostenschutz:** `AQUAMAN_AI_MAX_CALLS_PER_DAY` (Default 20), Zähler transparent in Settings
- **Fallback:** AI offline/ohne Key → alle Kernfunktionen ohne AI nutzbar
- **Disclaimer:** AI-Tipps sind Empfehlungen, keine Medikamenten-Dosierungen; Hinweis auf Fachhandel
- **Erfolgskriterium:** AI-Vorschlag in < 15 s; Kalender-Update nach Bestätigung sichtbar

### 5.7 MCP-Server & OpenClaw

**User Story:** *Als Selfhoster will ich Aquaman via MCP an OpenClaw/ChatGPT anbinden, damit ich remote fragen kann, was zu tun ist.*

- MCP-Server (Streamable HTTP) unter `/mcp` im selben Container
- Tools: `get_tanks`, `get_water_values`, `get_pending_maintenance`, `add_water_test`, `log_maintenance`, `ask_coach`
- Token-Schutz für MCP-Endpoint; Read-Tools frei, Write-Tools nur mit Token
- **Erfolgskriterium:** OpenClaw verbindet sich auf `https://aquaman.cadex64.de/mcp` und beantwortet "What needs to be done today?" korrekt

### 5.8 Docker & Open-Source-Bereitstellung

**User Story:** *Als Community-Mitglied will ich Aquaman per docker compose starten können.*

- Multi-Stage Dockerfile, Image auf ghcr.io via GitHub Actions
- `docker-compose.yml` + `.env.example` (alle Variablen dokumentiert)
- Volume: `/app/data` (SQLite + Uploads)
- Healthcheck `/api/health`
- MIT-Lizenz, README mit Screenshots + TrueNAS-Guide, CONTRIBUTING, SECURITY
- **Erfolgskriterium:** Fremder Selfhoster startet die App < 10 Minuten (nur mit README)

### 5.9 Should-haves (im MVP, nach den Musts)

- **AI-Adjuster** bei kritischen Werten (Teil von 5.6)
- **Statistik-Übersicht:** Fütterungen/Wasserwechsel diesen Monat, AI-Kosten-Rückblick
- **Export/Import:** JSON-Export aller Daten (kein Lock-in), einfacher JSON-Import

### 5.10 Won't-have (v2+, siehe Recherche)

- Sensor-Anbindung & Echtzeitdaten (Home Assistant) — **Architektur aber API-first vorbereitet**
- Mehrbenutzer/OIDC (Authelia/Authentik)
- Web-Push-Erinnerungen
- Futter-/Zukaufsverwaltung, Zucht-Logbuch
- Foto-Vision-AI, Community-Plan-Templates

---

## 6. Erfolgsmetriken

| # | Metrik | Ziel (Monat 1–3) |
|---|--------|------------------|
| 1 | **Eigennutzung:** Dashboard-Check pro Tag | ≥ 1×/Tag, 0 dauerhaft verpasste Pflege-Termine (Snooze/Auto-Reschedule zählt als "gehandelt") |
| 2 | **AI-Nutzen:** Umgesetzte AI-Tipps | ≥ 2–3 echte, umgesetzte Empfehlungen |
| 3 | **Flexibilität (neu):** Stress-Resilienz | Nach bewusster 1-Wochen-Pause ist der Plan ohne manuelle Aufräumarbeiten wieder aktuell |

*(Ergänzend beobachten: Wasserwerte-Erfassungen pro Monat, ICS-Feed-Abrufe, Community-Installationen — keine Launch-Blocker.)*

## 7. Design-Richtung

- **Stil:** Leichtgewichtig, schön, macht Spaß — Dashboard/Grafana-Datenliebe trifft Home-Assistant-Klarheit
- **Mobile-First:** Handy ist das Hauptgerät → Bottom-Navigation am Handy (Dashboard, Tanks, +, Calendar, More), Cards & große Touch-Targets (min. 44px), 1-Tap-Abhaken; Desktop: Sidebar + breite Charts
- **Farbwelt:** dunkles aquatisches Theme als Default (blau/teal Akzente, sanfte Gradients), Light-Mode verfügbar
- **Spaß-Faktor:** sanfte Animationen (Check-Abhaken mit Feedback, Wellen-Separator), große Zahlen/KPIs, Mikro-Confetti bei Streak? (nice-to-have, dezent)
- **Layout:** Cards mit KPIs, Charts (Recharts), Catch-up-Karte oben
- **Sprache:** UI Englisch zuerst; i18n-Struktur von Anfang an, Deutsch als zweite Sprache (v2-final)
- **Kein Nagging:** freundlicher, ermutigender Ton; Überfälliges wird eingereiht, nicht angemarkert

## 8. Technische Rahmenbedingungen (Kurzfassung — Details im Tech Design)

- **Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui + Drizzle + SQLite
- **Deployment:** Docker (multi-stage), ghcr.io-Image, TrueNAS SCALE, Reverse Proxy HTTPS
- **AI:** Anthropic-kompatible API (z.ai GLM / Claude) — Base-URL + Key + Model per Env konfigurierbar
- **MCP:** TypeScript MCP SDK, Streamable HTTP, `/mcp`
- **Kein Multi-User-Auth in v1:** Reverse-Proxy-Auth (Basic/Authelia) empfohlen & dokumentiert
- **Sicherheit:** Env-Keys nie committen, ICS/MCP-Token-Schutz, keine destruktiven MCP-Tools
- **Performance:** Leichtgewichtig — Ladezeiten < 2 s Dashboard (lokales Hosting), kleine Bundles, wenig JS-Ballast

## 9. AI/Automation-Scope

**Scope: Core AI Workflow (in-app) + MCP-Oberfläche**

| Aspekt | Entscheidung |
|--------|--------------|
| Provider | z.ai GLM & Anthropic Claude (Anthropic-kompatible API, austauschbar) |
| Retention/Training | Default-Anbieter-Retention akzeptabel (private Nutzung); Hinweis in Doku |
| Modell-sichtbare Daten | Tank-Profile, Messwerte, Pflege-Logs — keine personenbezogenen Daten |
| Erlaubte Tool-Klassen | Read (frei), Write (Token-Schutz: add_water_test, log_maintenance), keine DELETEs |
| Structured Output | Kalender-Vorschläge als JSON-Schema (action, tank, interval_days, preferred_days) |
| Approval-Gate | AI-Vorschläge werden nie automatisch gespeichert — immer Nutzer-Bestätigung |
| Telemetry | AI-Call-Zähler + Token-Verbrauch + Kosten-Schätzung in DB, sichtbar in Settings |
| Cost Ceiling | `AQUAMAN_AI_MAX_CALLS_PER_DAY` (Default 20) — danach AI pausiert bis Mitternacht |
| Fallback | AI nicht erreichbar → Kernfunktionen voll nutzbar, UI zeigt "AI offline" |
| Evals | Manuelle Testfragen-Katalog (Nitrat hoch? CO2 überschritten?); automatisiert v2 |

## 10. Constraints

- **Budget:** 0 € — nur vorhandene Keys & Hardware
- **Timeline:** 2–4 Wochen Freizeit-Tempo
- **Open Source:** MIT, öffentliches Repo, keine proprietären Abhängigkeiten
- **Selfhosting:** Keine Cloud-Dienste, keine Telemetrie nach außen
- **Betrieb:** TrueNAS SCALE (Docker), Domain aquaman.cadex64.de, HTTPS via Reverse Proxy
- **Sprache:** Englisch zuerst (Community), Deutsch via i18n
- **Level A:** AI schreibt den Code, Owner testet — klare Struktur, gute Fehlerbehandlung, verständliche Doku

## 11. Definition of Done

- [ ] Alle Must-have-Features (5.1–5.8) implementiert & getestet
- [ ] Snooze & Auto-Reschedule funktionieren und fließen in ICS ein
- [ ] Mobile-First-UI: alle Kernaktionen am Handy in ≤ 2 Taps erreichbar
- [ ] Docker-Image auf ghcr.io, `docker compose up` startet die App
- [ ] ICS-Feed in Google Calendar abonniert & korrekt
- [ ] MCP-Server von externem Client (OpenClaw) erfolgreich getestet
- [ ] AI-Coach beantwortet Kontext-Fragen korrekt & mit Disclaimer
- [ ] Approval-Gates: kein AI-Schreibzugriff ohne Bestätigung
- [ ] AI-Kostendeckel greift & zählt transparent
- [ ] AI-Fallback: App ohne AI-Key voll funktionsfähig
- [ ] Daten-Export (JSON) funktioniert
- [ ] README: Installation < 10 Min für Fremde nachvollziehbar
- [ ] `.env.example` vollständig, keine Keys im Repo
- [ ] MIT-Lizenz, CONTRIBUTING, SECURITY vorhanden
- [ ] Erste echte Nutzung: beide Aquarien + Pflegeplan + ICS-Feed produktiv

---

```json
{
  "appName": "Aquaman",
  "oneLiner": "Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling, ICS calendar feed and MCP server",
  "targetUsers": "Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE",
  "phase": "Foundation",
  "mustHave": [
    "Tank management with photos & specs",
    "Maintenance schedules with weekday selection",
    "Flexible scheduling: snooze & auto-reschedule of overdue tasks",
    "Water parameter tracking with charts",
    "ICS calendar feed for Google Calendar",
    "AI coach & calendar auto-fill with approval gates",
    "MCP server for OpenClaw/ChatGPT integration",
    "Docker deployment via docker compose",
    "Mobile-first dashboard with due/overdue/upcoming tasks"
  ],
  "niceToHave": [
    "AI interval adjustment on critical values",
    "Catch-up mode highlighting top priority task",
    "Usage statistics (feedings, water changes, AI cost)",
    "JSON export/import of all data"
  ],
  "notInMvp": [
    "Sensor integration & real-time data",
    "Multi-user / OIDC auth",
    "Web push notifications",
    "Food/inventory management",
    "Breeding logbook",
    "Photo vision AI",
    "Community plan templates"
  ],
  "successMetrics": [
    "Owner uses dashboard at least once daily, zero permanently missed maintenance (snooze/auto-reschedule counts as handled)",
    "At least 2-3 real AI recommendations implemented by owner",
    "Plan stays clean without manual cleanup after a 1-week stress pause"
  ]
}
```
