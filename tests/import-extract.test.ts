/**
 * HTML → product text (src/lib/import/extract.ts).
 *
 * The fixture below is not a random blob: it reproduces the shape of the two
 * shops this was built against — chrome, a "similar products" grid printed
 * ABOVE the description, the real content, then recommendations and reviews at
 * the bottom. That ordering is the trap. Truncating at the first noise heading
 * would throw the description away, which is why the extractor closes a noise
 * stretch on the next wanted heading instead.
 *
 * Measured against the live pages while building: 197 KB of shop HTML reduced
 * to 3 318 characters, and 85 KB of a different shop to 3 161 — both keeping
 * analysis, ingredients and feeding notes, both dropping the review block.
 */
import { describe, it, expect } from "vitest";
import {
  extractProductText,
  extractPastedText,
  pageTitle,
  MAX_EXTRACT_CHARS,
  MIN_EXTRACT_CHARS,
} from "../src/lib/import/extract";

const SHOP_PAGE = `<!doctype html>
<html><head>
  <title>Sera Flora Nature Flockenfutter f&uuml;r Pflanzenfresser</title>
  <style>.price{color:red}</style>
  <script>window.dataLayer=[{sku:"46119"}];</script>
</head>
<body>
  <header><a href="/">Startseite</a> <a href="/fischfutter">Fischfutter</a></header>
  <nav><ul><li>Aquaristik</li><li>Hund</li><li>Katze</li></ul></nav>

  <h1>Sera Flora Nature Flockenfutter f&uuml;r Pflanzenfresser</h1>
  <div class="price">7<span>&euro;</span>29</div>
  <div>250ml</div>
  <div>1L</div>

  <section>
    <h2>&Auml;hnliche Produkte wie Sera Flora Nature</h2>
    <ul>
      <li>Tetra Rubin Flakes 3&euro;79</li>
      <li>JBL Pronovo Spirulina Flakes M 12&euro;99</li>
      <li>Sera Vipan Nature Flockenfutter 3&euro;99</li>
    </ul>
  </section>

  <section>
    <h2>Beschreibung</h2>
    <p>Pflanzliches Futter ohne Farb- und Konservierungsstoffe, das aus Spirulina-Algen
       mit hohem Faser- und Carotinoidgehalt besteht. Die Flocken tr&uuml;ben das Wasser nicht.</p>
    <h2>Analytische Bestandteile</h2>
    <table>
      <tr><td>Proteine (%)</td><td>45</td></tr>
      <tr><td>Fett (%)</td><td>7.9</td></tr>
      <tr><td>Rohasche (%)</td><td>10.8</td></tr>
    </table>
    <h2>Inhaltsstoffe</h2>
    <p>Fischmehl, Weizenmehl, Bierhefe, Spirulina-Algen (7 %), Ca-Caseinat, Meeresalgen, Gammarus.</p>
    <h3>Mineralien und Vitamine</h3>
    <p>Vitamin A (UI/kg) 37000, Vitamin D3 (UI/kg) 1800, Vitamin C (mg/kg) 550.</p>
  </section>

  <section>
    <h2>Produktempfehlungen zu Sera Flora Nature</h2>
    <ul><li>IAKO Sepiaschale Natur 3&euro;58</li><li>SCALARE Kies 7&euro;29</li></ul>
  </section>

  <section>
    <h2>Kundenmeinungen</h2>
    <p>Justine: Meine Rasboras lieben es, sie schwimmen gut an der Oberfl&auml;che.</p>
    <p>Maite: Ich liebe dieses Produkt f&uuml;r meine Malawisee-Buntbarsche.</p>
  </section>

  <footer>&copy; 2026 Shop &middot; Impressum</footer>
</body></html>`;

describe("pageTitle", () => {
  it("reads and decodes the title", () => {
    expect(pageTitle(SHOP_PAGE)).toBe("Sera Flora Nature Flockenfutter für Pflanzenfresser");
  });

  it("returns null when there is none", () => {
    expect(pageTitle("<html><body>x</body></html>")).toBeNull();
  });
});

describe("extractProductText", () => {
  const { text } = extractProductText(SHOP_PAGE);

  it("keeps the parts a product entry is built from", () => {
    expect(text).toContain("Analytische Bestandteile");
    expect(text).toContain("Proteine (%)");
    expect(text).toContain("Fischmehl, Weizenmehl, Bierhefe");
    expect(text).toContain("Vitamin A (UI/kg) 37000");
    expect(text).toContain("Spirulina-Algen");
  });

  // The description sits BETWEEN two noise blocks. If this fails, the noise
  // stretch is swallowing wanted content again.
  it("keeps a description printed after a similar-products grid", () => {
    expect(text).toContain("Pflanzliches Futter ohne Farb- und Konservierungsstoffe");
  });

  it("drops reviews, recommendations and similar products", () => {
    expect(text).not.toContain("Kundenmeinungen");
    expect(text).not.toContain("Rasboras");
    expect(text).not.toContain("Malawisee");
    expect(text).not.toContain("Tetra Rubin Flakes");
    expect(text).not.toContain("Sepiaschale");
  });

  it("drops scripts, styles and chrome", () => {
    expect(text).not.toContain("dataLayer");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Impressum");
    expect(text).not.toContain("Katze");
  });

  it("decodes entities and drops price fragments", () => {
    expect(text).toContain("für Pflanzenfresser");
    expect(text).not.toMatch(/^7$/m);
    expect(text).not.toMatch(/^€$/m);
  });

  it("produces something small enough to send", () => {
    expect(text.length).toBeGreaterThan(MIN_EXTRACT_CHARS);
    expect(text.length).toBeLessThan(MAX_EXTRACT_CHARS);
  });

  it("caps oversized pages and says so", () => {
    // Distinct lines on purpose: identical ones would be collapsed by the
    // dedupe before they could ever reach the cap.
    const body = Array.from({ length: 600 }, (_, i) => `<p>Analytische Bestandteile Charge ${i}: Protein 45 Prozent.</p>`).join("");
    const huge = `<html><body>${body}</body></html>`;
    const res = extractProductText(huge);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(MAX_EXTRACT_CHARS);
  });

  it("returns almost nothing for a JS shell, so the caller can refuse", () => {
    const shell = `<html><head><title>Shop</title></head><body><div id="root"></div><script>boot()</script></body></html>`;
    expect(extractProductText(shell).text.length).toBeLessThan(MIN_EXTRACT_CHARS);
  });

  it("never throws on malformed markup", () => {
    for (const junk of ["", "<<>>", "<p>unclosed", "<script>while(1)", "&#xnothex; &bogus;"]) {
      expect(() => extractProductText(junk)).not.toThrow();
    }
  });

  it("collapses a line repeated back to back", () => {
    const doubled = `<html><body><p>Alleinfutter für Garnelen</p><p>Alleinfutter für Garnelen</p></body></html>`;
    expect(extractProductText(doubled).text).toBe("Alleinfutter für Garnelen");
  });
});

describe("extractPastedText", () => {
  it("normalises whitespace without touching the words", () => {
    const res = extractPastedText("  Rohprotein   47,0 %\n\n\n  Rohfett 10,0 %  \n");
    expect(res.text).toBe("Rohprotein 47,0 %\nRohfett 10,0 %");
    expect(res.truncated).toBe(false);
    expect(res.title).toBeNull();
  });

  it("applies the same cap as the HTML path", () => {
    const res = extractPastedText("x".repeat(MAX_EXTRACT_CHARS + 500));
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(MAX_EXTRACT_CHARS);
  });
});
