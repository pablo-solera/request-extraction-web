import {
  index,
  integer,
  boolean,
  jsonb,
  check,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const extractionDomain = pgEnum("extraction_domain", ["parts", "labours"]);
export const extractionStatus = pgEnum("extraction_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TransformerJobStatus = "queued" | "running" | "completed" | "failed";
export const extractionRequestStatus = pgEnum("extraction_request_status", ["pending", "approved", "rejected"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    oracleEmpId: integer("oracle_emp_id"),
    fallbackEmail: text("fallback_email"),
    fallbackName: text("fallback_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    tokenVersion: integer("token_version").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("users_oracle_emp_id_unique").on(table.oracleEmpId).where(sql`${table.oracleEmpId} IS NOT NULL`),
    uniqueIndex("users_fallback_email_unique").on(table.fallbackEmail).where(sql`${table.fallbackEmail} IS NOT NULL`),
  ],
);

export const extractionRequests = pgTable("extraction_requests", {
  requestGroupId: uuid("request_group_id").primaryKey(),
  requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  coordinatorId: uuid("coordinator_id").references(() => users.id, { onDelete: "restrict" }),
  axCode: text("ax_code").notNull(),
  imcEdition: text("imc_edition").notNull(),
  completion: date("completion", { mode: "string" }).notNull(),
  developmentStart: date("development_start", { mode: "string" }),
  comments: text("comments"),
  manufacturerGroup: text("manufacturer_group").notNull(),
  brand: text("brand").notNull(),
  status: extractionRequestStatus("status").default("pending").notNull(),
  loadStatus: text("load_status").$type<TransformerJobStatus>(),
  loadRemoteId: text("load_remote_id"),
  loadError: text("load_error"),
  loadAttempts: integer("load_attempts").default(0).notNull(),
  loadStartFailures: integer("load_start_failures").default(0).notNull(),
  loadRequestedAt: timestamp("load_requested_at", { withTimezone: true }),
  loadedAt: timestamp("loaded_at", { withTimezone: true }),
  loadPolledAt: timestamp("load_polled_at", { withTimezone: true }),
  reportStatus: text("report_status").$type<TransformerJobStatus>(),
  reportRemoteId: text("report_remote_id"),
  reportError: text("report_error"),
  reportAttempts: integer("report_attempts").default(0).notNull(),
  reportStartFailures: integer("report_start_failures").default(0).notNull(),
  reportDownloadable: boolean("report_downloadable").default(false).notNull(),
  reportRequestedAt: timestamp("report_requested_at", { withTimezone: true }),
  reportCompletedAt: timestamp("report_completed_at", { withTimezone: true }),
  reportPolledAt: timestamp("report_polled_at", { withTimezone: true }),
  decisionComment: text("decision_comment"),
  decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("extraction_requests_status_idx").on(table.createdAt).where(sql`${table.status} = 'pending'`),
  index("extraction_requests_coordinator_pending_idx").on(table.coordinatorId, table.createdAt).where(sql`${table.status} = 'pending'`),
  index("extraction_requests_requester_idx").on(table.requesterId),
  index("extraction_requests_created_idx").on(table.createdAt.desc(), table.requestGroupId.desc()),
  index("extraction_requests_requester_created_idx").on(table.requesterId, table.createdAt.desc(), table.requestGroupId.desc()),
  index("extraction_requests_load_active_idx").on(table.loadRequestedAt).where(sql`${table.loadStatus} IN ('queued', 'running')`),
  index("extraction_requests_report_active_idx").on(table.reportRequestedAt).where(sql`${table.reportStatus} IN ('queued', 'running')`),
  index("extraction_requests_loaded_table_idx").on(table.brand, table.imcEdition, sql`upper(${table.axCode})`).where(sql`${table.manufacturerGroup} = 'BMW' AND ${table.loadStatus} IN ('queued', 'running', 'completed')`),
  index("extraction_requests_ready_for_load_idx").on(table.createdAt).where(sql`${table.status} = 'approved' AND ${table.manufacturerGroup} = 'BMW' AND ${table.loadStatus} IS NULL`),
  index("extraction_requests_ready_for_report_idx").on(table.createdAt).where(sql`${table.status} = 'approved' AND ${table.manufacturerGroup} = 'Mercedes' AND ${table.reportStatus} IS NULL`),
  check("extraction_requests_report_status_check", sql`${table.reportStatus} IS NULL OR ${table.reportStatus} IN ('queued', 'running', 'completed', 'failed')`),
  check("extraction_requests_load_status_check", sql`${table.loadStatus} IS NULL OR ${table.loadStatus} IN ('queued', 'running', 'completed', 'failed')`),
  index("extraction_requests_decided_by_idx").on(table.decidedById),
]);

export const extractions = pgTable(
  "extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestGroupId: uuid("request_group_id").notNull().references(() => extractionRequests.requestGroupId, { onDelete: "cascade" }),
    modelDescription: text("model_description").notNull(),
    modelCode: text("model_code").notNull(),
    dataDate: text("data_date"),
    domain: extractionDomain("domain").notNull(),
    readerKey: text("reader_key").notNull(),
    readerParamsVersion: integer("reader_params_version").default(1).notNull(),
    readerParams: jsonb("reader_params").$type<Record<string, string>>().notNull(),
    remoteRequestId: text("remote_request_id"),
    progress: integer("progress"),
    readerStatus: text("reader_status"),
    readerStalled: boolean("reader_stalled").default(false).notNull(),
    readerPolledAt: timestamp("reader_polled_at", { withTimezone: true }),
    status: extractionStatus("status").default("pending").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("extractions_user_created_idx").on(table.userId, table.createdAt),
    index("extractions_group_created_idx").on(table.requestGroupId, table.createdAt),
    index("extractions_active_idx").on(table.updatedAt).where(sql`${table.status} IN ('pending', 'running')`),
    index("extractions_user_active_idx").on(table.userId, table.status).where(sql`${table.status} IN ('pending', 'running')`),
    uniqueIndex("extractions_reader_remote_unique").on(table.readerKey, table.remoteRequestId).where(sql`${table.remoteRequestId} IS NOT NULL`),
    check("extractions_terminal_error_check", sql`(${table.status} IN ('completed', 'failed', 'cancelled')) OR ${table.completedAt} IS NULL`),
    check("extractions_reader_params_object_check", sql`jsonb_typeof(${table.readerParams}) = 'object'`),
    check("extractions_progress_range_check", sql`${table.progress} IS NULL OR (${table.progress} >= 0 AND ${table.progress} <= 100)`),
    check("extractions_data_date_check", sql`${table.dataDate} IS NULL OR ${table.dataDate} ~ '^[0-9]{8}$'`),
    check("extractions_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("extractions_failed_error_check", sql`${table.status} <> 'failed' OR ${table.errorCode} IS NOT NULL`),
    check("extractions_completed_date_check", sql`${table.status} <> 'completed' OR ${table.completedAt} IS NOT NULL`),
  ],
);

export const comparisonReports = pgTable("comparison_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestGroupId: uuid("request_group_id").notNull().references(() => extractionRequests.requestGroupId, { onDelete: "cascade" }),
  uploadedById: uuid("uploaded_by_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  sourceFilename: text("source_filename").notNull(),
  remoteReportId: text("remote_report_id"),
  status: text("status").$type<TransformerJobStatus>().default("queued").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  polledAt: timestamp("polled_at", { withTimezone: true }),
}, (table) => [
  index("comparison_reports_request_created_idx").on(table.requestGroupId, table.createdAt),
  index("comparison_reports_active_idx").on(table.updatedAt).where(sql`${table.status} IN ('queued', 'running')`),
  index("comparison_reports_uploaded_by_idx").on(table.uploadedById),
  check("comparison_reports_status_check", sql`${table.status} IN ('queued', 'running', 'completed', 'failed')`),
]);

export type MailNotificationStatus = "sending" | "sent" | "failed" | "skipped";
export const mailNotifications = pgTable("mail_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestGroupId: uuid("request_group_id").notNull().references(() => extractionRequests.requestGroupId, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  ref: text("ref").notNull(),
  status: text("status").$type<MailNotificationStatus>().default("sending").notNull(),
  attempts: integer("attempts").default(1).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("mail_notifications_event_unique").on(table.requestGroupId, table.kind, table.ref),
  check("mail_notifications_status_check", sql`${table.status} IN ('sending', 'sent', 'failed', 'skipped')`),
  check("mail_notifications_attempts_check", sql`${table.attempts} >= 1`),
]);

export const extractionActionLogs = pgTable("extraction_action_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  extractionId: uuid("extraction_id").notNull().references(() => extractions.id, { onDelete: "restrict" }),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  readerStatus: text("reader_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("extraction_action_logs_extraction_created_idx").on(table.extractionId, table.createdAt),
  index("extraction_action_logs_actor_created_idx").on(table.actorId, table.createdAt),
  check("extraction_action_logs_action_check", sql`${table.action} IN ('cancel', 'resume', 'force_resume')`),
  check("extraction_action_logs_outcome_check", sql`${table.outcome} IN ('succeeded', 'failed')`),
]);

export type User = typeof users.$inferSelect;
export type ExtractionRow = typeof extractions.$inferSelect;
export type ExtractionSharedFields = Pick<ExtractionRequest, "axCode" | "imcEdition" | "completion" | "developmentStart" | "comments" | "manufacturerGroup" | "brand">;
export type Extraction = ExtractionRow & ExtractionSharedFields;
export type ComparisonReport = typeof comparisonReports.$inferSelect;
export type ExtractionRequest = typeof extractionRequests.$inferSelect;
export type ExtractionActionLog = typeof extractionActionLogs.$inferSelect;
export type ExtractionStatus = (typeof extractionStatus.enumValues)[number];
export type ExtractionRequestStatus = (typeof extractionRequestStatus.enumValues)[number];
