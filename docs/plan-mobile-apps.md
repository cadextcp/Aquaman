# Plan — iOS- & Android-App aus Aquaman

> **Status: Stufe 0 umgesetzt, Stufe 1+ weiter Entwurf.** Der Owner hat Stufe 0
> (PWA-Härtung) beschlossen; sie ist gebaut — siehe §3. Alles ab Stufe 1 bleibt
> ein Vorschlag zur Entscheidung. PRD (`PRD-Aquaman-MVP.md`) und Tech Design
> (`TechDesign-Aquaman-MVP.md`) bleiben unverändert, bis eine weitere Stufe
> ausdrücklich beschlossen ist.
> Erstellt: 2026-09 · Basis: `main` @ `6fb2487`

---

## 1. Ausgangslage — was trägt, was blockiert

Bevor irgendein App-Weg bewertet wird, muss klar sein, was der Code heute hergibt.

### Was trägt

| Baustein | Zustand | Warum das zählt |
|----------|---------|-----------------|
| **REST-API `/api/v1/*`** | 16 Pfade, Bearer-gated, OpenAPI-Spec (`src/lib/api/openapi.ts`), einheitliche `{error, code}`-Hülle | Das ist das Fundament. Ein nativer Client braucht kein neues Backend, nur ein paar Lücken (§4.1) |
| **API-Token** | `src/lib/api-token.ts`, in `appSettings`, anzeigbar & rotierbar unter *More → API* | Fertiges Auth-Modell für eine App. Kein OIDC nötig |
| **Domänenlogik pure** | `src/lib/domain/*` (scheduler, dates, ranges, action-types, plan-structure) ohne DB-/React-Abhängigkeit | Kann 1:1 in einen RN-Client geteilt werden, statt Terminlogik ein zweites Mal zu schreiben (§4.5) |
| **i18n-Kataloge** | `src/i18n/{en,de}.json`, flache Dot-Keys, eigener `t()` | Teilbar wie die Domäne — keine Bibliotheks-Bindung im Weg |
| **UI ist bereits Mobile-First** | Bottom-Nav, ≥ 44px Touch-Targets, `min-h-dvh`, dunkles Theme, `next/font` self-hosted | Eine WebView fühlt sich sofort brauchbar an, nicht wie eine geschrumpfte Desktop-Seite |
| **`/api/health` ohne Auth** | `{status, db, time}` | Erlaubt der App, „Server nicht erreichbar" von „Token falsch" zu unterscheiden (§4.2) |

### Was blockiert

| Blocker | Konsequenz |
|---------|-----------|
| **RSC + Server Actions + `output: 'standalone'`** | `next export` ist ausgeschlossen. Die Next-App kann **nicht** in ein App-Bundle gepackt werden — sie bleibt serverseitig. Jeder App-Weg ist entweder WebView-auf-Server oder eigener Client auf der REST-API |
| **better-sqlite3 / sharp** (native, serverseitig) | Kein „local-first, DB im Handy" ohne kompletten Rewrite. Nicht Teil dieses Plans |
| **Kein CORS irgendwo** (`grep Access-Control` → 0 Treffer) | Eine WebView unter `capacitor://localhost` bekommt bei `fetch` auf den Server sofort CORS-Fehler. Nur relevant, wenn Web-Code außerhalb der Server-Origin läuft |
| ~~Kein PWA-Manifest, kein Service Worker, keine App-Icons~~ | **Erledigt in Stufe 0.** Manifest-Route, Icon-Satz, Offline-Shell und die Apple-Meta-Tags stehen |
| **API-Lücken:** Coach, Settings, Uploads/Fotos, Export, Statistik | `/api/coach`, `/api/export`, `/api/settings/*` liegen **außerhalb** von `/api/v1` und sind nicht Bearer-gated — für Browser-Sessions gebaut. Eine Upload-Route existiert überhaupt nicht |
| **Kein Auth in v1, Reverse-Proxy davor** | Steht Authelia o. ä. davor, bekommt die App HTML-Login-Seiten statt JSON. Muss dokumentiert und im Client erkannt werden (§4.4) |
| **`AQUAMAN_TIMEZONE` regiert „heute"** | Die App darf Tagesgrenzen **niemals** aus der Gerätezeitzone ableiten. Sie muss die Server-TZ kennen → braucht einen Settings-Endpoint (§4.1) |
| **Rate-Limit 30 Fehlversuche/IP/h + 404 statt 401** | Ein tippender Nutzer sperrt sich für eine Stunde aus, und 404 ist zwischen „falsche URL" und „falscher Token" nicht unterscheidbar. Löst QR-Pairing (§4.2) |
| **Push ist PRD-„Won't have"** | Erinnerungen dürfen keine Push-Infrastruktur brauchen. Lösung: **lokale** Notifications aus den Terminen (§4.3) — braucht keinen Relay-Server und keine Scope-Erweiterung |

