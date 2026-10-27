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
  /** Times the load was sent to the transformer; above zero while the status is empty means it is being retried. */
  loadAttempts: number;
  loadError: string | null;
  loadedAt: string | null;
  canRetryLoad: boolean;
  canUpload: boolean;
  comparisons: TransformerComparisonInfo[];
};
