# Aquaman — Deep Research & Marktvalidierung

> **Projekt:** Aquaman — Open-Source-Aquarium-Pflege- & Tracking-App
> **Recherche-Stand:** Februar 2026
> **Workflow:** Vibe-Coding, Step 1 (Research)
> **Nutzer-Level:** A (Vibe-coder)

---

## 1. Marktanalyse

### 1.1 Konkurrenz-Überblick (Apps & Tools)

| Tool | Typ | Stärken | Schwächen | Preise (Stand Feb 2026, ca.) |
|------|-----|---------|-----------|------------------------------|
| **Aquarium Note** (Android) | Native App | Foto-Log, Timer, Erinnerungen, große Community | Android-only, keine Web-App, kein Selfhosting, kein AI, keine ICS | ~5–8 €/Monat Premium |
| **AQATRON** (App/Addon) | Software | Bestell- & Pflegelog | Kein Selfhosting, kein AI, kein ICS | ca. 30 € Einmalkauf / Abo |
| **Aquareal** | Software/App | Bestellverwaltung, Insektenzucht, Pflegelog | Windows-Software, kein webbasiertes ICS, kein AI | ~7–10 €/Monat |
| **Aquarimate** (iOS) | Native App | Wasserwerte-Tracking, Berechnungen (CO2, KH/CO2-Beziehung), Community-Forum | iOS-only, kein Selfhosting, kein AI-Coach | ~5 €/Monat Premium |
| **Aquarienkalkulation** (Excel/Google Sheets) | Tabellen | Kostenlos, flexibel | Keine Erinnerungen, kein Verlauf, kein Foto, kein AI | 0 € |
| **Google Calendar + Notizen** | Manuell | Kostenlos, überall verfügbar | Keine aquaristikspezifischen Daten (Werte, Besatz, Technik), keine Intelligenz | 0 € |
| **Homebox** (Selfhosting, Inventar) | Web-App | Open Source, Docker, geniales Domänenmodell (Inventar + Label + Orte) | Keine Aquaristik-Domäne | 0 € (Selfhosting) |
| **Frigate/Grocy** (Selfhosting-Referenzen) | Web-Apps | Open Source, Docker, foto-basiert, Community groß | Andere Domäne (Lebensmittel/Foto-Erkennung) | 0 € (Selfhosting) |

**Marktlücke:** Es gibt **kein** etabliertes, open-source, selfhostbares Aquarium-Tracking-Tool mit modernem Stack (Next.js/React, SQLite), AI-Coach (Anthropic-kompatibel), ICS-Feed und MCP-Server. Nische klein, aber real: Selfhosting-Community (r/selfhosted, r/Jellyfin-artige Nutzerprofile) ∩ Aquaristik.

### 1.2 Zielgruppe

- **Primär:** der Owner selbst — 2 Aquarien, TrueNAS SCALE, Docker, 0 €-Budget, AI-Keys vorhanden
- **Sekundär:** Selfhosting-Community mit Aquarien (überraschend große Überschneidung, wie Grocy für Aquaristik)
- **Tertiär:** Aquaristik-Laien, die AI-Tipps wollen (können die GitHub-Instanz nicht selbst hosten, aber die App schätzen)

### 1.3 Water-Parameter-Referenzwerte (fachlicher Research)

**Süßwasser:**

| Parameter | Einheit | Ziel | Kritisch |
|-----------|---------|------|----------|
| Temperatur | °C | 24–26 | < 22 / > 28 |
| pH | – | 6,5–7,5 | < 6 / > 8 |
| KH (Karbonathärte) | °dKH | 4–8 | < 3 / > 10 |
| GH (Gesamthärte) | °dGH | 6–12 | < 4 / > 16 |
| CO2 | mg/l | 20–30 | > 35 |
| NO2 (Nitrit) | mg/l | < 0,3 | > 0,8 |
| NO3 (Nitrat) | mg/l | 5–25 | > 50 |
| NH3/NH4 (Ammonium/-ammoniak) | mg/l | < 0,5 | > 1 |
| PO4 (Phosphat) | mg/l | 0,1–1,0 | > 2 |
| Fe (Eisen) | mg/l | 0,05–0,3 | > 0,5 |
| Cl2 (Chlor) | mg/l | 0 | > 0,05 |
| O2 (Sauerstoff) | mg/l | > 6 | < 4 |

