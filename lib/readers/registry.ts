import "server-only";

import type { Extraction, ExtractionStatus } from "@/db/schema";
import { cancelBmwLabour, createBmwLabour, downloadBmwLabourArchive, getBmwLabourState, resumeBmwLabour } from "@/lib/readers/bmw/client";
import { bmwBrandSchema, type BmwLabourState } from "@/lib/readers/bmw/types";
import { cancelMercedesLabour, createMercedesLabour, getMercedesLabourState, resumeMercedesLabour } from "@/lib/readers/mercedes/client";
import type { MercedesLabourState } from "@/lib/readers/mercedes/types";
import { ReaderError } from "@/lib/readers/errors";
import { cancelRenaultLabour, createRenaultLabour, getRenaultLabourOptions, getRenaultLabourState, getRenaultReaderCapabilities, getRenaultSettings, resumeRenaultLabour } from "@/lib/readers/renault/client";
import type { RenaultState } from "@/lib/readers/renault/types";

const RUNNING_RENAULT_STATES = new Set(["authenticating", "discovering", "validating", "checking_remote", "submitted", "waiting", "downloading", "uploading", "running", "rate_limited", "rate-limited", "paused", "cancelling"]);

export type ReaderSubmissionContext = Awaited<ReturnType<typeof getRenaultLabourOptions>> | undefined;
export type ExtractionReaderCapabilities = { cancel: boolean; resume: boolean; download: boolean };

export type ExtractionReader = {
  prepareSubmission(): Promise<ReaderSubmissionContext>;
  create(extraction: Extraction, context?: ReaderSubmissionContext): Promise<{ requestId: string; status?: string }>;
  getState(requestId: string): Promise<{ status: string; stage?: string; progress?: number | null; readerStalled?: boolean; details?: unknown; dataDate?: string | null; error?: { message: string } | null }>;
  mapStatus(state: { status: string }): ExtractionStatus;
  failureMessage(state: { error?: { message: string } | null }): string;
  cancel?(requestId: string): Promise<{ requestId: string; status: string }>;
  resume?(requestId: string, force?: boolean): Promise<{ requestId: string; status: string }>;
  downloadArchive?(requestId: string): Promise<Response>;
  getCapabilities?(): Promise<ExtractionReaderCapabilities>;
};

const renaultReader: ExtractionReader = {
  async prepareSubmission() {
    if ((await getRenaultReaderCapabilities())?.create) return undefined;
    const settings = getRenaultSettings();
    return getRenaultLabourOptions(settings.range);
  },
  async create(extraction, context) {
    const params = extraction.readerParams;
    return createRenaultLabour({
      family: params.family,
      brand: extraction.brand,
      options: context,
      axCode: extraction.axCode,
      edition: extraction.imcEdition,
      language: params.language,
      format: params.format,
      range: params.range,
    });
  },
  async getState(requestId) {
    const state = await getRenaultLabourState(requestId);
    const error = typeof state.error === "string" ? state.error : state.error?.message;
    return { status: state.status, stage: state.stage, progress: state.progress, readerStalled: state.details?.stalled ?? false, details: state.details, error: error ? { message: error } : null };
  },
  mapStatus(state) {
    if (state.status === "completed") return "completed";
    if (state.status === "failed") return "failed";
    if (state.status === "cancelled") return "cancelled";
    if (state.status === "queued" || RUNNING_RENAULT_STATES.has(state.status)) return "running";
    throw new ReaderError("Renault ha devuelto un estado desconocido.", "UNKNOWN_READER_STATUS", false);
  },
  failureMessage: () => "Renault no ha podido completar la extracción.",
  cancel: cancelRenaultLabour,
  resume: resumeRenaultLabour,
  async getCapabilities() {
    const capabilities = await getRenaultReaderCapabilities();
    return { cancel: capabilities?.cancel ?? false, resume: capabilities?.resume ?? false, download: capabilities?.download ?? true };
  },
};

function mapCoreReaderStatus(name: string): ExtractionReader["mapStatus"] {
  return (state) => {
    switch (state.status) {
      case "queued": return "pending";
      case "running":
      case "rate_limited":
      case "paused":
      case "cancelling": return "running";
      case "completed": return "completed";
      case "failed": return "failed";
      case "cancelled": return "cancelled";
      default: throw new ReaderError(`${name} ha devuelto un estado desconocido.`, "UNKNOWN_READER_STATUS", false);
    }
  };
}

const bmwReader: ExtractionReader = {
  async prepareSubmission() { return undefined; },
  async create(extraction) {
    const params = extraction.readerParams;
    const brand = bmwBrandSchema.safeParse(extraction.brand);
    if (!brand.success) throw new ReaderError("La marca guardada para la extracción BMW no es válida.", "INVALID_BMW_SELECTION", false, 400);
    return createBmwLabour({
      brand: brand.data,
      series: params.series,
      developmentCode: params.developmentCode,
      typekey: params.typekey,
      axCode: extraction.axCode,
      imcEdition: extraction.imcEdition,
      language: params.language || undefined,
    });
  },
  async getState(requestId) {
    const state = await getBmwLabourState(requestId);
    return { ...state, readerStalled: state.details?.stalled ?? false, dataDate: state.request?.selection?.date ?? null };
  },
  cancel: cancelBmwLabour,
  resume: resumeBmwLabour,
  downloadArchive: downloadBmwLabourArchive,
  async getCapabilities() { return { cancel: true, resume: true, download: true }; },
  mapStatus: mapCoreReaderStatus("BMW"),
  failureMessage(state) { return state.error?.message || "BMW no ha podido completar la extracción."; },
};

const mercedesReader: ExtractionReader = {
  async prepareSubmission() { return undefined; },
  async create(extraction) {
    const { series, date } = extraction.readerParams;
    if (!series || !date) throw new ReaderError("La extracción de Mercedes-Benz no tiene serie o fecha guardadas.", "INVALID_MERCEDES_SELECTION", false, 400);
    return createMercedesLabour({ series, date, modelDesignations: [extraction.modelCode], axCode: extraction.axCode, imcEdition: extraction.imcEdition });
  },
  async getState(requestId) {
    const state = await getMercedesLabourState(requestId);
    return { ...state, readerStalled: state.details?.stalled ?? false, dataDate: state.request?.selection?.date ?? null };
  },
  cancel: cancelMercedesLabour,
  resume: resumeMercedesLabour,
  async getCapabilities() { return { cancel: true, resume: true, download: false }; },
  mapStatus: mapCoreReaderStatus("Mercedes-Benz"),
  failureMessage(state) { return state.error?.message || "Mercedes-Benz no ha podido completar la extracción."; },
};

const readers: Record<string, ExtractionReader> = {
  "mercedes-labours": mercedesReader,
  "renault-labours": renaultReader,
  "bmw-labours": bmwReader,
};

export function getExtractionReader(readerKey: string) {
  const reader = readers[readerKey];
  if (!reader) throw new ReaderError("El reader asociado a esta extracción no está disponible.", "READER_CONFIGURATION_ERROR", false, 500);
  return reader;
}

export async function getExtractionReaderCapabilities(readerKey: string) {
  const reader = getExtractionReader(readerKey);
  return await reader.getCapabilities?.() ?? { cancel: false, resume: false, download: false };
}

export function mapBmwReaderStatus(state: BmwLabourState) {
  return bmwReader.mapStatus(state);
}

export function mapRenaultReaderStatus(state: RenaultState) {
  return renaultReader.mapStatus(state);
}

export function mapMercedesReaderStatus(state: MercedesLabourState) {
  return mercedesReader.mapStatus(state);
}
