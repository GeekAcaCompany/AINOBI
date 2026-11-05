// SPDX-License-Identifier: AGPL-3.0-only
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * `/render/video` drives a real headless browser against an arbitrary,
 * caller-supplied URL. Without a guard an authenticated caller could point
 * the server-side browser at internal services / cloud metadata endpoints
 * (SSRF). This module blocks obviously-private/reserved targets and,
 * optionally, restricts rendering to an explicit host allowlist.
 */
export class RenderUrlBlockedError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "RenderUrlBlockedError";
  }
}

function resolveAllowedHosts(): string[] | undefined {
  const raw = process.env.AINOBI_VIDEO_RENDER_ALLOWED_HOSTS?.trim();
  if (!raw) {
    return undefined;
  }
  const hosts = raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : undefined;
}

/**
 * Local-dev escape hatch: when true, skip the private/loopback/reserved-address ban
 * (still enforce protocol + optional host allowlist). Production must leave this unset.
 * Accepts true/1/yes (case-insensitive).
 */
function allowPrivateUrls(): boolean {
  const raw = process.env.AINOBI_VIDEO_RENDER_ALLOW_PRIVATE_URLS?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
}

/** IPv4 private/reserved ranges: RFC1918, loopback, link-local (incl. cloud metadata), CGNAT. */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a >= 224) return true; // multicast/reserved (224.0.0.0/4) and above
  return false;
}

/** IPv6 private/reserved ranges: loopback, link-local, unique-local, IPv4-mapped. */
function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateOrReservedIpv4(normalized.slice("::ffff:".length));
  }
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateOrReservedIpv4(ip);
  if (family === 6) return isPrivateOrReservedIpv6(ip);
  return true; // not a valid IP literal — fail closed
}

/**
 * Throws {@link RenderUrlBlockedError} if `rawUrl` targets a private/reserved
 * address, an unsupported protocol, or (when configured) a host outside
 * `AINOBI_VIDEO_RENDER_ALLOWED_HOSTS`. Resolves DNS for hostnames so a
 * public-looking domain that resolves to an internal IP (DNS rebinding) is
 * also blocked.
 */
export async function assertRenderUrlAllowed(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new RenderUrlBlockedError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RenderUrlBlockedError(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;
  // WHATWG URL keeps brackets around IPv6 literals (e.g. "[::1]"); strip them
  // so net.isIP()/dns.lookup() see the bare address.
  const bareHost =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  const allowedHosts = resolveAllowedHosts();
  if (allowedHosts && !hostMatchesAllowlist(hostname, allowedHosts)) {
    throw new RenderUrlBlockedError(`Host is not on the render allowlist: ${hostname}`);
  }

  // Local student-view (e.g. http://localhost:5173/courseware-renderer) needs an
  // explicit opt-in; production leaves this unset and keeps the private-IP ban.
  if (allowPrivateUrls()) {
    return;
  }

  if (bareHost.toLowerCase() === "localhost") {
    throw new RenderUrlBlockedError("Target host resolves to localhost");
  }

  if (isIP(bareHost)) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new RenderUrlBlockedError(
        `Target host is a private/reserved address: ${hostname}`,
      );
    }
    return;
  }

  try {
    const records = await lookup(bareHost, { all: true, verbatim: true });
    for (const { address } of records) {
      if (isPrivateOrReservedIp(address)) {
        throw new RenderUrlBlockedError(
          `Target host "${hostname}" resolves to a private/reserved address (${address})`,
        );
      }
    }
  } catch (error) {
    if (error instanceof RenderUrlBlockedError) {
      throw error;
    }
    // DNS resolution failure (NXDOMAIN, resolver hiccup, etc.) — let the actual
    // browser navigation surface the real error instead of masking it here.
  }
}