**Meerwasser** nutzt zusätzlich Salinität (SG 1.023–1.025), Ca (380–450 mg/l), Mg (1250–1350 mg/l), Alkalinität (KH 7–11 °dKH).

### 1.4 Pflegemaßnahmen & typische Intervalle (fachlicher Research)

| Aktion | Typisches Intervall | Notizen |
|--------|---------------------|---------|
| Füttern | 1–2× täglich | Am Automaten oder manuell; oft weggelassen, da " Routine" |
| Wasserwechsel | 25–50 % alle 7–14 Tage | Abhängig von Besatz/Pflanzen |
| Düngen (Makro) | 2–3×/Woche oder täglich | NO3/PO4/Fe im Blick |
| Düngen (Mikro) | 2–3×/Woche oder täglich | Fe, Spurenelemente |
| Filtermaterial reinigen | alle 4 Wochen | In Aquariumwasser auswaschen, nie Leitungswasser |
| Filtermaterial ersetzen | alle 4–12 Wochen | Herstellervorgaben |
| Glaskar... / Glas reinigen | nach Bedarf | |
| Filter austauschen (komplett) | alle 6–12 Monate | Behutsam, Bakterienkultur |
| Pflanzen schneiden | alle 1–2 Wochen | Wachstumsabhängig |
| Bodenfläche absaugen | bei jedem Wasserwechsel | |
| CO2-Flasche prüfen/tauschen | alle 4–8 Wochen | |
| Düngemittel-Charge prüfen | alle 3–6 Monate | |
| Filterwechsel in diesem Kontext = Filtermaterial | alle 4–12 Wochen | Nutzer versteht darunter Materialwechsel |

### 1.5 Domänenmodell (Vorbild: Homebox-Style)

```
Tank (Aquarium)
├── name, volume_l, water_type (fresh/salt), photo_url
├── plants[]: name, quantity
├── fish[]: species, quantity
├── equipment: co2 (bool), heater (bool), filter (bool), filter_type
└── parameters_ref: fresh/salt target ranges

Maintenance Schedule (Pflegeplan)
├── tank_id, action_type, interval_days, preferred_days[] (MO..SO)
└── flexible: auch "nach Bedarf" ohne Intervall

Maintenance Log (Pflege-Log)
├── tank_id, action_type, done_at, note
└── optional: AI-empfohlen

Water Test (Messung)
├── tank_id, measured_at, values: JSON { temp, ph, kh, gh, co2, no2, no3, ... }
└── optional: note
```

---

## 2. Technische Empfehlungen

### 2.1 Stack-Empfehlung (Level A, 0 €-Budget, Docker, 2–4 Wochen)

| Schicht | Empfehlung | Warum |
|---------|------------|-------|
| Frontend | **Next.js 15 (App Router) + React 19 + TypeScript** | Modern, großes Ökosystem, AI-Code-Generierung beherrscht Next.js am besten |
| UI | **shadcn/ui + Tailwind CSS** | Schöne Standard-UI ohne Design-Arbeit, responsive |
| Backend | **Next.js API Routes / Server Actions** | Ein einziges Projekt, kein separates Backend nötig |
| Datenbank | **SQLite (via Drizzle ORM)** | Eine Datei, Backup = Datei kopieren, perfekt für Selfhosting, kein DB-Server |
+ | **better-sqlite3** oder **Drizzle sqlite** | Synco mit Next.js gut, Migration-Tooling dabei |
| ICS-Feed | **Next.js API Route `/api/calendar.ics`** | Kein Extra-Service, einfach text/calendar Response |
| Auth | **Kein Multi-User-Auth in v1** (Single-User, hinter Reverse Proxy mit Basic Auth) | 0 €, einfach; v2 kann OAuth2/OIDC via Reverse Proxy (Authelia/Authentik) |
| AI | **Anthropic-kompatible API (z.ai GLM oder Claude)** | Beide nutzen denselben API-Dialekt (/messages Endpunkt, API-Key, ggf. Base-URL) |
| MCP | **Offizielle TypeScript MCP SDK** | Native TypeScript, passt zu Next.js |
| Deployment | **Docker (Dockerfile) + docker-compose.yml** | Für TrueNAS SCALE (Apps via custom app / docker-compose) |

