/**
 * i18n guardrails — the tests that keep localisation honest as the app grows.
 *
 * The failure mode this prevents is specific and silent: someone adds a key to
 * en.json, ships it, and the German UI shows a raw dot-key ("dashboard.dueToday")
 * to the one user who actually runs the app in German. CI catches it here instead.
 *
 * Three levels of guard:
 *  1. STRUCTURE  — both catalogs carry exactly the same key set
 *  2. CONTENT    — no locale is left with the other's copy (a forgotten translation)
 *  3. USAGE      — every key the SOURCE actually asks for resolves in every locale
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import en from "../src/i18n/en.json";
import de from "../src/i18n/de.json";
import { catalogKeys, translate, plural, actionLabelFrom, type Catalog } from "../src/i18n/core";
import { ACTION_TYPE_KEYS, actionLabel } from "../src/lib/domain/action-types";
import { FRESHWATER_RANGES, SALTWATER_RANGES } from "../src/lib/domain/ranges";
import { NUTRIENTS } from "../src/lib/domain/plan-structure";
import { LOCALES, LOCALE_TAG, isLocale, DEFAULT_LOCALE } from "../src/i18n/locales";
import { formatDateLong, formatDateShort, formatMonth, formatNumber, weekdayLabels } from "../src/i18n/format";

const catalogs: Record<string, Catalog> = { en: en as Catalog, de: de as Catalog };

/** Every .ts/.tsx file under src/ — the usage scan reads these. */
function sourceFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("catalog structure", () => {
  it("en and de carry exactly the same keys", () => {
    const a = new Set(catalogKeys(en as Catalog));
    const b = new Set(catalogKeys(de as Catalog));
    expect([...a].filter((k) => !b.has(k)).sort(), "keys missing from de.json").toEqual([]);
    expect([...b].filter((k) => !a.has(k)).sort(), "keys missing from en.json").toEqual([]);
  });

  it("has no empty strings in either locale", () => {
    for (const [loc, cat] of Object.entries(catalogs)) {
      for (const key of catalogKeys(cat)) {
        const value = key.split(".").reduce<unknown>((cur, p) => (cur as Catalog)?.[p], cat);
        if (typeof value === "string") {
          expect(value.trim().length, `${loc}: ${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps {placeholders} identical across locales — a dropped one renders a blank", () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(",");
    for (const key of catalogKeys(en as Catalog)) {
      const enVal = key.split(".").reduce<unknown>((cur, p) => (cur as Catalog)?.[p], en as Catalog);
      const deVal = key.split(".").reduce<unknown>((cur, p) => (cur as Catalog)?.[p], de as Catalog);
      if (typeof enVal === "string" && typeof deVal === "string") {
        expect(placeholders(deVal), `${key}: placeholders differ between en and de`).toBe(placeholders(enVal));
      }
    }
  });
});

describe("catalog usage (every key the code asks for exists)", () => {
  // t("a.b") / plural("a.b", n) / helpNote("x") style calls in the source
  const files = sourceFiles();
  const used = new Set<string>();
  for (const f of files) {
    if (f.startsWith("src/i18n/")) continue; // the module's own docs/examples
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z][\w.]*)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/\bplural\(\s*"([a-zA-Z][\w.]*)"/g)) used.add(m[1]);
  }

  it("finds the keys the UI uses (guards against a broken scan)", () => {
    expect(used.size).toBeGreaterThan(0);
  });

  it("resolves every used key in EVERY locale", () => {
    const missing: string[] = [];
    for (const key of used) {
      for (const loc of LOCALES) {
        const direct = translate(catalogs[loc], key);
        const asPlural = plural(catalogs[loc], key, 2);
        // translate() returns the key itself when missing; plural() likewise
        if (direct === key && asPlural === key) missing.push(`${loc}: ${key}`);
      }
    }
    expect(missing.sort(), "keys used in src/ but missing from a catalog").toEqual([]);
  });
});

describe("locales", () => {
  it("isLocale accepts the shipped locales and rejects anything else", () => {
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("every locale has a BCP-47 tag for Intl", () => {
    for (const l of LOCALES) expect(LOCALE_TAG[l]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
  });
});

describe("core lookup", () => {
  it("interpolates placeholders", () => {
    const cat: Catalog = { a: { b: "Hello {name}, {n} tanks" } };
    expect(translate(cat, "a.b", { name: "Ada", n: 2 })).toBe("Hello Ada, 2 tanks");
  });

  it("returns the key itself when missing — loud, not silently blank", () => {
    expect(translate({}, "nope.missing")).toBe("nope.missing");
    expect(translate(undefined, "nope.missing")).toBe("nope.missing");
  });

  it("picks singular vs plural and injects {n} automatically", () => {
    const cat: Catalog = { x: { one: "{n} task closed", other: "{n} tasks closed" } };
    expect(plural(cat, "x", 1)).toBe("1 task closed");
    expect(plural(cat, "x", 5)).toBe("5 tasks closed");
    expect(plural(cat, "x", 0)).toBe("0 tasks closed");
  });
});

describe("locale-aware formatting", () => {
  it("formats the same date differently per locale", () => {
    expect(formatDateLong("2026-08-24", "en")).toBe("Monday, August 24");
    expect(formatDateLong("2026-08-24", "de")).toBe("Montag, 24. August");
  });

  it("never shifts the day (date-only strings are read in UTC)", () => {
    // the bug this pins: reading "2026-08-24" in a negative-offset zone would
    // render the 23rd for the whole evening
    for (const loc of LOCALES) {
      expect(formatDateShort("2026-08-24", loc)).toContain("24");
      expect(formatDateLong("2026-08-24", loc)).toContain("24");
    }
  });

  it("formats months and numbers per locale", () => {
    expect(formatMonth("2026-09", "en")).toBe("September 2026");
    expect(formatMonth("2026-09", "de")).toBe("September 2026");
    expect(formatNumber(200000, "en")).toBe("200,000");
    expect(formatNumber(200000, "de")).toBe("200.000");
  });

  it("returns Monday-first weekday labels (bit 0 = Mon, like the schedule mask)", () => {
    const en7 = weekdayLabels("en");
    const de7 = weekdayLabels("de");
    expect(en7).toHaveLength(7);
    expect(en7[0]).toBe("Mon");
    expect(en7[6]).toBe("Sun");
    expect(de7[0]).toMatch(/^Mo/);
    expect(de7[6]).toMatch(/^So/);
  });
});

describe("language setting", () => {
  it("defaults to the documented default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });
});

describe("action-type labels", () => {
  it("every standard action type has a label in every locale", () => {
    for (const loc of LOCALES) {
      for (const key of ACTION_TYPE_KEYS) {
        const label = translate(catalogs[loc], `action.${key}`);
        expect(label, `action.${key} missing in ${loc}`).not.toBe(`action.${key}`);
        expect(label.trim()).not.toBe("");
      }
    }
  });

  it("carries no label for a type the catalog does not know (no stale entries)", () => {
    for (const loc of LOCALES) {
      const inCatalog = Object.keys((catalogs[loc] as { action: Record<string, string> }).action);
      expect(inCatalog.sort()).toEqual([...ACTION_TYPE_KEYS].sort());
    }
  });

  it("falls back to the snake_case→Titlecase guess for an unknown type", () => {
    expect(actionLabelFrom(catalogs.en, "some_custom_thing")).toBe("Some custom thing");
  });

  it("English labels match the machine-facing catalog (ICS output stays stable)", () => {
    for (const key of ACTION_TYPE_KEYS) {
      expect(actionLabelFrom(catalogs.en, key)).toBe(actionLabel(key));
    }
  });
});

describe("domain vocabulary", () => {
  const paramKeys = [...new Set([...FRESHWATER_RANGES, ...SALTWATER_RANGES].map((r) => r.key))];

  it("every water parameter has a label in every locale", () => {
    for (const loc of LOCALES) {
      for (const key of paramKeys) {
        const label = translate(catalogs[loc], `param.${key}`);
        expect(label, `param.${key} missing in ${loc}`).not.toBe(`param.${key}`);
      }
    }
  });

  it("every fertilizer nutrient has a label in every locale", () => {
    for (const loc of LOCALES) {
      for (const n of NUTRIENTS) {
        const label = translate(catalogs[loc], `nutrient.${n.key}`);
        expect(label, `nutrient.${n.key} missing in ${loc}`).not.toBe(`nutrient.${n.key}`);
      }
    }
  });

  it("carries no label for a key the domain does not know (no stale entries)", () => {
    for (const loc of LOCALES) {
      const c = catalogs[loc] as { param: Record<string, string>; nutrient: Record<string, string> };
      expect(Object.keys(c.param).sort()).toEqual([...paramKeys].sort());
      expect(Object.keys(c.nutrient).sort()).toEqual(NUTRIENTS.map((n) => n.key).sort());
    }
  });

  it("the English catalog matches the machine-facing domain labels", () => {
    // the REST API and exports serve the domain label; English UI and API must
    // not drift into two different names for the same thing
    for (const r of [...FRESHWATER_RANGES, ...SALTWATER_RANGES]) {
      expect(translate(catalogs.en, `param.${r.key}`)).toBe(r.label);
    }
    for (const n of NUTRIENTS) {
      expect(translate(catalogs.en, `nutrient.${n.key}`)).toBe(n.label);
    }
    for (const key of ACTION_TYPE_KEYS) {
      expect(translate(catalogs.en, `action.${key}`)).toBe(actionLabel(key));
    }
  });
});
