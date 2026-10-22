import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getDatabaseSqlFiles } from "./migrations";

const composeArgs = ["compose", "exec", "-T", "postgres", "sh", "-c", "psql -v ON_ERROR_STOP=1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\""];

function runSqlFile(file: string) {
  return new Promise<number>(async (resolve, reject) => {
    const child = spawn("docker", composeArgs, { env: process.env, stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
    child.stdin.end(await readFile(file, "utf8"));
  });
}

for (const file of await getDatabaseSqlFiles()) {
  if ((await runSqlFile(file)) !== 0) throw new Error(`Database SQL failed: ${file}`);
}
