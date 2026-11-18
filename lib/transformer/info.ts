import type { TransformerJobStatus } from "@/db/schema";

export type TransformerComparisonInfo = {
  id: string;
  filename: string;
  status: TransformerJobStatus;
  error: string | null;
  createdAt: string;
  downloadReady: boolean;
};

export type TransformerReportInfo = {
  status: TransformerJobStatus | null;
  /** Times the report was sent to the transformer; above zero while the status is empty means it is being retried. */
  attempts: number;
  error: string | null;
  completedAt: string | null;
  /** The transformer holds the Excel; true also for a failed report whose last step failed after the file was written. */
  downloadReady: boolean;
  canRetry: boolean;
};

export type TransformerRequestInfo = {
  requestGroupId: string;
  /** BMW requests are loaded and compared with an .LST; Mercedes-Benz requests get a report Excel. */
  kind: "bmw" | "mercedes";
  /** False when the transformer is not configured or the request is not an approved BMW or Mercedes-Benz request. */
  applicable: boolean;
  loadStatus: TransformerJobStatus | null;
  /** Times the load was sent to the transformer; above zero while the status is empty means it is being retried. */
  loadAttempts: number;
  loadError: string | null;
  loadedAt: string | null;
  canRetryLoad: boolean;
  canUpload: boolean;
  comparisons: TransformerComparisonInfo[];
  report: TransformerReportInfo | null;
};
