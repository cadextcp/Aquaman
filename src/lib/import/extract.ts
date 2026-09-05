/**
 * HTML → the few thousand characters that actually describe a product
 * (docs/plan-produkt-import-url.md §5).
 *
 * Why this exists at all: on a real shop page roughly 85 % of the text is
 * navigation, "similar products", reviews and blog teasers. Sending that to
 * the model would cost four times the tokens AND bury the analytical
 * constituents under twenty other products' prices — the review block on one
 * of the pages this was built against discusses a different manufacturer
 * entirely. Cutting here is both cheaper and more accurate.
 *
 * Deliberately dependency-free and regex-based. A real parser would be more
 * correct, but this runs on text we then hand to a model that tolerates a
 * stray bracket; a new dependency in the image would not pay for itself.
 *
 * Pure: no network, no DB. The tests pin it against saved fixtures.
 */

/** Hard cap handed to the model (~3–4 k tokens). */
export const MAX_EXTRACT_CHARS = 12_000;

/** Below this, the page is a JS shell or a redirect notice — not a product. */
export const MIN_EXTRACT_CHARS = 400;

/** Elements whose content is never product text. */
const DROP_ELEMENTS = /<(script|style|noscript|svg|template|iframe|nav|header|footer|aside|form|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Tags that end a line of text rather than joining it. */
const BLOCK_TAGS = /<\/?(p|div|br|li|tr|h[1-6]|section|article|table|thead|tbody|dt|dd|ul|ol|option)\b[^>]*>/gi;

/**
 * A heading that starts a stretch of page we do not want. Matching is
 * line-anchored and case-insensitive; the wording covers the German and
 * English shop vocabulary these pages use.
 */
const NOISE_HEADING =
  /^(ähnliche produkte|similar products|related products|produktempfehlungen|recommend|kunden ?(meinungen|bewertungen)|bewertungen|customer reviews|reviews|zeugnisse|testimonials|fragen und antworten|questions and answers|newsletter|folgen sie uns|follow us|zahlungsarten|payment methods|versand|shipping|der .{0,20}blog|blog\b|diese seiten|weitere informationen|lose & werbeangebote|mengenrabatt)/i;

/**
 * A heading that starts a stretch we DO want — it also ends a noise stretch.
 * Without this, one "similar products" block early in the document would
 * swallow the description: on one of the reference pages the recommendations
 * are printed ABOVE the description, not below it.
 */
const WANTED_HEADING =
  /^(beschreibung|description|merkmale|eigenschaften|features|anwendung|application|fütterung|feeding|dosierung|dosage|zusammensetzung|composition|inhalt|inhaltsstoffe|ingredients|analytische bestandteile|analytical constituents|zusatzstoffe|additives|mineralien|vitamine|vitamins|hauptbestandteile|nebenbestandteile|ausgangsstoffe|aufbereitungsmittel|lagerung|storage|hersteller|manufacturer|wichtige|important|technische daten|allgemeines)/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  deg: "°",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  times: "×",
  sup2: "²",
  sup3: "³",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** The `<title>`, which is often the cleanest product name on the page. */
export function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = decodeEntities(match[1].replace(/\s+/g, " ")).trim();
  return title === "" ? null : title;
}

/** Strip tags and entities, one text line per block element. */
function toLines(html: string): string[] {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(DROP_ELEMENTS, " ")
      .replace(BLOCK_TAGS, "\n")
      .replace(/<[^>]*>/g, " "),
  );
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * Drop the noise stretches. A noise heading opens a stretch; the next wanted
 * heading closes it. Unclosed noise runs to the end of the document, which is
 * the common shape — reviews and blog teasers sit at the bottom.
 */
function dropNoise(lines: string[]): string[] {
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (WANTED_HEADING.test(line)) skipping = false;
      else continue;
    } else if (NOISE_HEADING.test(line)) {
      skipping = true;
      continue;
    }
    kept.push(line);
  }
  return kept;
}

/**
 * Collapse the run of one- and two-character lines that price tables and star
 * ratings leave behind ("5", "€", "49", "4.9/5"). They carry no product
 * information and, unfiltered, make up a surprising share of the budget.
 */
function dropFragments(lines: string[]): string[] {
  return lines.filter((line) => line.length > 2 && !/^[\d.,\s€$%/-]+$/.test(line));
}

export type Extraction = { text: string; title: string | null; truncated: boolean };

/**
 * HTML in, compact text out. Never throws — a page we cannot make sense of
 * comes back short, and the caller turns that into "no product text found"
 * rather than a crash.
 */
export function extractProductText(html: string): Extraction {
  const title = pageTitle(html);
  const lines = dropFragments(dropNoise(toLines(html)));

  // Same line twice in a row is a shop rendering the summary above the fold
  // and again below it; keep the first.
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }

  const joined = deduped.join("\n");
  const truncated = joined.length > MAX_EXTRACT_CHARS;
  return { text: truncated ? joined.slice(0, MAX_EXTRACT_CHARS) : joined, title, truncated };
}

/** Free text a person pasted — same cap, no HTML handling. */
export function extractPastedText(raw: string): Extraction {
  const cleaned = raw
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
  const truncated = cleaned.length > MAX_EXTRACT_CHARS;
  return { text: truncated ? cleaned.slice(0, MAX_EXTRACT_CHARS) : cleaned, title: null, truncated };
}
