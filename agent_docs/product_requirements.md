# Product Requirements

Use this as the short build-facing version of the PRD. Do not paste the entire PRD unless the project is complex.

## Users

- Primary user: Owner — self-hosting aquarium hobbyist, 2 freshwater tanks, TrueNAS SCALE, analytical/dashboard taste, has stress phases where care slips (app must absorb that gracefully)
- Main problem: No overview of what care is due when; water values are measured but not connected to care decisions; rigid plans break during busy weeks

## Must-Have Features

- Tank management with photos & specs - Two tanks creatable in < 5 min incl. photo upload (name, volume, fresh/salt, plants, fish, CO2/heater/filter)
- Maintenance schedules with weekday selection - Plan for 2 tanks set up in < 10 min; per action: interval + preferred weekdays (e.g. weekends only)
- Flexible scheduling: snooze & auto-reschedule of overdue tasks - Snooze in < 5 s (tomorrow/weekend/+3d/custom); after 7 ignored days the plan is clean again without manual cleanup; auto-reschedule NEVER writes fake logs
- Water parameter tracking with charts - Measurement logged in < 30 s; line chart per parameter with target band; fresh/salt parameter sets; per-tank overrides
- ICS calendar feed for Google Calendar - `/api/calendar.ics?t=<token>` shows plan incl. snooze/reschedule results as all-day events; token rotatable
- AI coach & calendar auto-fill with approval gates - Contextual answers < 15 s; schedule proposals as structured JSON via tool-use, only persisted after user confirmation; friendly tone, no nagging, disclaimer on advice
- MCP server for OpenClaw/ChatGPT integration - Streamable HTTP at `/api/mcp`; OpenClaw answers "What needs to be done today?" correctly; write tools token-gated
- Docker deployment via docker compose - Stranger installs in < 10 min using README only; image on ghcr.io; `/app/data` volume
- Mobile-first dashboard with due/overdue/upcoming tasks - All core actions ≤ 2 taps on phone; bottom-nav; catch-up card when > 5 overdue

## Nice-To-Have Features

- AI interval adjustment on critical values
- Catch-up mode highlighting top priority task
- Usage statistics (feedings, water changes, AI cost)
- JSON export/import of all data

## Out Of Scope

- Sensor integration & real-time data
- Multi-user / OIDC auth
- Web push notifications
- Food/inventory management
- Breeding logbook
- Photo vision AI
- Community plan templates

## Success Signals

- Owner uses dashboard ≥ 1×/day; zero permanently missed maintenance (snooze/auto-reschedule counts as handled)
- ≥ 2–3 real AI recommendations actually implemented
- Plan stays clean without manual cleanup after a 1-week stress pause
