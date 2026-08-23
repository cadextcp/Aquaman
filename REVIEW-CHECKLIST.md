# Review Checklist

Do not mark work complete until the relevant checks pass.

## Basic Checks

- [ ] Diff is focused on the requested task.
- [ ] No unrelated files were rewritten.
- [ ] No secrets, tokens, private logs, or production exports were exposed.
- [ ] Protected areas were not changed without approval.
- [ ] Tests/typecheck/build passed or failures are explained.
- [ ] UI changes were checked in a browser/device when applicable.

## Security

- [ ] Dependencies audited (`npm audit` or equivalent) — no unaddressed high-severity findings.
- [ ] All user input is validated and sanitized at the boundary (forms, API payloads, URL params).
- [ ] Token-protected endpoints (`/api/calendar.ics`, later `/api/mcp`) tested with missing/wrong/valid token → 404/404/200 (no auth exists in v1; reverse proxy fronts the app).
- [ ] Rate limiting (or equivalent abuse protection) verified for public token endpoints.
- [ ] Upload route rejects path traversal (`..`) and enforces content-type whitelist.
- [ ] Docker port binding stays local-only (127.0.0.1 or shared Docker network).

## AI Checks

Use only if AI, MCP, tool calls, RAG, local models, or builders are involved.

- [ ] Model-visible data is documented.
- [ ] Retrieved docs/web/issues/uploads/tool output are treated as untrusted data.
- [ ] Risky actions require approval.
- [ ] Direct, bad/indirect, auth-required, failure, and tool/action checks passed.
- [ ] Logs/traces do not expose secrets or customer data.
- [ ] Provider retention/training settings were checked before launch.
- [ ] Builder output passed export, local build, secrets, auth/RLS, and rollback review.

## Final Evidence

The final response should include:

- Files changed
- Commands run
- Test/build/browser results
- AI/tool eval results, if applicable
- Remaining risks
