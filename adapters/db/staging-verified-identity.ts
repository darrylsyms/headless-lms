import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { stagingTestCustomer } from "./staging-test-customer.js";

const authRequire = createRequire(new URL("../auth/package.json", import.meta.url));
const josePath = createRequire(authRequire.resolve("better-auth")).resolve("jose");
const { jwtVerify } = await import(pathToFileURL(josePath).href);
const issuer = "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc";

export async function verifyStagingIdentity(token: string, key: Parameters<typeof jwtVerify>[1], clientId: string, nonce: string) {
  if (!clientId || !nonce) {throw new Error("Staging identity verification is not configured.");}
  const { payload } = await jwtVerify(token, key, {
    issuer, audience: clientId, algorithms: ["RS256"], maxTokenAge: "5m",
    requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
  });
  if (payload.nonce !== nonce || payload.aud !== clientId ||
      typeof payload.sub !== "string" || !stagingTestCustomer(payload.sub))
    {throw new Error("Unexpected staging customer identity.");}
  return {
    issuer,
    subject: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
  };
}
