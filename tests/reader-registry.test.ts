import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  createBmwLabour: vi.fn(),
  getBmwLabourState: vi.fn(),
  cancelBmwLabour: vi.fn(),
  resumeBmwLabour: vi.fn(),
  downloadBmwLabourArchive: vi.fn(),
  createRenaultLabour: vi.fn(),
  getRenaultLabourOptions: vi.fn(),
  getRenaultLabourState: vi.fn(),
  getRenaultSettings: vi.fn(),
  getRenaultReaderCapabilities: vi.fn(),
  cancelRenaultLabour: vi.fn(),
  resumeRenaultLabour: vi.fn(),
}));

vi.mock("@/lib/readers/bmw/client", () => ({ createBmwLabour: readers.createBmwLabour, getBmwLabourState: readers.getBmwLabourState, cancelBmwLabour: readers.cancelBmwLabour, resumeBmwLabour: readers.resumeBmwLabour, downloadBmwLabourArchive: readers.downloadBmwLabourArchive }));
vi.mock("@/lib/readers/renault/client", () => ({
  createRenaultLabour: readers.createRenaultLabour,
  getRenaultLabourOptions: readers.getRenaultLabourOptions,
  getRenaultLabourState: readers.getRenaultLabourState,
  getRenaultSettings: readers.getRenaultSettings,
  getRenaultReaderCapabilities: readers.getRenaultReaderCapabilities,
  cancelRenaultLabour: readers.cancelRenaultLabour,
  resumeRenaultLabour: readers.resumeRenaultLabour,
}));

import { getExtractionReader } from "@/lib/readers/registry";

describe("extraction reader registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readers.getRenaultReaderCapabilities.mockResolvedValue(null);
  });

  it("sends BMW parameters through the BMW adapter without development-start metadata", async () => {
    readers.createBmwLabour.mockResolvedValueOnce({ requestId: "7be5f2af-879b-4c61-84d5-6e728f438a02" });
    const reader = getExtractionReader("bmw-labours");
    const extraction = {
      brand: "MINI",
      axCode: "AX_123",
      imcEdition: "05/0",
      readerParams: { series: "F56", developmentCode: "F56", typekey: "11EH", language: "en-GB", developmentStart: "2026-03-14" },
    } as never;

    await reader.create(extraction);

    expect(readers.createBmwLabour).toHaveBeenCalledWith({
      brand: "MINI",
      series: "F56",
      developmentCode: "F56",
      typekey: "11EH",
      axCode: "AX_123",
      imcEdition: "05/0",
      language: "en-GB",
    });
    expect(readers.createBmwLabour.mock.calls[0]?.[0]).not.toHaveProperty("developmentStart");
  });

  it("keeps Renault's options preparation on its existing adapter", async () => {
    const options = { range: "active" };
    readers.getRenaultSettings.mockReturnValueOnce({ range: "active" });
    readers.getRenaultLabourOptions.mockResolvedValueOnce(options);

    await expect(getExtractionReader("renault-labours").prepareSubmission()).resolves.toBe(options);
    expect(readers.getRenaultLabourOptions).toHaveBeenCalledWith("active");
  });
});
