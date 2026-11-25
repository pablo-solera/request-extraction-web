import "server-only";

import { isIP } from "node:net";
import { isTrustedServiceUrl } from "@/lib/readers/service-url";

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog", "instance-data"]);

function isPrivateIPv4(host: string) {
  const [a = 0, b = 0] = host.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Literal private, loopback, link-local (cloud metadata included) and unspecified addresses. */
export function isPrivateOrMetadataHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (METADATA_HOSTS.has(host)) return true;
  const version = isIP(host);
  if (version === 4) return isPrivateIPv4(host);
  if (version === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped) return isPrivateIPv4(mapped[1]!);
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
  }
  return false;
}

/**
 * The signed download location a reader or transformer answers with points at the S3 it uploaded to, which only that
 * service knows, so the web checks the shape of the URL and not its host: HTTPS (plain HTTP only inside the machine or the
 * Docker network), no credentials in it, and no literal private or metadata address. The service's own origin is always accepted.
 */
export function isAcceptableDownloadTarget(target: URL, serviceBase?: URL) {
  if (target.username || target.password) return false;
  if (serviceBase && target.origin === serviceBase.origin) return true;
  return isTrustedServiceUrl(target) && !isPrivateOrMetadataHost(target.hostname);
}
