/**
 * SSRF guard (src/lib/import/url-guard.ts).
 *
 * This is the module that decides whether the NAS is allowed to fetch what a
 * person typed. Every case below is a way into the LAN this container sits on,
 * so "it looked fine" is not a passing grade — each range gets an assertion.
 */
import { describe, it, expect } from "vitest";
import { parseImportUrl, isBlockedAddress, parseIPv4, resolveTarget, type Lookup } from "../src/lib/import/url-guard";

const answers = (...addresses: string[]): Lookup => async () => addresses.map((address) => ({ address }));

describe("parseIPv4", () => {
  it("reads plain dotted quads", () => {
    expect(parseIPv4("0.0.0.0")).toBe(0);
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
  });

  // A lenient parser is a bypass: "0177.0.0.1" and "0x7f.1" are spellings of
  // loopback that some resolvers accept. We refuse to classify them at all,
  // and isBlockedAddress treats "cannot classify" as blocked.
  it("refuses octal, hex, short and oversized forms", () => {
    for (const bad of ["0177.0.0.1", "0x7f.0.0.1", "127.1", "127.0.0.256", "1.2.3.4.5", "", "1.2.3."]) {
      expect(parseIPv4(bad)).toBeNull();
    }
  });
});

describe("isBlockedAddress", () => {
  it("blocks every private, loopback, link-local and reserved IPv4 range", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1", // CGNAT — Tailscale
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.178.3", // the NAS this runs on
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.255.255"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local and multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "[::1]", "fe80::1%eth0"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("sees through IPv4-mapped IPv6", () => {
    expect(isBlockedAddress("::ffff:192.168.178.3")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("treats anything it cannot classify as blocked", () => {
    for (const junk of ["", "   ", "not-an-ip", "999.999.999.999"]) {
      expect(isBlockedAddress(junk), junk).toBe(true);
    }
  });
});

describe("parseImportUrl", () => {
  it("accepts ordinary http and https product pages", () => {
    const res = parseImportUrl("https://www.example.com/shop/food-p-1.html");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url.hostname).toBe("www.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(parseImportUrl("  https://example.com/x  ").ok).toBe(true);
  });

  it("rejects empty input and non-URLs", () => {
    for (const bad of ["", "   ", "not a url", "example.com/no-scheme"]) {
      const res = parseImportUrl(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.code).toBe("productImport.invalidUrl");
    }
  });

  it("rejects every scheme but http and https", () => {
    for (const bad of ["file:///etc/passwd", "data:text/html,<b>x", "ftp://example.com/x", "gopher://example.com"]) {
      const res = parseImportUrl(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.code).toBe("productImport.invalidUrl");
    }
  });

  it("rejects embedded credentials", () => {
    const res = parseImportUrl("https://user:pass@example.com/x");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("productImport.blockedAddress");
  });

  it("rejects localhost and local-only suffixes", () => {
    for (const bad of [
      "http://localhost:3000/",
      "http://truenas.local/",
      "http://nas.internal/x",
      "http://router.home/",
      "http://box.lan/",
    ]) {
      const res = parseImportUrl(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.code).toBe("productImport.blockedAddress");
    }
  });

  it("rejects literal private addresses without any DNS round trip", () => {
    for (const bad of ["http://192.168.178.3/", "http://127.0.0.1:3100/", "http://[::1]:3000/", "http://169.254.169.254/"]) {
      const res = parseImportUrl(bad);
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.code).toBe("productImport.blockedAddress");
    }
  });

  it("is case-insensitive about scheme and host", () => {
    expect(parseImportUrl("HTTP://LOCALHOST/x").ok).toBe(false);
    expect(parseImportUrl("HTTPS://Example.COM/x").ok).toBe(true);
  });
});

describe("resolveTarget", () => {
  it("passes a name that resolves publicly", async () => {
    const url = new URL("https://shop.example.com/p/1");
    await expect(resolveTarget(url, answers("93.184.216.34"))).resolves.toEqual({ ok: true, url });
  });

  // The whole point of the second layer: the hostname looks innocent, the
  // answer is the NAS.
  it("blocks a public name that resolves into the LAN", async () => {
    const res = await resolveTarget(new URL("https://totally-normal.example.com/p"), answers("192.168.178.3"));
    expect(res).toEqual({ ok: false, code: "productImport.blockedAddress" });
  });

  it("blocks when ANY answer is private, not just the first", async () => {
    const res = await resolveTarget(new URL("https://split.example.com/p"), answers("8.8.8.8", "10.0.0.5"));
    expect(res).toEqual({ ok: false, code: "productImport.blockedAddress" });
  });

  it("reports an unreachable host when DNS fails or answers nothing", async () => {
    const throwing: Lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await resolveTarget(new URL("https://nope.example.com/"), throwing)).toEqual({
      ok: false,
      code: "productImport.unreachable",
    });
    expect(await resolveTarget(new URL("https://empty.example.com/"), answers())).toEqual({
      ok: false,
      code: "productImport.unreachable",
    });
  });

  it("classifies literal addresses without consulting DNS", async () => {
    const explode: Lookup = async () => {
      throw new Error("DNS must not be called for a literal address");
    };
    const url = new URL("https://8.8.8.8/p");
    await expect(resolveTarget(url, explode)).resolves.toEqual({ ok: true, url });
    await expect(resolveTarget(new URL("http://192.168.1.1/p"), explode)).resolves.toEqual({
      ok: false,
      code: "productImport.blockedAddress",
    });
  });
});
