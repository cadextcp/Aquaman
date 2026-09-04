/**
 * The OpenAPI document itself (no DB needed — buildOpenApiDocument is pure)
 * and the two route handlers that serve it.
 */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { buildOpenApiDocument } from "../src/lib/api/openapi";

const ROUTES = [
  { method: "GET", path: "/tanks" },
  { method: "POST", path: "/tanks" },
  { method: "GET", path: "/tanks/{id}" },
  { method: "PATCH", path: "/tanks/{id}" },
  { method: "DELETE", path: "/tanks/{id}" },
  { method: "GET", path: "/tanks/{id}/status" },
  { method: "GET", path: "/tanks/{id}/actions" },
  { method: "POST", path: "/actions" },
  { method: "GET", path: "/tanks/{id}/feedings" },
  { method: "POST", path: "/tanks/{id}/feedings" },
  { method: "GET", path: "/tanks/{id}/water-tests" },
  { method: "POST", path: "/water-tests" },
  { method: "PATCH", path: "/water-tests/{id}" },
  { method: "DELETE", path: "/water-tests/{id}" },
  { method: "GET", path: "/products" },
  { method: "POST", path: "/products" },
  { method: "GET", path: "/products/{id}" },
  { method: "PATCH", path: "/products/{id}" },
  { method: "DELETE", path: "/products/{id}" },
  { method: "GET", path: "/water-parameters" },
  { method: "GET", path: "/schedules" },
  { method: "POST", path: "/schedules" },
  { method: "GET", path: "/schedules/{id}" },
  { method: "PATCH", path: "/schedules/{id}" },
  { method: "DELETE", path: "/schedules/{id}" },
  { method: "POST", path: "/schedules/{id}/done" },
  { method: "POST", path: "/schedules/{id}/snooze" },
  { method: "POST", path: "/schedules/{id}/undo" },
  { method: "GET", path: "/tasks" },
];

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument("http://localhost:3000/api/v1") as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
  };

  it("is valid, serializable JSON with no circular references", () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it("declares OpenAPI 3.1 and a bearer security scheme", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("every registered v1 route appears in the spec under the right method", () => {
    for (const { method, path } of ROUTES) {
      expect(doc.paths, `missing path ${path}`).toHaveProperty(path);
      const item = doc.paths[path];
      expect(item, `missing ${method} ${path}`).toHaveProperty(method.toLowerCase());
    }
  });

  it("does not mark defaulted fields as required — a client need not send plants or hasCo2", () => {
    const tankInput = doc.components.schemas.TankInput as { required?: string[] };
    expect(tankInput.required ?? []).not.toContain("plants");
    expect(tankInput.required ?? []).not.toContain("hasCo2");
    expect(tankInput.required ?? []).toContain("name");
  });

  it("request-body schemas are the SAME zod schemas the routes validate with, not hand copies", async () => {
    const { tankInputSchema } = await import("../src/lib/schemas");
    const { z } = await import("zod");
    const fromDoc = doc.components.schemas.TankInput as { properties: Record<string, unknown> };
    // io: "input" — a request body describes what a client SENDS, which is
    // also the only side representable once a schema transforms (ProductInput).
    const fromSchema = z.toJSONSchema(tankInputSchema, { io: "input" }) as { properties: Record<string, unknown> };
    expect(Object.keys(fromDoc.properties).sort()).toEqual(Object.keys(fromSchema.properties).sort());

    const { productInputSchema } = await import("../src/lib/schemas");
    const productDoc = doc.components.schemas.ProductInput as { properties: Record<string, unknown> };
    const productSchema = z.toJSONSchema(productInputSchema, { io: "input" }) as { properties: Record<string, unknown> };
    expect(Object.keys(productDoc.properties).sort()).toEqual(Object.keys(productSchema.properties).sort());
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("serves the same document, unauthenticated (public docs, same trust boundary as /api/export)", async () => {
    const { GET } = await import("../src/app/api/v1/openapi.json/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/openapi.json"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers[0].url).toBe("http://localhost/api/v1");
  });
});

describe("GET /api/v1/docs", () => {
  it("serves an HTML page that points Swagger UI at the local spec and local assets (no CDN)", async () => {
    const { GET } = await import("../src/app/api/v1/docs/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/api/v1/openapi.json");
    expect(html).toContain("/swagger/swagger-ui-bundle.js");
    expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
  });
});
