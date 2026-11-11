import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const user = process.env.STORAGE_ACCESS_KEY;
const password = process.env.STORAGE_SECRET_KEY;
const port = Number(process.env.STORAGE_PORT ?? 8006);
if (!user || !password) process.exit(0);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local storage port");
const live = `http://127.0.0.1:${port}/minio/health/live`;
async function healthy() {
  try { return (await fetch(live, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}
if (await healthy()) process.exit(0);
const data = join(root, "tmp", "minio-data");
const config = join(root, "tmp", "minio-config");
mkdirSync(data, { recursive: true, mode: 0o700 });
mkdirSync(config, { recursive: true, mode: 0o700 });
const log = openSync(join(root, "tmp", "minio.log"), "a", 0o600);
const child = spawn("minio", ["--quiet", "--config-dir", config, "server", "--address", `127.0.0.1:${port}`, "--console-address", "127.0.0.1:8007", data], {
  detached: true,
  stdio: ["ignore", log, log],
  env: { ...process.env, MINIO_ROOT_USER: user, MINIO_ROOT_PASSWORD: password, MINIO_BROWSER: "off" },
});
let failed = false;
child.once("error", () => { failed = true; });
child.unref();
for (let attempt = 0; attempt < 40; attempt++) {
  if (await healthy()) {
    writeFileSync(join(root, "tmp", "minio.pid"), String(child.pid), { mode: 0o600 });
    process.exit(0);
  }
  if (failed || child.exitCode !== null) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
throw new Error("Could not start local storage; check tmp/minio.log and the minio installation.");
