import { describe, expect, it } from "vitest";
import { isAcceptableDownloadTarget, isPrivateOrMetadataHost } from "@/lib/readers/download-target";

const service = new URL("http://bmw-transformer-api:3005");

describe("download target", () => {
  it("accepts HTTPS links to any public host", () => {
    expect(isAcceptableDownloadTarget(new URL("https://s3-eu.solera.farm/bucket/report.xlsx?sig=1"), service)).toBe(true);
    expect(isAcceptableDownloadTarget(new URL("https://s3-eu.solera.farm/bucket/report.xlsx?sig=1"))).toBe(true);
  });

  it("accepts plain HTTP only inside the machine or the Docker network", () => {
    expect(isAcceptableDownloadTarget(new URL("http://localhost:9000/bucket/f"))).toBe(true);
    expect(isAcceptableDownloadTarget(new URL("http://minio:9000/bucket/f"))).toBe(true);
    expect(isAcceptableDownloadTarget(new URL("http://s3.example.com/bucket/f"))).toBe(false);
  });

  it("always accepts the origin of the service itself, even on a private address", () => {
    const privateService = new URL("http://10.0.0.5:3005");
    expect(isAcceptableDownloadTarget(new URL("http://10.0.0.5:3005/v1/reports/1/file"), privateService)).toBe(true);
    expect(isAcceptableDownloadTarget(new URL("http://10.0.0.5:9000/bucket/f"), privateService)).toBe(false);
  });

  it("refuses credentials, other schemes and private or metadata addresses", () => {
    expect(isAcceptableDownloadTarget(new URL("https://user:pw@s3.example.com/f"), service)).toBe(false);
    expect(isAcceptableDownloadTarget(new URL("ftp://s3.example.com/f"))).toBe(false);
    for (const host of ["10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "127.0.0.1", "[::1]", "[fd00::1]", "metadata.google.internal"]) {
      expect(isAcceptableDownloadTarget(new URL(`https://${host}/f`))).toBe(false);
      expect(isPrivateOrMetadataHost(host)).toBe(true);
    }
  });
});