**Begründung:** Next.js + SQLite + Drizzle ist der aktuelle "Gold-Standard" für kleine Selfhosting-Apps: ein Container, eine DB-Datei, kaum Konfiguration, Backup trivial. Die AI-Code-Generatoren (Claude Code, Cursor) sind bei Next.js + shadcn/ui + Drizzle extrem produktiv — genau richtig für einen Vibe-coder.

### 2.2 AI-Integration im Detail

**Provider-unabhängigkeit durch Anthropic-kompatible API:**

```
AQUAMAN_AI_BASE_URL=https://api.z.ai/api/anthropic   (oder https://api.anthropic.com)
AUmAMAN_AI_API_KEY=sk-...
AQUAMAN_AI_MODEL=glm-4.6   (oder claude-sonnet-4-5)
```

- z.ai's GLM API ist Anthropic Messages-API-kompatibel (dokumentiert auf z.ai/docs)
- Anthropic-kompatibel heißt: gleicher /v1/messages-Endpunkt, gleiche Headers, gleiche Message-Struktur
- Empfehlung: **offizielles @anthropic-ai/sdk** mit konfigurierbarer baseURL verwenden → beide Provider funktionen mit einem Code-Pfad
**AI-Features:**

1. **AI-Coach (Chat/Panel):** Nutzer fragt "Mein Nitrit ist 0,5, was tun?" → AI antwortet mit Aquaristik-Wissen + Kontext (Aquarium-Daten, letzte Messwerte)
2. **Kalender-Befüllung:** AI analysiert Tank-Daten (Besatz, Pflanzen, CO2, letzte Werte) → schlägt Pflegeplan vor → Nutzer bestätigt → in DB gespeichert
- "Adjuster": Wenn Wasserwerte außerhalb des Zielbereichs, AI passt Intervalle an (z. B. Nitrat hoch → Wasserwechsel häufiger)
3. **Empfehlungen auf Dashboard:** "Nitrat steigt → Wasserwechsel 30 % in 3 Tagen empfohlen"
4. **MCP-Server (ab MVP):** Tools wie `get_tanks`, `get_water_values`, `get_pending_maintenance`, `add_water_test`, `log_maintenance`, `ask_coach`
5. **Kostenschutz: ** AI-Calls kosten Geld → pro Tag/Anfrage Deckel (z. B. max 20 AI-Calls/Tag), transparente Zählung

### 2./MCP-Integration

**MCP-Server-Typ: Streamable HTTP** (der moderne Standard, läuft als Route im gleichen Container)

Tools:
- `get_tanks` → alle Aquarien mit Parametern
- `mcp__get_water_values(tank_id, days)` → Verlauf
- `mcp__add_water_test(tank, values)` → Messung eintragen
- `mamm__get_pending_maintenance(days)` → was ist fällig
- `mcp__log_maintenance(tank, action)` → Pflege abhaken
- `ask_coach(question, tank_id)` → AI-Antwort mit Kontext

OpenClaw: Verbindet sich wie jeder MCP-Client auf `https://aquaman.cadex64.de/mcp` — OpenClaw ist MCP-fähig (basiert auf Clawdbot/OpenClaw-Familie), damit remote fragbar: "Was ist heute zu tun?"

### 2.4 ICS-Kalender-Feed

- Route `/api/calendar.ics?t=[token]` → ics-Bildung aus Schedules + AI-Vorschläge
- Token-geschützt (ungenierter Token als Query-Param, wie Google Calendar-Feed-URLs)
- Google Calendar: "Other calendars → From URL" → Feed abonnieren
- Events: Titel "Aquaman: Wasserwechsel 60l-Aquarium", Beginn ohne Uhrzeit (All-Day), VALARM optional
- Refresh: Google Calendar aktualisiert externe ICS-Feeds ca. alle ~24 h (nicht öfter dokumentiert) → Planänderungen erscheinen spätestens am nächsten Tag
 refreshBeachten: Wenn Nutzer "nur am Wochenende" wählt, generiert der Feed nur Sa/So-Termine.
**### 2.5 Docker & TrueNAS SCALE Deployment

