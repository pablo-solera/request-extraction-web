import "server-only";

import { createRequire } from "node:module";

// Loaded at runtime so local development can typecheck without the optional Oracle driver.
type OracleModule = {
  OUT_FORMAT_OBJECT: number;
  initOracleClient(options?: { libDir?: string }): void;
  createPool(options: Record<string, unknown>): Promise<{ getConnection(): Promise<{ callTimeout: number; execute<T>(sql: string, binds: Record<string, unknown>, options: { outFormat: number }): Promise<{ rows?: T[] }>; close(): Promise<void> }> }>;
};

type OraclePool = Awaited<ReturnType<OracleModule["createPool"]>>;

const allowedSchemas = new Set(["TIMERTASK_ES", "TIMERTASK_BR", "TIMERTASK_CN", "TIMERTASK_DE", "TIMERTASK_FR", "TIMERTASK_MX", "TIMERTASK_US", "TIMERTASK_UKAD", "TIMERTASK_HPI", "TIMERTASK_ESSE", "TIMERTASK_MXUS"]);
declare global {
  var __requestExtractionOraclePool: OraclePool | undefined;
  var __requestExtractionOraclePoolPromise: Promise<OraclePool> | undefined;
  var __requestExtractionOracleInitialized: boolean | undefined;
}

function driver(): OracleModule {
  return createRequire(import.meta.url)("oracledb") as OracleModule;
}

export function getOracleSchema() {
  const schema = (process.env.ORACLE_TIMERTASK_SCHEMA ?? "TIMERTASK_ES").toUpperCase();
  if (!allowedSchemas.has(schema)) throw new Error(`Unsupported ORACLE_TIMERTASK_SCHEMA: ${schema}`);
  return schema;
}

async function getPool() {
  if (globalThis.__requestExtractionOraclePool) return globalThis.__requestExtractionOraclePool;
  if (globalThis.__requestExtractionOraclePoolPromise) return globalThis.__requestExtractionOraclePoolPromise;
  const user = process.env.ORACLE_USER?.trim();
  const password = process.env.ORACLE_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING?.trim();
  if (!user || !password || !connectString) throw new Error("ORACLE_USER, ORACLE_PASSWORD and ORACLE_CONNECT_STRING are required.");
  const oracle = driver();
  if (!globalThis.__requestExtractionOracleInitialized) {
    oracle.initOracleClient(process.env.ORACLE_CLIENT_LIB_DIR ? { libDir: process.env.ORACLE_CLIENT_LIB_DIR } : undefined);
    globalThis.__requestExtractionOracleInitialized = true;
  }
  globalThis.__requestExtractionOraclePoolPromise = oracle.createPool({ user, password, connectString, poolMin: 1, poolMax: 10, poolIncrement: 1, poolTimeout: 60, queueTimeout: 5000 })
    .then((createdPool) => {
      globalThis.__requestExtractionOraclePool = createdPool;
      return createdPool;
    })
    .catch((error: unknown) => {
      globalThis.__requestExtractionOraclePoolPromise = undefined;
      throw error;
    });
  return globalThis.__requestExtractionOraclePoolPromise;
}

export async function queryOracle<T>(query: string, binds: Record<string, unknown> = {}) {
  const connection = await (await getPool()).getConnection();
  try {
    connection.callTimeout = 5000;
    return (await connection.execute<T>(query, binds, { outFormat: driver().OUT_FORMAT_OBJECT })).rows ?? [];
  } finally {
    await connection.close();
  }
}
