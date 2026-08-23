# Project Brief

## Product

- One-line vision: Self-hosted aquarium care & water tracking app with AI coach, flexible scheduling, ICS calendar feed and MCP server
- Target users: Self-hosting aquarium hobbyists (analytical, dashboard-loving) — primary: owner with 2 freshwater tanks on TrueNAS SCALE
- Primary user outcome: Know at a glance what aquarium care is due today, catch up stress-free after skipping days, and get AI-backed advice on water values

## Scope

- Must ship:
  - Tank management with photos & specs
  - Maintenance schedules with weekday selection
  - Flexible scheduling: snooze & auto-reschedule of overdue tasks
  - Water parameter tracking with charts
  - ICS calendar feed for Google Calendar
  - AI coach & calendar auto-fill with approval gates
  - MCP server for OpenClaw/ChatGPT integration
  - Docker deployment via docker compose
  - Mobile-first dashboard with due/overdue/upcoming tasks
- Not in v1:
  - Sensor integration & real-time data
  - Multi-user / OIDC auth
  - Web push notifications
  - Food/inventory management
  - Breeding logbook
  - Photo vision AI
  - Community plan templates

## Principles

- Solve the user story before adding polish.
- Prefer boring, maintainable choices.
- Keep generated docs short and current.
- Verify user-visible work in the real product surface.

## AI Position

Fill this in only if AI is part of the product.

- AI is used for: coach chat with tank context; proposing maintenance schedules and interval adjustments (structured output via tool-use); answering `ask_coach` over MCP
- AI is not used for: writing anything directly to the DB; medication/medical dosing advice; anything without a human approval gate
- Human approval required for: every schedule/calendar write proposed by AI; MCP write tools additionally require the bearer token
