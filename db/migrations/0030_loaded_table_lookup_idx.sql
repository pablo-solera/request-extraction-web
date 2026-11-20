-- Plain CREATE INDEX on purpose: CONCURRENTLY cannot run inside the drizzle-kit migration transaction and the table is small.
CREATE INDEX "extraction_requests_loaded_table_idx" ON "extraction_requests" ("brand", "imc_edition", upper("ax_code")) WHERE "manufacturer_group" = 'BMW' AND "load_status" IN ('queued', 'running', 'completed');
