import { describe, expect, it } from "vitest";
import { allowsPlainHttp, isTrustedServiceUrl } from "@/lib/readers/service-url";

describe("service URL trust", () => {
  it("allows plain HTTP for loopback and for single-label Docker service names", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "bmw-reader-api", "renault-reader-api", "transformer"]) expect(allowsPlainHttp(host)).toBe(true);
    expect(isTrustedServiceUrl(new URL("http://bmw-reader-api:3004"))).toBe(true);
    expect(isTrustedServiceUrl(new URL("http://localhost:3004/"))).toBe(true);
  });

  it("requires HTTPS for any host name with dots or any other address", () => {
    for (const url of ["http://reader.internal:3004", "http://bmw-reader-peuwaxprvdacc03.axadmin.net", "http://10.0.0.5:3004", "http://192.168.1.2", "http://10", "http://[2001:db8::1]"]) {
      expect(isTrustedServiceUrl(new URL(url))).toBe(false);
    }
    expect(isTrustedServiceUrl(new URL("https://reader.example.test"))).toBe(true);
  });

  it("rejects other protocols", () => {
    expect(isTrustedServiceUrl(new URL("ftp://bmw-reader-api"))).toBe(false);
  });
});
