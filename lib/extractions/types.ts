import type { ExtractionRequestStatus, ExtractionStatus } from "@/db/schema";

export type ExtractionListItem = {
  id: string;
  requestGroupId: string;
  axCode: string;
  imcEdition: string;
  completion: string;
  developmentStart: string | null;
  manufacturerGroup: string;
  brand: string;
  modelDescription: string;
  modelCode: string;
  domain: "parts" | "labours";
  status: ExtractionStatus;
  requestStatus: ExtractionRequestStatus;
  errorMessage: string | null;
  progress: number | null;
  readerStatus: string | null;
  createdAt: string;
  updatedAt: string;
  downloadReady: boolean;
  requesterName: string | null;
  readerStalled: boolean;
  canCancel: boolean;
  canResume: boolean;
  canForceResume: boolean;
  canRepeat: boolean;
  canViewDetails: boolean;
};

export type ExtractionReaderDetail = {
  status: string;
  stage: string | null;
  progress: number | null;
  stalled: boolean;
  typekeys: Array<{ typekey: string; series: string | null; family: string | null; completed: number | null; total: number | null; remaining: number | null; failed: number | null; groups: number | null }>;
};
