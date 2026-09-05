/**
 * prepareLabelImage — the server-side half of the label-photo import
 * (docs/plan-produkt-import-url.md §10, stage 3).
 *
 * The numbers under test are the ones the plan measured live: 1200px longest
 * edge reads a label completely at a fifth of the token cost of the phone
 * original; nothing beyond that may reach the provider, and anything that
 * sharp cannot decode is refused BEFORE a single token is spent.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { prepareLabelImage, LabelImageError } from "../src/lib/import/prepare-image";

async function pngBase64(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 210, g: 205, b: 190 } } }).png().toBuffer();
  return buf.toString("base64");
}

describe("prepareLabelImage", () => {
  it("downscales a phone-sized photo to a 1200px jpeg", async () => {
    const out = await prepareLabelImage(await pngBase64(3024, 2083));
    const meta = await sharp(Buffer.from(out.base64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1200);
  });

  it("never enlarges a small photo and keeps its aspect ratio", async () => {
    const out = await prepareLabelImage(await pngBase64(900, 620));
    const meta = await sharp(Buffer.from(out.base64, "base64")).metadata();
    expect(meta.width!).toBe(900);
    expect(meta.width! / meta.height!).toBeCloseTo(900 / 620, 1);
  });

  it("refuses bytes that are no image at all", async () => {
    const garbage = Buffer.from("definitely not a photo").toString("base64");
    const err = await prepareLabelImage(garbage).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LabelImageError);
    expect((err as LabelImageError).code).toBe("productImport.unsupportedImage");
  });

  it("refuses a decoded photo over the 5 MB input cap", async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 7).toString("base64");
    const err = await prepareLabelImage(tooBig).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LabelImageError);
    expect((err as LabelImageError).code).toBe("productImport.imageTooLarge");
  });
});