---

## 2. Die drei Wege

| | **A — PWA** | **B — Shell-App (WebView + nativer Rahmen)** | **C — Nativer Client auf der REST-API** |
|---|---|---|---|
| Prinzip | Manifest + Service Worker, „Zum Homescreen" | Expo/React-Native-Hülle mit nativem Onboarding, WebView zeigt den eigenen Server | Eigene Screens, sprechen nur `/api/v1/*` |
| UI-Duplikat | keins | keins | komplett neu |
| Store-fähig | nein | ja (mit Auflagen, §5) | ja |
| Offline | Shell-Cache, Daten nein | wie PWA | echter Cache möglich |
| Notifications | Web-Push (iOS nur ab 16.4 **und** nur installiert) | lokale Notifications, nativ zuverlässig | dito |
| Kamera/Share/Biometrie | eingeschränkt | nativ | nativ |
| Aufwand | **1–2 PT** | **10–15 PT** inkl. Store-Reibung | **+15–30 PT** obendrauf |
| Laufende Kosten | 0 | 99 €/Jahr (Apple) + 25 € einmalig (Google) | dito |
| Risiko | ~0 | Apple-Review 4.2 (§5), TLS im Heimnetz (§4.4) | dazu: Domänenlogik driftet |

### Empfehlung

**Gestufter Weg A → B → C, mit einer harten Entscheidung nach Stufe 0.**

