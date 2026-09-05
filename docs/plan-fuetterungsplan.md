# Plan — Fütterungsplan als Freitext (pro Aquarium)

> **Status: gebaut** (Migration `0009_tank_feeding_plan`). Erstellt: 2026-09-05 ·
> Basis: `main` @ `a27b53a` · App-Version 1.0.0.

**Das Problem in einem Satz:** Füttern ist im Care-Stack bewusst ein
Tages-Zähler (`feed_logs`, 0–5 pro Tag), aber *was* an welchem Tag gefüttert
werden soll — Flocken montags, Frostfutter freitags, Fastentag samstag —
hatte keinen Ort: weder ein Zeitplan (siehe unten) noch ein Feld.

**Die Kernentscheidung: Prosa, kein Zeitplan.** Ein Fütterungs-„Plan" als
`schedules`-Zeile ist seit Migration `0006` strukturell unmöglich (ein
solcher Plan kann nie abgehakt werden — `markScheduleDoneCore` schreibt
`lastDoneAt`, der Zähler aber lebt in `feed_logs`). Der Fütterungsplan hier
ist deshalb **reines Markdown** auf `tanks.feeding_plan` (nullable, max
4000 Zeichen): Kontext für Menschen und den Coach, keine abhakbare
Verpflichtung, kein ICS, keine `missedSlots`. Die Domain-Invariante
„Füttern ist kein Plan" bleibt unangetastet — `tests/feeding-not-a-plan.test.ts`
läuft weiter unverändert grün.

## Umsetzung

| Baustein | Ort | Form |
|---|---|---|
| Spalte | `tanks.feeding_plan` (Migration `0009`) | `text`, nullable |
| Einziger Schreibpfad | `setTankFeedingPlanCore` (`repo.ts`) + Action `setTankFeedingPlan` | zod: `string ≤ 4000` oder `null`; Leerstring = leeren. **Nicht** Teil von `tankInputSchema` — `updateTankCore` ist Full-Replace und dürfte ein Feld, das das Profilformular nie zeigt, sonst aus versehen löschen |
| UI | Tank-Detailseite, Sektion „Fütterungsplan" (`feeding-plan-card.tsx`) | View: `react-markdown` (erstmalig im Projekt; rendert ohne `rehype-raw`, HTML bleibt escaped — auch bei AI-Vorschlägen). Edit: Textarea, Zeichenzähler, Ctrl/⌘+Enter speichert |
| Coach-Kontext | `context.ts`, pro Tank nach `plants:` | Block „feeding plan (the owner's own notes, markdown)", auf 2400 Zeichen gekappt („…(trimmed)"), folgt dem Tank-Scoping |
| Coach-Vorschlag | dritter Proposal-Typ `kind: "set_feeding_plan"` | `{tankId, feedingPlan}` — ersetzt den **kompletten** Plan, nie ein Fragment. Läuft durch den normalen Approval-Gate (`applyProposal`): zod erneut, Tank-Live-Check, editierbare Karte im Coach-Chat vor dem Bestätigen |
| Tool-Schema | `PROPOSAL_TOOL_INPUT_SCHEMA` | `intervalDays` musste aus dem Basis-`required` in die create/adjust-Zweige wandern — ein Basis-Feld hätte jede Fütterungsplan-Änderung abgelehnt, weil sie kein Intervall haben kann. `tests/proposal-schema.test.ts` pinnt beide Seiten |
| Export/Import | `tankRowSchema.feedingPlan` (optional → alte Exporte bleiben importierbar) | Roundtrip-Test erweitert |

## Grenzen (bewusst)

- **Kein „Ergänzen"**: ein Vorschlag ersetzt den ganzen Text. Die Karte ist
  vor dem Bestätigen editierbar — wer mergen will, kopiert von Hand. Gleiches
  Muster wie die Nur-Anlegen-Regel beim Produkt-Import: keine Tür, durch die
  ein Modellaufruf Getipptes teilweise überschreiben könnte, ohne dass es auf
  dem Bildschirm stand.
- **Kein Parser**: aus dem Markdown wird nichts abgeleitet — keine
  Benachrichtigung „heute Fastentag", keine Automatik. Stufe 2, falls je
  gebraucht, wäre ein Mini-Editor mit Wochentagsfeldern.
- **MCP**: `ask_coach` sieht den Plan (über den geteilten Kontext), kann aber
  wie bisher keine Proposals ausliefern — die Bestätigung bleibt in der App.
