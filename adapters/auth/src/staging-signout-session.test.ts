import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BetterAuth, type Auth } from "./better-auth.js";
import type { CreateAuthOptions } from "./types.js";

const oldFlag = process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT;
afterEach(() => { if (oldFlag === undefined) delete process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT; else process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = oldFlag; });

describe("staging sign-out session binding", () => {
  it("binds to the server-verified current session, never returning session credentials", async () => {
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = "1";
    let sessionId = "session-a";
    const getSession = vi.fn(async () => ({ user: { id: "user-a" }, session: { id: sessionId, token: "do-not-return" } }));
    const auth = new BetterAuth({ baseUrl: "http://localhost:8100", db: {}, logger: {}, mcp: {} } as CreateAuthOptions, { api: { getSession } } as unknown as Auth);
    const key = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url");
    const first = await auth.stagingSignoutSessionBinding({ cookie: "example=1" }, browser, key);
    expect(first).toEqual({ userId: "user-a", binding: expect.any(String) });
    expect(JSON.stringify(first)).not.toContain(sessionId);
    expect(JSON.stringify(first)).not.toContain("do-not-return");
    expect(getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
    sessionId = "session-b";
    expect((await auth.stagingSignoutSessionBinding({ cookie: "example=1" }, browser, key))?.binding).not.toEqual(first?.binding);
    expect((await auth.stagingSignoutSessionBinding({ cookie: "example=1" }, randomBytes(32).toString("base64url"), key))?.binding).not.toEqual(first?.binding);
    getSession.mockResolvedValueOnce(null as never);
    expect(await auth.stagingSignoutSessionBinding({}, browser, key)).toBeNull();
    expect(await auth.stagingSignoutSessionBinding({}, "invalid", key)).toBeNull();
    process.env.FRETWISE_STAGING_GLOBAL_SIGNOUT = "0";
    expect(await auth.stagingSignoutSessionBinding({}, browser, key)).toBeNull();
  });
});