Begründung, entlang der Projektprinzipien („boring, maintainable", „Solve the user
story before adding polish"):

1. **Stufe 0 (PWA) liefert 80 % des gefühlten Nutzens für 2 % des Aufwands.** Icon
   auf dem Homescreen, Vollbild ohne Browser-Chrome, eigener Task-Switcher-Eintrag.
   Für einen Selfhoster mit zwei Becken ist das plausibel schon das Ende der Reise.
2. **Stufe 1 (Shell) ist der einzige Grund, überhaupt in die Stores zu gehen** — und
   der ehrliche Grund heißt *zuverlässige Erinnerungen und Kamera*, nicht „App Store".
   Sie duplizierte keine UI und bleibt damit wartbar.
3. **Stufe 2 (nativ) nur, wenn Stufe 1 nachweislich zu kurz greift.** Sie ist der
   einzige Weg mit dauerhaftem Wartungsaufwand: jede neue Server-Funktion muss dann
   zweimal gebaut werden.

Stufe 1 und 2 sind bewusst **dieselbe Codebasis** (Expo). Der Übergang ist dadurch
kein Rewrite, sondern das Ersetzen einzelner WebView-Screens durch native — Screen
für Screen, jederzeit abbrechbar.

**Verworfen:** Capacitor mit `server.url`. Die Ziel-URL steht dort zur *Build*-Zeit
in `capacitor.config` — ein Selfhoster braucht sie aber zur *Laufzeit*. Der Workaround
ist ein eigener nativer Shell-Screen, also genau das, was Expo ohnehin liefert.
Zwei Toolchains für ein Ergebnis lohnt nicht.

**Ebenfalls verworfen:** getrennte Swift- und Kotlin-Apps. Bei einem Solo-Owner
verdoppelt das die Wartung ohne Gegenwert; die App ist kein Grafik-/Sensor-Kraftakt.

---

## 3. Stufenplan

### Stufe 0 — PWA-Härtung · **umgesetzt** · kein Store, kein Konto

Ziel: Aquaman installiert sich auf iOS und Android vom Browser aus und sieht dabei
aus wie eine App.

1. **`src/app/manifest.ts`** (Next-Route, kein statisches JSON — dann kann sie
   `getLocale()` benutzen und Name/Beschreibung folgen der Spracheinstellung):
   `display: "standalone"`, `start_url: "/"`, `background_color`/`theme_color` aus
   dem Aqua-Theme, `orientation: "portrait"`.
2. **Icons generieren** — `sharp` ist bereits Dependency, also ein
   `scripts/generate-icons.mjs` aus einer Quell-PNG: 192/512 normal **und**
   `purpose: "maskable"` (Android-Adaptive-Icons), plus `apple-touch-icon.png` 180×180.
   *Falle:* iOS ignoriert Manifest-Icons vollständig — ohne `apple-touch-icon` gibt es
   einen Screenshot-Thumbnail auf dem Homescreen.
3. **`viewport` in `layout.tsx`** über den Next-`viewport`-Export: `viewport-fit=cover`
   + `themeColor`. Die `env(safe-area-inset-bottom)`-Paddings in `BottomNav` und
   `body` gab es bereits — sie waren ohne `viewport-fit=cover` nur wirkungslos,
   weil `env()` dann 0 liefert. Nichts nachzurüsten, nur zu aktivieren.
   Dazu `appleWebApp.capable`: Next emittiert daraus nur das moderne
   `mobile-web-app-capable`; ältere iOS-Versionen brauchen zusätzlich das
   apple-präfixierte Tag, sonst startet das Icon doch wieder in Safari.
4. **Service Worker, minimal und defensiv.** Nur statische Assets (`/_next/static/*`,
   Icons, Fonts) precachen, Navigationen network-first mit Offline-Fallback-Seite.
   **Niemals** POSTs cachen — Server Actions sind POSTs auf die eigene Route; ein
   naiver „cache everything"-SW zerstört Abhaken und Snooze. Kein `next-pwa`
   (unmaintained gegenüber App Router), sondern ~40 Zeilen eigener SW in `public/sw.js`
   mit einer Registrierung in einer kleinen Client-Komponente.
5. **Offline-Seite** `src/app/offline/page.tsx` in der Bildsprache der App
   („Kein Kontakt zum Becken") — beide Sprachen, also über `t()`.
6. **Test:** `tests/pwa.test.ts` — Manifest-Route liefert gültiges JSON mit allen
   Pflichtfeldern, jedes referenzierte Icon existiert, alle Strings lösen in `en`
   und `de` auf (sonst schlägt ohnehin `tests/i18n.test.ts` an).

**Definition of Done:** Auf einem echten iPhone und einem echten Android-Gerät
installieren, Vollbild, korrektes Icon, Dashboard → Aufgabe abhaken funktioniert,
Flugmodus zeigt die Offline-Seite statt des Browser-Dinosauriers.

**Stand:** Lint, Typecheck, 355 Tests und Build sind grün; Manifest, Icons,
Meta-Tags und beide Sprachen sind gegen den laufenden Produktions-Build geprüft,
und der Service-Worker-Lebenszyklus (Registrierung → Precache → Offline-Seite bei
gestopptem Server) ist über das DevTools-Protokoll in Chromium nachgewiesen.
**Offen bleibt die Gerätefreigabe durch den Owner** — echtes iPhone und echtes
Android-Gerät, wie `agent_docs/testing.md` sie vor jedem Release verlangt.
Der Installationsdialog erscheint nur über HTTPS, also nicht am `http://`-Testport.

> **Entscheidungspunkt.** Erst hier lässt sich ehrlich beurteilen, ob Stufe 1
> überhaupt gebraucht wird. Diese Frage nicht vorher beantworten.

---

### Stufe 1 — Expo-Shell-App · 10–15 PT · Store-fähig

Ziel: eine App in TestFlight/Play, die *nativ* das kann, was der Browser nicht
zuverlässig kann — erinnern, fotografieren, sich den Server merken.

**Was nativ ist:**

- **Onboarding/Pairing** — Server-URL + Token, per QR (§4.2). Token in
  `expo-secure-store` (iOS Keychain / Android Keystore), nie in AsyncStorage.
- **Lokale Erinnerungen** — `expo-notifications`, gespeist aus `GET /api/v1/tasks` (§4.3).
- **Kamera/Share-Sheet** — für Beckenfotos, sobald die Upload-Route existiert (§4.1).
- **App-Lock** — `expo-local-authentication` (Face ID/Fingerabdruck). Wichtiger, als es
  klingt: die App hält einen Token, der die gesamte API öffnet, und v1 kennt kein Login.

**Was WebView ist:** alles andere — `react-native-webview` auf die konfigurierte
Server-URL, mit `sharedCookiesEnabled`, Pull-to-Refresh und einem Fehler-Screen, der
zwischen „offline", „Server weg" und „Reverse Proxy will Login" unterscheidet.

**Struktur:** eigenes Verzeichnis `mobile/` im selben Repo (kein zweites Repo — sonst
driften Domäne und i18n sofort), npm-Workspace, eigene CI-Lane. Build über **EAS Build**,
damit iOS-Builds ohne eigenen Mac laufen.

**Reihenfolge:**

1. `mobile/` mit Expo (SDK aktuell), TypeScript strict, ESLint aus dem Repo-Preset.
2. Pairing-Screen + Secure Store + Verbindungsdiagnose (§4.2) → gegen die echte
   Instanz getestet, bevor irgendein WebView-Code entsteht.
3. WebView-Screen + Fehlerbehandlung + Deep-Link `aquaman://` auf Tank/Aufgabe.
4. `GET /api/v1/settings` anbinden (Zeitzone + Locale, §4.1) — **vor** den Notifications,
   die hängen daran.
5. Lokale Notifications inkl. der 64-Notification-Grenze von iOS (§4.3).
6. Kamera → Upload (setzt §4.1 Upload-Route voraus; sonst auf Stufe 1.5 schieben).
7. App-Lock, App-Icons, Splash, Store-Assets.
8. CI: `mobile/` typecheck + test in `ci.yml` als eigener Job; EAS-Build manuell
   getriggert, **nicht** bei jedem Push (Build-Minuten kosten Geld).

**Definition of Done:** interner TestFlight-Build und Play-Internal-Testing-Build
laufen auf echten Geräten; Erinnerung feuert für eine fällige Aufgabe; Abhaken in der
WebView aktualisiert die Erinnerungen; Token übersteht App-Neustart und ist ohne
Biometrie nicht erreichbar.

---

### Stufe 2 — Native Screens, schrittweise · +15–30 PT · optional

Nur beginnen, wenn Stufe 1 im echten Gebrauch an konkreten Stellen scheitert.
Dann Screen für Screen ersetzen, in dieser Reihenfolge (Nutzen pro Aufwand fallend):

1. **Dashboard** — der eine Screen, der täglich mehrfach geöffnet wird. Nativ heißt:
   sofort sichtbar aus dem Cache, Abhaken offline mit späterem Sync.
2. **Abhaken/Snooze** — Swipe-Gesten, Haptik, optimistisches UI.
3. **Wasserwerte erfassen** — nativer Zahlen-Input schlägt jedes Web-Formular am Handy.
4. **Charts** — `victory-native`/Skia statt Recharts.
5. Coach, Einstellungen, Pläne: **bewusst in der WebView lassen.** Selten benutzt,
   viel Formularfläche, ändert sich am häufigsten — genau die Kandidaten, bei denen
   Duplikation am teuersten wäre.

Voraussetzung ist §4.5 (geteilte Domäne), sonst wird Terminlogik ein zweites Mal
implementiert — und das ist laut AGENTS.md Bug-Hotspot #1.

---

## 4. Vorarbeiten am Server (stufenübergreifend)

Diese Punkte sind unabhängig davon, welche Stufe kommt, und mehrere davon sind
ohnehin Server-Verbesserungen.

### 4.1 API-Lücken schließen

Heute deckt `/api/v1/*` Tanks, Schedules, Tasks, Wassertests, Aktionen und Fütterungen ab.
Es fehlen — nach Priorität:

| Endpoint | Warum | Aufwand |
|----------|-------|---------|
| `GET /api/v1/settings` | **Kritisch.** Liefert `{timezone, locale, tightGapDays, aiEnabled}`. Ohne die Server-Zeitzone rechnet die App „heute" in Gerätezeit — genau der 23:30-Fehler, vor dem AGENTS.md warnt. Muss Secrets herausserialisieren (`src/lib/api/serialize.ts` existiert dafür schon) | S |
| `POST /api/v1/tanks/{id}/photo` | Es gibt **gar keine** Upload-Route. `sharp` und `bodySizeLimit: '6mb'` sind vorbereitet, der Rest fehlt. Pfad-Normalisierung + Content-Type-Whitelist beachten (AGENTS.md) | M |
| `GET /api/v1/occurrences?from&to` | **Kritisch für §4.3.** `/api/v1/tasks` liefert nur *offene* Wartung (`getPendingMaintenance`) — künftige Termine gibt es in v1 nirgends. `occurrencesInRange()` existiert bereits und speist ICS/Kalender; hier fehlt nur die Route darüber. Ohne sie kann die App keine Erinnerung für übermorgen stellen | M |
| `POST /api/v1/coach` | `/api/coach` ist Browser-Session-gebunden und nicht Bearer-gated. Für Stufe 2 nötig, für Stufe 1 nicht (WebView deckt es ab) | M |
| `GET /api/v1/export` | `/api/export` ungegated nach v1 spiegeln — Backup vom Handy | S |
| `GET /api/v1/stats` | Nice-to-have, PRD 5.10 | S |

Jeder neue Endpoint: OpenAPI-Eintrag in `src/lib/api/openapi.ts` mitpflegen (die Spec
ist die Client-Vertragsquelle) + Integrationstest nach dem Muster in `tests/`.

### 4.2 Pairing per QR statt Tippen

Ein 32-Zeichen-`base64url`-Token auf einer Handytastatur ist der sicherste Weg, das
Rate-Limit auszulösen — 30 Fehlversuche, dann eine Stunde 429.

- Serverseitig: *More → API* zeigt zusätzlich einen QR-Code mit
  `aquaman://pair?url=<base64url>&token=<token>`. Rendering **clientseitig** aus dem
  bereits angezeigten Token (keine neue Route, kein Token über Dritt-Bibliotheken).
  Hinter einem „Anzeigen"-Klick, damit der Token nicht beiläufig auf einem geteilten
  Bildschirm liegt.
- Clientseitig: Scan → sofort `GET /api/health` (ungegated), dann ein gegateter Call.
  Damit wird die 404-Zweideutigkeit auflösbar:

  | `/api/health` | gegateter Call | Diagnose für den Nutzer |
  |---|---|---|
  | Netzwerkfehler | — | „Server nicht erreichbar — VPN/WLAN prüfen" |
  | HTML statt JSON | — | „Ein Reverse Proxy verlangt Login" (§4.4) |
  | 200 | 404 | „Token ungültig — neu scannen" |
  | 200 | 429 | „Zu viele Fehlversuche, in einer Stunde erneut" |
  | 200 | 200 | verbunden |

  Das ist der Grund, warum kein neuer „Ping"-Endpoint nötig ist.

### 4.3 Erinnerungen ohne Push-Infrastruktur

Web-Push oder APNs/FCM bräuchten einen öffentlichen Relay-Server — für eine
selbstgehostete Single-User-App unverhältnismäßig, und im PRD ausdrücklich
„Won't have". Der Weg ohne Infrastruktur:

Die App holt `GET /api/v1/tasks` (offene Wartung) **und** den neuen
`GET /api/v1/occurrences` (§4.1) für die kommenden Tage — beide rechnet der Server
über `nextDue()`/`occurrencesInRange()`. Daraus plant sie **lokale** Notifications
auf dem Gerät.

Fallen, die dabei zählen:

- **iOS erlaubt max. 64 wartende lokale Notifications.** Also: nur die nächsten ~14 Tage
  planen, nicht die 90-Tage-Horizonte, und bei jedem App-Start neu berechnen.
- **Neu planen bei jedem Foreground** und nach jedem Abhaken/Snooze — sonst erinnert die
  App an etwas, das längst erledigt ist.
- **Uhrzeit in Server-Zeitzone**, nicht Gerätezeit (§4.1).
- **iOS-Background-Fetch ist unzuverlässig** — nie die einzige Aktualisierungsquelle;
  der Vorausplanungs-Puffer trägt die Lücke.

Damit bleibt der PRD-Ausschluss „Web push notifications" wörtlich intakt: es gibt
keinen Push, nur einen Wecker auf dem Gerät.

### 4.4 Netzwerk-Realität: TLS, ATS, Reverse Proxy

Der wahrscheinlichste Grund, warum eine fertige App bei einem Selfhoster nicht
funktioniert. Drei Punkte, alle dokumentationspflichtig im README:

- **iOS ATS** blockiert Klartext-HTTP und selbstsignierte Zertifikate. Reihenfolge der
  Empfehlungen: (1) gültiges Zertifikat, auch für interne Domains via Let's Encrypt
  DNS-01 — der saubere Weg; (2) `NSAllowsLocalNetworking` für RFC1918/`.local`, erlaubt
  HTTP nur im lokalen Netz und ist reviewfähig; (3) eigenes CA-Zertifikat per
  Konfigurationsprofil vertrauen. **Keine** pauschale `NSAllowsArbitraryLoads`-Ausnahme —
  das ist begründungspflichtig im Review und schwächt jede Verbindung.
- **Android 9+** blockiert Klartext ebenfalls → `networkSecurityConfig` mit einer eng
  gefassten Ausnahme, nicht `cleartextTrafficPermitted="true"` global.
- **iOS 14+ Local-Network-Permission**: der erste Zugriff auf eine LAN-Adresse löst
  einen Systemdialog aus. Vorher im Onboarding erklären, sonst wirkt die Ablehnung
  wie ein Bug.
- **Reverse-Proxy-Auth (Authelia o. ä.)** fängt Bearer-Requests ab und liefert HTML.
  Ins README: eine Bypass-Regel für `/api/v1/*` und `/api/calendar.ics` — beide sind
  bereits token-gated, rate-limited und antworten 404 statt 401, tragen ihre
  Absicherung also selbst.

### 4.5 Domänenlogik teilen (nur für Stufe 2)

`src/lib/domain/*` und `src/i18n/*.json` in einen npm-Workspace ziehen
(`packages/domain`, `packages/i18n`), von Next-App **und** `mobile/` konsumiert.

**Als eigener PR, reiner Move, null Logikänderung, Tests unverändert grün.**
AGENTS.md stellt `src/lib/domain/*` unter Änderungsvorbehalt, und `tests/i18n.test.ts`
scannt den Quelltext nach benutzten Keys — der Scan-Pfad muss mitwandern. Diesen
Umbau nicht mit Feature-Arbeit vermischen.

Für Stufe 0 und 1 ist er **nicht** nötig; dort rechnet ausschließlich der Server.

---

## 5. Store-Realität (nur Stufe 1+)

Ehrlich, weil es sonst mitten im Projekt überrascht:

- **Kosten:** Apple Developer Program 99 €/Jahr (laufend), Google Play 25 € einmalig.
- **Apple Guideline 4.2 „Minimum Functionality"** ist das reale Ablehnungsrisiko: eine
  reine WebView-Hülle wird abgelehnt. Die Gegenmittel sind genau die nativen Teile aus
  Stufe 1 — Onboarding, lokale Erinnerungen, Kamera, Biometrie. Diese Teile sind also
  keine Kür, sondern Zulassungsvoraussetzung.
- **Guideline 2.1 „App Completeness"**: das Review braucht eine funktionierende
  Demo-Instanz. Also eine öffentlich erreichbare Aquaman-Instanz mit Demodaten und
  einem Review-Token bereitstellen — sonst sieht der Reviewer nur den Pairing-Screen
  und lehnt ab. Das ist ein eigenes Arbeitspaket, kein Nebensatz.
- **Google Play:** neue Privatentwickler-Konten müssen vor der Produktionsfreigabe ein
  geschlossenes Testing mit 12 Testern über 14 Tage durchlaufen. Für ein Hobbyprojekt
  ist das oft der teuerste Einzelposten — vorab prüfen, ob der bestehende Account das
  bereits erfüllt.
- **Beide Stores** verlangen Datenschutzerklärung (URL) und Datensicherheits-/
  Privacy-Angaben. Für Aquaman erfreulich kurz: keine Telemetrie, keine Drittserver,
  Daten bleiben auf der Instanz des Nutzers — aber die AI-Weiterleitung an
  `AQUAMAN_AI_BASE_URL` muss deklariert werden.

**Alternative ohne Stores**, die für diese Zielgruppe ernsthaft in Frage kommt:
TestFlight für iOS (Builds laufen nach 90 Tagen ab, externe Gruppen brauchen ein
Review) und direkte APK/Obtainium bzw. F-Droid für Android. Kostet 99 €/Jahr statt
99 € + Review-Aufwand + Demo-Instanz.

---

## 6. Arbeitspakete in Reihenfolge

| # | Paket | Stufe | Aufwand | Hängt ab von |
|---|-------|-------|---------|--------------|
| ~~1~~ | ~~Manifest, Icons, Viewport/Safe-Area~~ ✅ | 0 | S | — |
| ~~2~~ | ~~Service Worker + Offline-Seite + PWA-Test~~ ✅ | 0 | S | 1 |
| 3 | **Entscheidungspunkt: reicht die PWA?** | — | — | 2 |
| 4 | `GET /api/v1/settings` (TZ + Locale) | 1 | S | — |
| 5 | QR-Pairing in *More → API* | 1 | S | — |
| 6 | `GET /api/v1/occurrences` + `GET /api/v1/export` | 1 | M | — |
| 7 | Netzwerk-/Proxy-/TLS-Doku im README | 1 | S | — |
| 8 | `mobile/` Expo-Grundgerüst + CI-Lane | 1 | M | 3 |
| 9 | Pairing-Screen + Secure Store + Diagnose | 1 | M | 5, 8 |
| 10 | WebView-Screen + Fehlerzustände + Deep Links | 1 | M | 9 |
| 11 | Lokale Notifications inkl. 64er-Grenze | 1 | M | 4, 6, 10 |
| 12 | `POST /api/v1/tanks/{id}/photo` + Kamera | 1 | M | 10 |
| 13 | App-Lock (Biometrie) | 1 | S | 9 |
| 14 | Store-Assets, Demo-Instanz, Einreichung | 1 | M | 11–13 |
| 15 | Domäne + i18n in Workspaces (reiner Move) | 2 | M | 14 |
| 16 | `POST /api/v1/coach` | 2 | M | — |
| 17 | Native Screens: Dashboard → Abhaken → Wasserwerte → Charts | 2 | L | 15 |

S ≈ ½–1 PT · M ≈ 2–4 PT · L ≈ 8+ PT. Solo-Owner, AI-unterstützt.

---

## 7. Risiken

| Risiko | Wahrscheinlichkeit | Gegenmittel |
|--------|-------------------|-------------|
| Apple lehnt nach 4.2 ab | mittel | Native Anteile sind Stufe-1-Pflichtinhalt, nicht optional. Notfalls TestFlight-only |
| Selbstsigniertes Zertifikat blockiert die App beim Nutzer | **hoch** | §4.4 vollständig dokumentieren, Fehlermeldung nennt die Ursache im Klartext |
| Reverse-Proxy-Login bricht die API | mittel | Bypass-Regel dokumentieren, Client erkennt HTML-Antworten |
| Zwei Terminberechnungen driften auseinander | hoch **wenn** Stufe 2 ohne §4.5 gebaut wird | §4.5 ist Voraussetzung für Stufe 2, nicht Nacharbeit |
| Play-Console-Testpflicht verzögert Monate | mittel | Vor Stufe 1 den Account-Status prüfen (Paket 3) |
| Service Worker cacht Server Actions | mittel | Nur statische Assets precachen; explizit im PWA-Test prüfen |
| App-Wartung überholt die Server-Entwicklung | steigt mit Stufe 2 | Coach/Settings/Pläne bewusst in der WebView lassen |

---

## 8. Nicht-Ziele

- **Kein** Push-Server, kein Relay, kein FCM/APNs-Konto (§4.3 löst es lokal).
- **Kein** Offline-First mit lokaler Datenbank und Konfliktauflösung.
- **Kein** Multi-User/OIDC — die App erbt das Sicherheitsmodell von v1 (ein Token,
  ein Nutzer, Reverse Proxy davor).
- **Keine** getrennten Swift-/Kotlin-Apps.
- **Keine** Änderung an Scheduler, ICS-Semantik oder Migrationen für diesen Plan.
  Fällt bei der Umsetzung auf, dass doch eine nötig ist: erst Rückfrage, siehe
  AGENTS.md „Protected areas".
