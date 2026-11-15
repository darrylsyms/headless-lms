import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createContainer } from '../packages/server/dist/index.js';
import { loadServerConfig } from '../apps/api/src/config.js';
import { readStagingPurchases } from '../../fretwise-lms-frontend/lib/server/staging-woo-reader.js';
import { runStagingAccessTest, STAGING_TEST_TARGET } from '../../fretwise-lms-frontend/lib/server/staging-test-bridge.js';

const db = new URL(process.env.DATABASE_URL ?? '');
if (db.hostname !== '127.0.0.1' || db.port !== '8005' || db.pathname !== '/fretwise_lms') {
  throw new Error('This test only runs against the local Fretwise LMS database.');
}
const config = loadServerConfig();
const c = await createContainer(config);
const { orgId, studentId, courseId } = STAGING_TEST_TARGET;
const actor = c.organizations.systemActor(orgId);
const token = randomBytes(24).toString('hex');
const path = `/${token}`;
let used = false;

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== '127.0.0.1:8015' || req.url !== path) {return res.writeHead(404).end();}
  if (req.method === 'GET' && !used) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<h1>Temporary staging access test</h1><p>Reads the disposable staging customer and temporarily checks one local LMS grant.</p><form method="post"><label>Read-only key <input type="password" name="key" required></label><label>Read-only secret <input type="password" name="secret" required></label><button>Run test</button></form>');
  }
  if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:8015' || used) {return res.writeHead(403).end();}
  used = true;
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) {throw new Error('Request too large.');}
    }
    const form = new URLSearchParams(body);
    const snapshot = await readStagingPurchases({ key: form.get('key') ?? '', secret: form.get('secret') ?? '' });
    const result = await runStagingAccessTest(snapshot, {
      existingGrant: async () => {
        const page = await c.entitlements.list({ page: 1, pageSize: 10, orgUserId: studentId, contentId: courseId }, actor);
        if (page.total > 1) {throw new Error('Unexpected duplicate LMS grants.');}
        return page.rows[0] ?? null;
      },
      hasAccess: () => c.entitlements.hasAccess(orgId, studentId, courseId),
      grant: () => c.entitlements.grant({ orgUserId: studentId, contentId: courseId, expiresAt: null }, actor),
      revoke: async () => { await c.entitlements.revoke({ orgUserId: studentId, contentId: courseId }, actor); },
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(result === 'passed' ? 'PASS: staging purchase connected to the disposable local student; test access was removed.' : 'HELD: test did not change access; evidence or existing access needs review.');
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Test failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    server.close(() => process.exit());
  }
});

server.listen(8015, '127.0.0.1', () => console.log(`Temporary test: http://127.0.0.1:8015${path}`));
