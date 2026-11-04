/**
 * Plain HTTP is only acceptable for traffic that never leaves the machine or the Docker network: loopback, or a
 * single-label host name such as a Docker service ("bmw-reader-api"). Any host name with dots needs HTTPS.
 * (URL turns numeric hosts like "10" into dotted IPv4 addresses, so they do not pass as service names.)
 */
export function allowsPlainHttp(hostname: string) {
  if (hostname === "127.0.0.1" || hostname === "[::1]") return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname);
}

export function isTrustedServiceUrl(url: URL) {
  return url.protocol === "https:" || (url.protocol === "http:" && allowsPlainHttp(url.hostname));
}
