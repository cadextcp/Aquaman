# Product Requirements

Short build-facing version of the PRD (v1.2). Full document: `docs/PRD-Aquaman-MVP.md`.

## Users

- Primary user: Owner — self-hosting aquarium hobbyist, 2 freshwater tanks, TrueNAS SCALE, analytical/dashboard taste; has stress phases where care slips (app must absorb that gracefully without hiding the backlog)
- Main problem: No overview of what care is due when; water values measured but not connected to care decisions; rigid plans break during busy weeks

## Must-Have Features

- Tank management with photos & specs — Two tanks creatable in < 5 min incl. photo; fields incl. tankState (cycling/established)
- Maintenance schedules with weekday selection — Plan for 2 tanks in < 10 min; interval + preferred weekdays (7-bit mask); feeding is NOT a schedule (daily habit instead)
- Flexible scheduling: snooze + auto-reschedule + catch-up mode — Snooze < 5 s (tomorrow/weekend/+3d/custom); auto-reschedule is a read-projection (never writes DB/logs); originalDueAt is weekday-gridded at creation and never moves, plannedFor projects; missedSlots ≥ 3 (pure formula, not a stored counter) → gentle "interval too tight?" prompt; > 5 behind → catch-up card with top priority
- Water parameter tracking with charts — Measurement < 30 s; line chart per parameter with target band; NH3 calculated from NH4+pH+temp and THAT value is evaluated (critical ~0.02 mg/l); NO2 target 0 in established tanks (0.1–0.2 warning), tolerant during cycling; per-tank overrides
- ICS calendar feed — `/api/calendar.ics?t=<token>`; expanded VEVENTs over `occurrencesInRange()` (current occurrence projected, future ones on the fixed grid); UID `{scheduleId}-{originalDueAtISO}@aquaman` so snooze/reschedule move `DTSTART` without replacing the event; stable `DTSTAMP`; same inputs → byte-identical feed; invalid token → 404; rate-limited
- AI coach & calendar auto-fill — Contextual answers < 15 s incl. backlog & tankState; proposals as zod-validated tool-use, persisted only after user confirmation; two-tier cost ceiling (calls AND tokens) visible in Settings; friendly tone, disclaimer
- Daily habit tracking for feeding — Dashboard checkbox per tank/day, logged to maintenanceLogs, no ICS events
- Docker deployment — Stranger installs < 10 min via README; image on ghcr.io; `/app/data` volume; ports bound to 127.0.0.1 only (reverse proxy fronting)
- JSON export/import — Export all tables (sans secrets) → fresh instance → import → identical state

## Nice-To-Have Features

- AI interval adjustment on critical values
- Usage statistics (feedings, water changes, AI cost overview)
- Subtle check animations

## Out Of Scope (v1)

- MCP server + OpenClaw (→ product v1.1, fully bearer-token gated, 404 on invalid token, rate-limited)
- Sensor integration & real-time data
- Multi-user / OIDC auth
- Web push notifications
- Food/inventory management, breeding logbook, photo vision AI, community templates

## Success Signals

- Median delay originalDueAt→doneAt: < 2 days (water change), < 1 day (fertilize)
- Tasks with missedSlots ≥ 3 lead to interval adjustment
- ≥ 2–3 real AI recommendations implemented
- After 1-week stress pause: plan clean, backlog honest, catch-up card correct
