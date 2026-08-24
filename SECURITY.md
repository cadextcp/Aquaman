# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security findings.**

Use GitHub's **private vulnerability reporting** on this repository
(Security → Report a vulnerability), or email the maintainer directly.
You will get an acknowledgement within a few days. We're a small hobby
project — please give us up to 30 days before public disclosure.

## Trust model (read this before exposing Aquaman to a network)

Aquaman v1 is **single-user without authentication by design**. Its security
model has exactly two layers — both are required:

1. **Reverse proxy with auth** (Basic Auth, Authelia, Authentik, mTLS …)
   in front of the app. The Docker setup binds the port to `127.0.0.1`
   **on purpose** so the proxy is the only way in. Do not change
   `127.0.0.1:3000:3000` to `0.0.0.0:3000:3000` on a networked host.
2. **Secret-style tokens** for the two URLs that must be reachable without a
   browser session:
   - `GET /api/calendar.ics?t=<token>` — ICS feed (Google Calendar). Invalid
     token → **404** (existence is not confirmed), 30 failed attempts/IP/h → 429.
   - `/api/coach` — AI chat endpoint, POST-only, failure-rate-limited, and
     guarded by the two-tier daily AI budget (calls AND tokens).

Everything else (tanks, water tests, schedules) assumes the reverse proxy
did its job. If the app is reachable without auth, an attacker can read and
modify all data — that is the documented trade-off of v1 (see README).

### What the app does to help itself

- AI provider keys live only in container env vars; they are never rendered,
  exported (JSON export excludes `appSettings` and all secrets by design) or
  sent to the model.
- AI output is untrusted: it renders as text and can only write through
  `applyProposal` (zod-validated, live-data-checked, explicit user approval).
- Tokens are generated with `crypto.randomBytes(24)` and compared as
  SHA-256 hashes in constant time (no length leak, no `RangeError` 500s).
- Uploads (when enabled) are path-normalized with a hard `..`-reject and a
  content-type whitelist.

## AI specifics

- Tank/measurement/log data is sent to the configured AI provider
  (`AQUAMAN_AI_BASE_URL`) as chat context. Provider data-retention applies —
  see your provider's policy. Don't enable the coach if that's unacceptable.
- The AI cost ceiling is a *budget guard*, not a security limit — it protects
  your wallet, not your data.
