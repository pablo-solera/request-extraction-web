import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { getDatabaseSqlFiles } from "./migrations";

const composeArgs = ["compose", "-p", "request-extraction-web-test", "-f", "docker-compose.test.yml"];
function run(command: string, args: string[], env?: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
function capture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} exited with ${code}`)));
  });
}
async function runSqlFile(file: string) {
  const input = await readFile(file, "utf8");
  return new Promise<number>((resolve, reject) => {
    const child = spawn("docker", [...composeArgs, "exec", "-T", "postgres-test", "psql", "-v", "ON_ERROR_STOP=1", "-U", "request_extraction_test", "-d", "request_extraction_test"], { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
    child.stdin.end(input);
  });
}
const upCode = await run("docker", [...composeArgs, "up", "-d", "--wait"]);
if (upCode !== 0) process.exit(upCode);
try {
  const publishedPort = await capture("docker", [...composeArgs, "port", "postgres-test", "5432"]);
  const hostPort = publishedPort.split(":").at(-1);
  if (!hostPort) throw new Error(`Could not determine PostgreSQL test port from: ${publishedPort}`);
  for (const file of await getDatabaseSqlFiles()) {
    if ((await runSqlFile(file)) !== 0) throw new Error(`${file} failed`);
  }
    process.exitCode = await run("bunx", ["vitest", "run", "--config", "vitest.config.mts"], { DATABASE_URL: `postgres://request_extraction_test:request_extraction_test_password@localhost:${hostPort}/request_extraction_test` });
} finally {
  await run("docker", [...composeArgs, "down", "-v"]);
}