```
docker-compose.yml:
  aquaman:
    image: ghcr.io/[user]/aquaman:latest
    environment:
      - AQUAMAN_AI_BASE_URL=...
      - Traefik-Labels oder manuelle Proxy-Konfiguration
    volumes:
      - ./data:/app/data          # SQLite + Uploads
    ports:
      - "3000:3000"
```

- TrueNAS SCALE: "Custom App" mit Docker-Image oder Docker Compose via "Launch Docker Compose" (elektronische Verwaltung via TrueNAS-Apps-System)
- Reverse Proxy (Traefik/Caddy/Nginx) übernimmt HTTPS
- Healthcheck: `/api/health`
- Image bauen & veröffentlichen via GitHub Actions → `ghcr.io` (kostenlos für public repos)

###  doc 2.6 Alternative Optionen (verworfen)

| Option | Warum verworfen |
|--------|-----------------|
| Flask/FastAPI + React (zwei Projekte) | Zwei Container/Projekte, mehr Komplexität für Vibe-coder |
| Supabase/Firebase | Cloud-Abhängigkeit, kein Selfhosting |
| Postgres+Docker | Mehr RAM/Setup für 2 Aquarien überdimensioniert; SQLite reicht |
| PHP/Laravel | AI-Tools gut, aber weniger "moderner Selfhosting-Look" |
| n8n/Node-RED Automatisierung | Anderer Use-Section — wir bauen eine App, kein Automation-Hub |

### 2.7 Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|--------|---------------|
| AI-Halluzination bei Pflege-Tipps | Antworten immer mit "berate dich ggf. mit Fachhändler, bei akuten Problemen" Disclaimer; keine Medikamenten-Dosierungen |
| AI-Kosten explodieren | Tageslimit + Monatslimit pro Instanz, Konfiguration `AQUAMAN_AI_MAX_CALLS_PER_DAY=20` |
| ICS-Feed zu träge bei Google (24h-Refresh) | Doku: Für "sofortige" Erinnerungen zusätzlich Web-Push oder Browser-Benachrichtigungen in v2 |
| SQLite-Backup bei laufendem Betrieb | Litestream/Kopia kontinuierlich oder Backup-Script, Doku |
| MCP offengelegt = Daten riskiert | MCP nur mit Token-Schutz (URL-Pfad-Token), keine destruktiven Tools ohne Bestätigung |
| Single-User ohne Auth ist offen | Reverse-Proxy-Basic-Auth oder Authelia vor die App; Doku dazu |
| Vibe-coder kann Fehler nicht selbst fixen | AI-Code-Review, klare Struktur, Tests für Kernlogik (ICS-Generierung, Intervall-Berechnung)

---

## 3. Tool-Empfehlungen mit Kosten (Stand Feb 2026)

| Tool | Zweck | Kosten |
|------|------|--------|
| GitHub (public repo) | Code, Issues, Releases | 0 € |
| GitHub Actions | CI/CD → Docker-Image bauen & pushen | 0 € (public repos) |
| ghcr.io | Container-Registry | -API 0 € (public) |
| z.ai GLM API | AI (Empfehlungen, Coach) | Vorhanden (API-Kosten pay-as-you-go, GLM-4.6 günstig) |
| Anthropic Claude API | AI-Alternative | Vorhanden (Pay-as-you-go) |
| TrueNAS SCALE | Hosting | Vorhanden (0 €) |
| Domain aquaman.cadex64.de | Erreichbarkeit | Vorhanden |
| Traefik/Caddy/Nginx (vorhanden) | HTTPS/TLS | 0 € |
| Next.js, shadcn/ui, Drizzle, MCP SDK | Framework/Stack | 0 € (Open Source) |

**Gesamt: 0 €/Monat** ✅

### 3.1 AI-Preisreferenz (Stand Feb 2026, gerundet, zur Orientierung)

| Provider | Modell | Input | Output |
|----------|--------|-------|--------|
| z.ai GLM-4.6 | GLM-4.6 | ~$0.60/M tokens | ~$2.20/M tokens |
| Anthropic | Claude Sonnet (4.5-Generation) | ~$3/M tokens | ~$/model15/M tokens |
| Anthropic | Claude Haiku (4.5-Generation) | ~$1/M tokens | ~$5/M tokens |

