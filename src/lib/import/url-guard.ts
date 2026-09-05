/**
 * SSRF guard for the product import (docs/plan-produkt-import-url.md §4.1).
 *
 * This app runs in a container on a home NAS, next to the TrueNAS middleware,
 * Grafana, InfluxDB and Zigbee2MQTT. A field where a person types a URL that
 * the SERVER then fetches is an SSRF primitive: without this module, "import a
 * product" doubles as "make my aquarium app probe my LAN".
 *
 * Two layers, because either alone is a hole:
 *  1. `parseImportUrl()` — scheme, credentials, literal-IP and local-suffix
 *     checks on the URL itself. Pure, no network.
 *  2. `resolveTarget()` — DNS, then EVERY resolved address is checked. A
 *     hostname is not safe just because it is a hostname: `nas.example.com`
 *     may resolve to 192.168.178.3, and that is the whole attack.
 *
 * The caller must run step 2 again for every redirect hop — a 302 to
 * http://192.168.178.3 would otherwise walk straight past step 1.
 */

import { lookup } from "node:dns/promises";
import type { ErrorCode } from "@/lib/domain/errors";

export type UrlCheck = { ok: true; url: URL } | { ok: false; code: ErrorCode };

/** Hostnames that never leave the machine, whatever DNS says. */
const LOCAL_SUFFIXES = [".local", ".localhost", ".internal", ".home", ".lan", ".intranet"];

/** IPv4 ranges that must never be fetched, as [first, last] of the 32-bit value. */
const BLOCKED_V4: [number, number][] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8      this network
  [0x0a000000, 0x0affffff], // 10.0.0.0/8     private
  [0x64400000, 0x647fffff], // 100.64.0.0/10  CGNAT (Tailscale lives here)
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8    loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12  private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24   IETF assignments
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private — the NAS itself
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15  benchmarking
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
];

/** Dotted quad → 32-bit number, or null when it is not a plain IPv4 literal. */
export function parseIPv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    // Reject "01", "0x7f" and "" — Node's fetch would happily accept some of
    // these spellings, and a lenient parser here is a bypass.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc;
}

/**
 * True when this address must not be fetched.
 *
 * Unrecognised input is treated as blocked: a shape we cannot classify is a
 * shape we cannot vouch for, and the cost of a false positive here is one
 * failed import.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value === "") return true;

  const v4 = parseIPv4(value);
  if (v4 !== null) return BLOCKED_V4.some(([lo, hi]) => v4 >= lo && v4 <= hi);

  if (!value.includes(":")) return true; // neither IPv4 nor IPv6

  // IPv4-mapped/-compatible (::ffff:192.168.1.1) is an IPv4 target wearing a
  // v6 hat — classify it as the v4 address it really is.
  const tail = value.slice(value.lastIndexOf(":") + 1);
  const mapped = parseIPv4(tail);
  if (mapped !== null) return BLOCKED_V4.some(([lo, hi]) => mapped >= lo && mapped <= hi);

  const bare = value.replace(/^\[|\]$/g, "").split("%")[0]; // strip brackets + zone id
  if (bare === "::" || bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;
  const head = bare.split(":")[0];
  if (head === "") return true; // "::something" — unspecified-prefixed, not a public host
  const group = Number.parseInt(head, 16);
  if (Number.isNaN(group)) return true;
  if ((group & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((group & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((group & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  return false;
}

/**
 * Check the URL itself. Everything here is decidable without a network call,
 * so a hostile URL never costs a DNS query, let alone a request.
 */
export function parseImportUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, code: "productImport.invalidUrl" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "productImport.invalidUrl" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "productImport.invalidUrl" };
  }
  // `https://user:pass@host` — credentials in an imported URL are either a
  // mistake or an attempt to reach something that needs them. Neither belongs
  // in a product description.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, code: "productImport.blockedAddress" };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, code: "productImport.blockedAddress" };
  }
  // A literal IP is classified right here; a name has to wait for DNS.
  if (parseIPv4(host) !== null || host.includes(":")) {
    if (isBlockedAddress(host)) return { ok: false, code: "productImport.blockedAddress" };
  }

  return { ok: true, url };
}

export type Lookup = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: Lookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolve the hostname and reject if ANY answer points somewhere private.
 *
 * All answers, not just the first: a name that resolves to both a public and a
 * private address would otherwise be a coin flip, and `fetch` picks its own.
 *
 * `lookupFn` is injectable so the tests can cover the interesting resolutions
 * (a public name answering 192.168.x.x) without touching real DNS.
 */
export async function resolveTarget(url: URL, lookupFn: Lookup = defaultLookup): Promise<UrlCheck> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Literal addresses were already classified in parseImportUrl.
  if (parseIPv4(host) !== null || host.includes(":")) {
    return isBlockedAddress(host) ? { ok: false, code: "productImport.blockedAddress" } : { ok: true, url };
  }

  let answers: { address: string }[];
  try {
    answers = await lookupFn(host);
  } catch {
    return { ok: false, code: "productImport.unreachable" };
  }
  if (answers.length === 0) return { ok: false, code: "productImport.unreachable" };
  if (answers.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, code: "productImport.blockedAddress" };
  }
  return { ok: true, url };
}
