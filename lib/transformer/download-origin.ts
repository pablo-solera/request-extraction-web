import { isIP } from "node:net";

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

function originsFromEnvironment() {
  return (process.env.TRANSFORMER_DOWNLOAD_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) => {
    try { return [new URL(value).origin]; } catch { return []; }
  });
}

/**
 * The signed download location must be the transformer's own origin or one listed in TRANSFORMER_DOWNLOAD_ORIGINS
 * (comma separated). Literal private or metadata addresses are refused unless it is the transformer's own origin.
 */
export function isAllowedDownloadTarget(target: URL, transformerBase: URL) {
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  if (target.username || target.password) return false;
  if (target.origin === transformerBase.origin) return true;
  if (isPrivateOrMetadataHost(target.hostname)) return false;
  return originsFromEnvironment().includes(target.origin);
}
