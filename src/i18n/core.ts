/**
 * Catalog-agnostic lookup — the half of i18n that works on BOTH sides.
 *
 * Every function here takes the catalog as an argument instead of importing
 * en.json/de.json, so the client provider can be handed exactly one locale's
 * catalog over the wire (see provider.tsx) while the server keeps using the
 * bundled ones (see index.ts).
 */

export type Catalog = Record<string, unknown>;
export type Vars = Record<string, string | number>;

/** Walk a dot-path ("dashboard.dueToday") through the catalog. Returns undefined when any segment misses. */
export function lookup(catalog: Catalog | undefined, key: string): unknown {
  let cur: unknown = catalog;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Replace every {name} with its value. Unknown placeholders are left alone (visible in the UI, not silently blank). */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/**
 * Resolve a key to a string. A MISSING key returns the key itself — loud
 * enough to spot in the UI and in a screenshot, and the i18n test fails on it
 * in CI before it ever ships.
 */
export function translate(catalog: Catalog | undefined, key: string, vars?: Vars): string {
  const value = lookup(catalog, key);
  return typeof value === "string" ? interpolate(value, vars) : key;
}

/**
 * Plural pick. English gets away with `n === 1 ? "" : "s"` inline; German does
 * not ("1 Tag" / "2 Tage"), so counted copy goes through here:
 *   "dashboard.tasksClosed": { "one": "{n} task closed", "other": "{n} tasks closed" }
 * `n` is injected as {n} automatically, on top of any vars passed in.
 */
export function plural(catalog: Catalog | undefined, key: string, n: number, vars?: Vars): string {
  const forms = lookup(catalog, key);
  if (!forms || typeof forms !== "object") return key;
  const bucket = n === 1 ? "one" : "other";
  const form = (forms as Record<string, unknown>)[bucket] ?? (forms as Record<string, unknown>).other;
  return typeof form === "string" ? interpolate(form, { n, ...vars }) : key;
}

/**
 * Localized name for a domain key — an action type, a water parameter, a
 * fertilizer nutrient.
 *
 * The catalog sections are keyed by the SAME strings as the domain modules
 * (action-types.ts, ranges.ts, plan-structure.ts), which stay client-safe and
 * catalog-free: the label THERE is the machine-facing one (REST API, exports,
 * logs), the one here is what a person reads. `fallback` is what to show when
 * a key predates the catalog — the domain label, or the snake_case→Titlecase
 * guess for a type nothing knows.
 */
export function domainLabelFrom(
  catalog: Catalog | undefined,
  section: "action" | "param" | "nutrient",
  key: string,
  fallback?: string,
): string {
  const v = lookup(catalog, `${section}.${key}`);
  if (typeof v === "string") return v;
  if (fallback !== undefined) return fallback;
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "water_change" → "Wasserwechsel" (see domainLabelFrom). */
export function actionLabelFrom(catalog: Catalog | undefined, actionType: string): string {
  return domainLabelFrom(catalog, "action", actionType);
}

/** A help topic: the title of an E3 sheet plus its paragraphs. */
export type HelpTopic = {
  title: string;
  body: string[];
  /** anchor on the concepts page, when the topic has a longer explanation there */
  more?: string;
};

/** Read one help topic out of an already-resolved catalog (server: index.ts, client: provider.tsx). */
export function helpTopicFrom(catalog: Catalog | undefined, id: string): HelpTopic | null {
  const v = lookup(catalog, `help.topics.${id}`);
  if (!v || typeof v !== "object") return null;
  const o = v as { title?: unknown; body?: unknown; more?: unknown };
  if (typeof o.title !== "string" || !Array.isArray(o.body)) return null;
  return {
    title: o.title,
    body: o.body.filter((x): x is string => typeof x === "string"),
    more: typeof o.more === "string" ? o.more : undefined,
  };
}

/** Read one E2 micro-copy note out of an already-resolved catalog. */
export function helpNoteFrom(catalog: Catalog | undefined, id: string): string {
  const v = lookup(catalog, `help.notes.${id}`);
  return typeof v === "string" ? v : "";
}

/** Every dot-path in a catalog that resolves to a string or a plural object — the i18n parity test walks these. */
export function catalogKeys(catalog: Catalog, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(path, ...catalogKeys(v as Catalog, path));
    } else {
      out.push(path);
    }
  }
  return out;
}
