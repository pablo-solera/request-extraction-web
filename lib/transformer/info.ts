import type { TransformerJobStatus } from "@/db/schema";

export type TransformerComparisonInfo = {
  id: string;
  filename: string;
  status: TransformerJobStatus;
  error: string | null;
  createdAt: string;
  downloadReady: boolean;
};

export type TransformerRequestInfo = {
  requestGroupId: string;
  /** False when the transformer is not configured or the request is not an approved BMW request. */
  applicable: boolean;
  loadStatus: TransformerJobStatus | null;
  loadError: string | null;
  loadedAt: string | null;
  canRetryLoad: boolean;
  canUpload: boolean;
  comparisons: TransformerComparisonInfo[];
};
