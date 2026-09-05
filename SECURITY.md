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

## Outbound requests (product import)

`POST /api/inventory/import` is the **only** place this app fetches a URL a
person typed, and the only outbound HTTP it makes besides the AI provider.
That matters more than it sounds: a self-hosted box usually sits on a LAN with
a NAS API, a Grafana, a broker — so an unguarded "fetch this URL" endpoint is a
port scanner with a nice form around it.

What `src/lib/import/url-guard.ts` refuses, before any request goes out:

- Anything but `http:`/`https:`, and any URL carrying credentials
  (`https://user:pass@host`).
- `localhost` and the `.local` / `.internal` / `.home` / `.lan` / `.intranet`
  suffixes.
- Every private, loopback, link-local, CGNAT and reserved range — in IPv4,
  IPv6 and IPv4-mapped-IPv6 spellings, with lenient forms (`0177.0.0.1`)
  treated as unclassifiable and therefore blocked.
- A **hostname that resolves** into any of those. All DNS answers are checked,
  not just the first.
- Redirects: `fetch-page.ts` follows them manually (max 3) and re-runs the
  guard on every hop, because a shop's 302 to `http://192.168.178.3` would
  otherwise walk straight past the check on the typed URL.

Plus the boring limits that stop the endpoint being a resource sink: 8 s
timeout, 2 MB response cap (streamed, not buffered), `text/html` only, and
10 imports per IP per hour.

**Known residual risk — DNS rebinding.** The guard resolves the name, checks
the answers, and then lets `fetch` connect, which resolves again. A resolver
that returns a public address on the first query and a private one on the
second would slip through that gap. Closing it properly means connecting to
the validated IP and passing the hostname as a `Host` header. For a
single-user app on a home LAN this was judged an acceptable trade against the
complexity; it is written down here rather than left as folklore, and it is
the first thing to fix if this endpoint ever becomes reachable by more than
the owner.

**Fetched pages are untrusted input**, like AI output. The page text is handed
to the model as data inside explicit delimiters, the model has exactly one
tool (`draft_product`) and no way to fetch or write, its answer is validated
by the same zod schema the form uses, and the result only ever lands in form
fields a person then saves. The approval gate is the boundary — there is no
path from a web page to the database that does not pass through a human.

## AI specifics

- Tank/measurement/log data is sent to the configured AI provider
  (`AQUAMAN_AI_BASE_URL`) as chat context. Provider data-retention applies —
  see your provider's policy. Don't enable the coach if that's unacceptable.
- The AI cost ceiling is a *budget guard*, not a security limit — it protects
  your wallet, not your data.
