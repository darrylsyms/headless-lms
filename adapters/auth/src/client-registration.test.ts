import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { getSchema } from "better-auth/db";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildAuthOptions } from "./better-auth.js";
import { withLoopbackNativeDefault } from "./client-registration.js";
import type { CreateAuthOptions } from "./types.js";

describe("withLoopbackNativeDefault", () => {
  it("marks a registration with a loopback http redirect as native", () => {
    expect(
      withLoopbackNativeDefault({ redirect_uris: ["http://localhost:9999/callback"] }),
    ).toEqual({ redirect_uris: ["http://localhost:9999/callback"], application_type: "native" });
    expect(
      withLoopbackNativeDefault({
        redirect_uris: ["http://127.0.0.1:33418", "https://vscode.dev/redirect"],
      })?.application_type,
    ).toBe("native");
  });
  it("leaves https-only, explicit and malformed registrations alone", () => {
    expect(withLoopbackNativeDefault({ redirect_uris: ["https://claude.ai/cb"] })).toBeNull();
    expect(
      withLoopbackNativeDefault({
        redirect_uris: ["http://localhost:9999/callback"],
        application_type: "web",
      }),
    ).toBeNull();
    expect(withLoopbackNativeDefault({ redirect_uris: [] })).toBeNull();
    expect(withLoopbackNativeDefault(undefined)).toBeNull();
  });
});

const noop = async () => undefined;
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

function authOptions(externalIdentity?: CreateAuthOptions["externalIdentity"]) {
  return buildAuthOptions({
    db: {} as NodePgDatabase,
    baseUrl: "http://localhost:8100",
    secret: "a".repeat(32),
    trustedOrigins: [],
    logger: logger as unknown as CreateAuthOptions["logger"],
    externalIdentity,
    hooks: { beforeUserCreate: noop } as unknown as CreateAuthOptions["hooks"],
    mcp: {
      oauthEnabled: true,
      resource: "http://localhost:8100/mcp",
      loginPage: "http://localhost:8101/login",
      consentPage: "http://localhost:8101/oauth/consent",
      orgPickerPage: "http://localhost:8101/onboarding/select-organization",
    },
  });
}

function memoryAuth() {
  const options = authOptions();
  const tables = Object.fromEntries(Object.keys(getSchema(options)).map((model) => [model, []]));
  return betterAuth({ ...options, database: memoryAdapter(tables), telemetry: { enabled: false } });
}

describe("external sign-in configuration", () => {
  it("is disabled by default and requires verified, prelinked identities when enabled", () => {
    const unconfigured = authOptions();
    expect(unconfigured.plugins.some((plugin) => plugin.id === "generic-oauth")).toBe(false);
    const options = authOptions({
      providerId: "test-provider", clientId: "test-client", clientSecret: "test-secret",
      discoveryUrl: "https://identity.example.test/.well-known/openid-configuration",
      redirectURI: "http://localhost:8100/api/auth/callback/test-provider",
      scopes: ["openid"], getUserInfo: async () => null,
    });
    expect(options.account?.accountLinking).toEqual({ enabled: false, disableImplicitLinking: true });
    const plugin = options.plugins.find((item) => item.id === "generic-oauth");
    expect(plugin).toBeDefined();
    const settings = (plugin as { options?: { config: Record<string, unknown>[] } }).options?.config[0];
    expect(settings).toMatchObject({ requireIdTokenVerification: true, pkce: true, disableSignUp: true, disableProviderLogout: true });
  });
});

async function register(body: Record<string, unknown>) {
  const res = await memoryAuth().handler(
    new Request("http://localhost:8100/api/auth/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("dynamic client registration", () => {
  it("registers a public MCP client whose redirect is a loopback http URI", async () => {
    const res = await register({
      redirect_uris: ["http://localhost:9999/callback"],
      token_endpoint_auth_method: "none",
    });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toEqual(expect.any(String));
    expect(res.body.application_type).toBe("native");
  });
  it("still rejects a loopback http redirect for a declared web client", async () => {
    const res = await register({
      redirect_uris: ["http://localhost:9999/callback"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_redirect_uri");
  });
  it("still rejects a non-loopback http redirect", async () => {
    const res = await register({
      redirect_uris: ["http://evil.example/callback"],
      token_endpoint_auth_method: "none",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_redirect_uri");
  });
});
