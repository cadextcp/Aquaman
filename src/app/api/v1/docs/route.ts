/**
 * GET /api/v1/docs — Swagger UI for the v1 REST API, served from local
 * assets copied into public/swagger/ at build time (scripts/copy-swagger-
 * assets.mjs) so this page works fully offline on the NAS, no CDN. Ungated,
 * same trust boundary as the spec it renders (see openapi.json/route.ts).
 * The "Authorize" button takes the apiToken (More -> API) for Try it out.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>AquaMon API docs</title>
<link rel="stylesheet" href="/swagger/swagger-ui.css">
<link rel="icon" href="/swagger/favicon-32x32.png" sizes="32x32">
<link rel="icon" href="/swagger/favicon-16x16.png" sizes="16x16">
<style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/swagger/swagger-ui-bundle.js"></script>
<script src="/swagger/swagger-ui-standalone-preset.js"></script>
<script>
  window.onload = () => {
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
    });
  };
</script>
</body>
</html>`;

export async function GET() {
  return new NextResponse(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
}