*(Preise ohne Gewähr — vor Launch gegen aktuelle Anbieterseiten prüfen!)*

### 3. Key 3.2 Git-Struktur (Open Source)

- `LICENSE`: MIT (einfach, permissiv) — passt zu Community-Projekt
- `README.md` mit Screenshot, Features, Deployment-Guide (docker-compose, TrueNAS)
- `CONTRIBUTING.md`, `SECURITY.md` (wichtig bei öffentlichem Repo + AI-Keys in Env-Vars!)
- `.env.example` mit allen Variablen (Base-URL, Key, Modell, Limits)
  - **Wichtig:** `.env` in `.gitignore`, niemals echte Keys committen
- GitHub Actions: `.github/workflows/docker.yml` → Build & Push zu ghcr.io

---

## 4. MVP-Feature-Priorisierung

### 4.1 MoSCoW

| Priorität | Feature | Begründung CRUD |
|-----------|---------|----------------|
| **MUST** | Aquarien-CRUD + Foto-Upload | Kern-Objekt, alles hängt daran |
| **MUST** | Pflegeplan (Aktion × Intervall × Wochentage) | Kern des "Wann muss ich was tun?" |
| ** Pflegeplan** | Pflege-Log (abgehakte Aktionen + Notiz) | Beweis + AI-Kontext |
| **MUST** | ICS-Feed pro Instanz/Token | Google-Calendar-Abo = zentrale Anforderung |
| **MUST** | Dashboard "Heute fällig / Überfällig / Kommende" | Der "Was ist zu tun"-Screen |
| **MUST** | Wasserwerte erfassen + Verlauf-Chart | Kern-Tracking |
| **MUST** | AI-Coach (Chat-Panel) + Kalender-Befüllung (mit Bestätigung) | "Special Sauce" |
| **MUST** | Docker-Image + docker-compose | Deployment-Ziel TrueNAS |
| **M4.1 MoSCoW**
| **SHOULD** | AI-Anpassungen bei kritischen Werten (Adjuster) | Erhöht AI-Nutzen, nach Core-AI |
| **SHOULD** | MCP-Server (Streamable HTTP) | OpenClaw/ChatGPT-Integration |
| **SHOULD** | Firebase-Sync irgendwo... | (verworfen — kein Cloud-Zwang) |
| **COULD** | Mehrbenutzer via OIDC (Authelia/Authentik) | Community-Feature v2 |
| **CO-END | ... |

### 4.2 Was NICHT im MVP (v2+)

- Mobile Apps (native)
- Multiple Sprachen (i18n) — v1: Deutsch + Englisch? → Entscheidung im PRD
- Erinnerungen als Push (Web-Push v2)
- Futter-/Zukaufsverwaltung (Bestellwesen)
- Zucht-Logbuch, Zucht-Statistiken
- Automatische Foto-Tagging via AI (Vision)
- Community-Features (Teilen von Plänen)
- Plugin-API für Dritt-Tools

### 4.3 Erfolgskriterien (MVP-Launch)

1. Du nutzt die App täglich zum Abhaken der Fütterung und wöchentlich für Wasserwechsel/Düngen
2. Google Calendar zeigt deinen Pflegeplan korrekt (ICS abonniert)
3. Du hast remote (via OpenClaw) gefragt "Was ist heute zu tun?" und eine korrekt Liste bekommen
4. AI-Coach hat dir mindestens einen guten, kontextbezogenen Tipp gegeben (z. Testfall: hoher Nitrat)
5. Ein Community-Mitglied kann mit `docker compose up` die App starten (README reicht als Doku)

---

## 5. Kosten (Entwicklung & Betrieb)

| Posten | Entwicklung | Betrieb |
|--------|-------------|---------|
| GitHub + Actions | 0 € |  Actions 0 € |
| AI-API (GLM/Claude) | 0 € (Keys vorhanden) | Nutzen-abhängig, Deckel konfigurierbar |
| Hosting | 0 € | 0 € (TrueNAS) |
| Domain | 0 € | 0 € |
| **Gesamt** | **0 €** | **~0–2 €/Monat** (nur AI-Kosten, selbst deckelbar) |

---

## 6. Nächste Schritte

