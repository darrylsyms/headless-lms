import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { verifyStagingIdentity } from "./staging-verified-identity.js";

const authRequire = createRequire(new URL("../auth/package.json", import.meta.url));
const josePath = createRequire(authRequire.resolve("better-auth")).resolve("jose");
const { generateKeyPair, SignJWT } = await import(pathToFileURL(josePath).href);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";
const client = "local-test-client";
const nonce = "test-nonce";
const now = Math.floor(Date.now() / 1000);
async function token(overrides: Record<string, unknown> = {}, key = privateKey) {
  return new SignJWT({ iss: issuer, sub: "23003227", aud: client, nonce, iat: now, exp: now + 60, ...overrides })
    .setProtectedHeader({ alg: "RS256" }).sign(key);
}
assert.deepEqual(await verifyStagingIdentity(await token(), publicKey, client, nonce), { issuer, subject: "23003227" });
assert.deepEqual(await verifyStagingIdentity(await token({ sub: "23003226", email: "new@example.test", name: "Test customer", email_verified: true }), publicKey, client, nonce), {
  issuer, subject: "23003226", email: "new@example.test", name: "Test customer",
});
for (const bad of [
  await token({}, other.privateKey),
  await token({ iss: "https://other.example" }),
  await token({ aud: "other-client" }),
  await token({ aud: [client, "other-client"] }),
  await token({ nonce: "other-nonce" }),
  await token({ sub: "23003228" }),
  await token({ exp: now - 1 }),
  await token({ iat: now - 301 }),
]) {await assert.rejects(verifyStagingIdentity(bad, publicKey, client, nonce));}
await assert.rejects(verifyStagingIdentity(await token(), publicKey, client, ""));
process.env.FRETWISE_STAGING_NEW_CUSTOMER_ID = "12345678";
process.env.FRETWISE_STAGING_NEW_CUSTOMER_EMAIL = "new-checkout@example.test";
assert.equal((await verifyStagingIdentity(await token({ sub: "12345678" }), publicKey, client, nonce)).subject, "12345678");
process.env.FRETWISE_STAGING_NEW_CUSTOMER_EMAIL = "customer@example.com";
await assert.rejects(verifyStagingIdentity(await token({ sub: "12345678" }), publicKey, client, nonce));
delete process.env.FRETWISE_STAGING_NEW_CUSTOMER_ID;
delete process.env.FRETWISE_STAGING_NEW_CUSTOMER_EMAIL;
process.stdout.write("PASS: staging identity verification rejects invalid signatures and claims.\n");
