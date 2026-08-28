import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { helpTopic, helpNote, concepts, LOCALES } from "../src/i18n";
import en from "../src/i18n/en.json";
import de from "../src/i18n/de.json";

/** Every `id` string handed to HelpDot / HelpNote anywhere under src/. */
function usedIds(): { topics: Set<string>; notes: Set<string> } {
  const topics = new Set<string>();
  const notes = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) {
        const src = readFileSync(p, "utf-8");
        for (const m of src.matchAll(/<HelpDot\s+id="([^"]+)"/g)) topics.add(m[1]);
        for (const m of src.matchAll(/<HelpNote\s+id="([^"]+)"/g)) notes.add(m[1]);
        // the coach page picks its note id at runtime
        for (const m of src.matchAll(/<HelpNote\s+id=\{[^}]*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
          notes.add(m[1]);
          notes.add(m[2]);
        }
      }
    }
  };
  walk("src");
  return { topics, notes };
}

/** Flatten a catalog to the set of its key paths, with list lengths. */
function shape(o: unknown, path = ""): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(o)) out.add(`${path}[${o.length}]`);
  else if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) for (const s of shape(v, `${path}.${k}`)) out.add(s);
  else out.add(path);
  return out;
}

describe("help content", () => {
  const used = usedIds();

  it("wires at least the topics and notes the plan calls for", () => {
    expect(used.topics.size).toBeGreaterThanOrEqual(10);
    expect(used.notes.size).toBeGreaterThanOrEqual(10);
  });

  // the real bug this guards: a typo'd id renders nothing at all, silently
  it("resolves every HelpDot id used in the UI", () => {
    for (const id of used.topics) {
      const t = helpTopic(id);
      expect(t, `help.topics.${id} is missing`).not.toBeNull();
      expect(t!.title.length, `help.topics.${id}.title is empty`).toBeGreaterThan(0);
      expect(t!.body.length, `help.topics.${id}.body is empty`).toBeGreaterThan(0);
    }
  });

  it("resolves every HelpNote id used in the UI", () => {
    for (const id of used.notes) {
      expect(helpNote(id), `help.notes.${id} is missing`).not.toBe("");
    }
  });

  it("keeps every 'more' anchor pointing at a real concepts section", () => {
    const ids = new Set(concepts().sections.map((s) => s.id));
    for (const id of used.topics) {
      const more = helpTopic(id)?.more;
      if (more) expect(ids, `help.topics.${id}.more → #${more} has no section`).toContain(more);
    }
  });

  // AGENTS.md: a string that exists in one catalog only breaks that locale silently
  it("keeps en and de structurally identical", () => {
    const a = shape(en);
    const b = shape(de);
    expect([...a].filter((k) => !b.has(k)), "keys missing from de.json").toEqual([]);
    expect([...b].filter((k) => !a.has(k)), "keys missing from en.json").toEqual([]);
  });

  it("has translated help copy in every locale, not just the default", () => {
    for (const loc of LOCALES) {
      for (const id of used.topics) {
        const t = helpTopic(id, loc);
        expect(t, `help.topics.${id} missing in ${loc}`).not.toBeNull();
        expect(t!.body.every((p) => p.trim().length > 0), `empty paragraph in ${loc}/${id}`).toBe(true);
      }
      expect(concepts(loc).sections.length, `concepts missing in ${loc}`).toBeGreaterThan(0);
    }
  });

  it("does not leave the two locales with identical copy (a forgotten translation)", () => {
    const enT = helpTopic("nh3", "en")!;
    const deT = helpTopic("nh3", "de")!;
    expect(deT.body[0]).not.toBe(enT.body[0]);
  });
});