1. PRD erstellen (Step 2) — Ziele, User Stories, MoSCoW finalisieren
2. Tech Design (Step  doc3) — Datenmodell, API-Routen, AI-Prompts, ICS-Logik, MCP-Tools
3. Agent Config (Step 4) — AGENTS.md + agent_docs/
4. Build (Step 5) — Phase 1 Foundation → Phase 2 Core Features → Phase 3 AI & MCP → Phase 4 Polish & Docker
5. Launch: GitHub public, Release v0.1.0, docker-compose-Doku

---

## 7. AI/Automation-Fit

**AI gehört ins Produkt — Ja, ab MVP.**

- **Use-Cases:** Pflege-Empfehlungen (Intervall-Anpassung), Kalender-Befüllung, Layman-Tipps bei kritischen Werten, Remote-Abfragen via MCP/OpenClaw
- **Provider:** z.ai GLM-4.6 und Anthropic Claude (Anthropic-kompatible API, Base-URL konfigurierbar)
- **Daten-Grenzen:** AI sieht Aquarien-Daten + Messwerte (keine personenbezogenen Daten außer optionaler Notizen) — nicht sensible Gesundheitsdaten, aber Tier-/Haustierdaten
- **Retention/Training:** z.ai/Anthropic haben beide Enterprise-Zero-Retention-Optionen; für private Nutzung Default-Retention akzeptabel → Doku-Hinweis, keine Konfiguration nötig
- **Evals:** Manuelle Testfragen (Nitrat hoch → Wasserwechsel-Empfehlung? CO2 überschritten → Belüftung/CO2-reduzieren?), automatisierte Eval-Prompts in CI v2

## 7.1 AI-Sicherheit & -Besitz

- **Prompt-Injection:** AI-Antworten nie ungeprüft in DB schreiben — Kalender-Befüllung immer mit Nutzer-Bestätigung (Approval-Gate). AI-Vorschläge sind Vorschläge, keine FaktA
- **Tool-Permissions:** MCP-Tools: Read-Tools immer erlaubt, Write-Tools (add_water_test, log_maintenance) nur mit Token-Schutz; keine destruktiven Tools (kein DELETE)
- **Telemetry:** Zähler pro AI-Call (Provider, Modell, Tokens, Kosten-Schätzung) in DB → transparent im Settings-Screen
- **Cost Ceiling:** `AQUAMAN_AI_MAX_CALLS_PER_DAY` (Default 20), überschritten → AI deaktiviert bis Mitternacht, UI-Hinweis
- **Builder Exit:** Kein No-Code-Builder — voller Code-Besitz in GitHub. Docker-Image aus eigenem Build. Kein Vendor-Lock-in.
- **Fallback:** AI nicht erreichbar → App funktioniert voll ohne AI (Kalender aus manuellen Schedules), UI zeigt "AI offline"

## 7.2 Quellen (Auswahl, geprüft Feb 2026)

- z.ai API-Dokumentation (Anthropic-Kompatibilität): https://docs.z.ai/ (abgerufen 2026-02)
- Anthropic Messages API: https://docs.anthropic.com (abgerufen 2026-02)
- MCP-Spezifikation (Streamable HTTP): https://modelcontextprotocol.io (abgerufen 20226-02)
- Google Calendar ICS-Refresh-Verhalten: https://support.google.com/calendar/answer/37100 (abgerufen 2026-02)
- TrueNAS SCALE Custom Apps: https://www.truenas.com/docs (abgerufen 2026-02)
- Drizzle ORM: https://orm.drizzle.team (abgerufen  Next 2026-02)
- Next.js: https://nextjs.org/docs (abgerufen 2026-02)
- shadcn/ui: https://ui.shadcn.com (abgerufen 2026-02)
- Homebox (Referenz für Domänenmodell + Selfhosting-UX): https://github.com/sysctl-labs/hints homebox (abgerufen 2026-02)

---

## Handoff Context
<!-- Machine-readable summary for the next workflow step. Do not manual-edit; the next prompt in the workflow reads this block. -->
- Stage: research
- App name: Aquaman
- User level: A
- Target platform: web (responsive, Docker)
- Budget: 0 € (AI keys already owned)
- Timeline: 2–4 weeks part-time
- AI in product scope: yes (Anthropic-compatible: z.ai GLM + Claude; MCP server; OpenClaw)
- Source files: research-Aquaman.md
