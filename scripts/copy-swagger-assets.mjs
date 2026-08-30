/**
 * Copies the Swagger UI static assets from node_modules into public/swagger/
 * at build/dev time, so GET /api/v1/docs works fully offline on the NAS
 * (no CDN dependency for the container's docs page). Run before `next build`
 * / `next dev` — see package.json.
 */
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "node_modules", "swagger-ui-dist");
const dest = join(root, "public", "swagger");

const FILES = ["swagger-ui-bundle.js", "swagger-ui-standalone-preset.js", "swagger-ui.css", "favicon-32x32.png", "favicon-16x16.png"];

mkdirSync(dest, { recursive: true });
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[copy-swagger-assets] missing ${f} in swagger-ui-dist — package layout may have changed`);
    process.exit(1);
  }
  cpSync(from, join(dest, f));
}
console.log(`[copy-swagger-assets] copied ${FILES.length} files to public/swagger/`);
