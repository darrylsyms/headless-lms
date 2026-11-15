import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || url.port !== "8005" || url.pathname !== "/fretwise_lms")
  {throw new Error("The local test database is required.");}
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const path = `/${randomBytes(24).toString("hex")}`;
let used = false;

async function revision() {
  const row = await pool.query(
    "select revision from purchase_sync_ledgers where org_id = $1 and org_user_id = $2 and integration_id = $3",
    [
      "org_3LudhlwZcnDDRGwc8R0NGHc2jdu",
      "orm_3M1piONtzjSRhD10QdWPIYYEcYz",
      "woocommerce-local-test",
    ],
  );
  return row.rows[0]?.revision ?? 0;
}

async function runWorker(credentials: { key: string; secret: string }) {
  if (!credentials.key || !credentials.secret) {throw new Error("Missing test credentials.");}
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "./adapters/db/node_modules/.bin/tsx",
      ["--env-file=.env", "adapters/db/staging-sync-worker.ts"],
      {
        env: {
          ...process.env,
          FRETWISE_STAGING_WOO_KEY: credentials.key,
          FRETWISE_STAGING_WOO_SECRET: credentials.secret,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let passed = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Worker timed out."));
    }, 45000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (data.includes("Staging synchronization checked.")) {
        passed = true;
        child.kill("SIGINT");
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (passed && code === 0) {resolve();}
      else {reject(new Error("Worker failed."));}
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.host !== "127.0.0.1:8015" || req.url !== path) {return res.writeHead(404).end();}
  if (req.method === "GET" && !used) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(
      '<h1>Temporary staging worker test</h1><p>Runs the staged worker twice for the disposable mapping, then stops it.</p><form method="post"><label>Read-only key <input type="password" name="key" required></label><label>Read-only secret <input type="password" name="secret" required></label><button>Run test</button></form>',
    );
  }
  if (req.method !== "POST" || req.headers.origin !== "http://127.0.0.1:8015" || used)
    {return res.writeHead(403).end();}
  used = true;
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) {throw new Error("Request too large.");}
    }
    const form = new URLSearchParams(body);
    const credentials = { key: form.get("key") ?? "", secret: form.get("secret") ?? "" };
    const before = await revision();
    await runWorker(credentials);
    const middle = await revision();
    await runWorker(credentials);
    const after = await revision();
    if (middle !== before + 1 || after !== middle + 1)
      {throw new Error("Unexpected ledger revisions.");}
    res.end(
      "PASS: the real staging worker ran, stopped and restarted; the local ledger persisted.",
    );
  } catch {
    res.writeHead(500).end("Test failed; check the local worker and mapping.");
  } finally {
    server.close();
    await pool.end();
  }
});
server.listen(8015, "127.0.0.1", () =>
  process.stdout.write(`Temporary test: http://127.0.0.1:8015${path}\n`),
);
