/**
 * Server-side preparation of a label photo for the import
 * (docs/plan-produkt-import-url.md §10, stage 3).
 *
 * The photo never touches the disk: decode, downscale, JPEG, hand to the
 * caller, discard. The downscale is mandatory, not an optimisation — measured
 * live in the plan §10, the 3024px phone original cost ~5x the tokens of the
 * 1200px version AND came back with a worse draft (analysis scattered into
 * notes). sharp is also the only decoder in this stack that reads iPhone HEIC.
 *
 * Security posture for the first file input this app has: the type is judged
 * by content (sharp decodes it or the photo is refused — never by file name or
 * declared Content-Type), pixel-count caps blunt decompression bombs, and both
 * size caps run before anything expensive happens.
 */

import sharp from "sharp";

export type LabelImageCode = "productImport.imageTooLarge" | "productImport.unsupportedImage";

export class LabelImageError extends Error {
  constructor(readonly code: LabelImageCode) {
    super(code === "productImport.imageTooLarge" ? "photo exceeds the size limit" : "photo is not a readable image");
  }
}

/** Decoded input cap — a bigger "photo" is an attack or a mistake, not a label. */
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

/**
 * Decompression-bomb guard: a few MB of JPEG may legally expand to enormous
 * pixel dimensions. 120 MP covers every current phone camera (48–108 MP) with
 * room; libvips refuses anything beyond before it is fully rasterised.
 */
const MAX_INPUT_PIXELS = 120_000_000;

/**
 * Longest edge sent to the provider — plan §10: 1200px read every label
 * completely, at a fifth of the token cost of the phone original.
 */
const MAX_EDGE = 1200;

const JPEG_QUALITY = 82;

export async function prepareLabelImage(base64: string): Promise<{ base64: string; bytes: number }> {
  const input = Buffer.from(base64, "base64");
  if (input.byteLength > MAX_INPUT_BYTES) throw new LabelImageError("productImport.imageTooLarge");

  try {
    const output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // honour EXIF orientation before the edges are measured
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { base64: output.toString("base64"), bytes: output.byteLength };
  } catch (err) {
    // sharp refuses non-images and undecodable ones alike — whatever the exact
    // libvips reason, the caller's answer is the same: not a readable photo.
    if (err instanceof LabelImageError) throw err;
    throw new LabelImageError("productImport.unsupportedImage");
  }
}
