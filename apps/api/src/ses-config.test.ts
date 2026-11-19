import { afterEach, describe, expect, it } from "vitest";
import { loadSesEmailConfig } from "./config.js";

const names = ["EMAIL_PROVIDER", "SES_REGION", "EMAIL_FROM", "SES_ACCESS_KEY", "SES_SECRET_KEY", "SES_CONFIGURATION_SET"] as const;
const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => { for (const name of names) { if (original[name] === undefined) { delete process.env[name]; } else { process.env[name] = original[name]; } } });
describe("SES configuration", () => {
  it("does not enable SES unless explicitly selected", () => { delete process.env.EMAIL_PROVIDER; expect(loadSesEmailConfig()).toBeUndefined(); });
  it("accepts the AWS credential chain and configured sender", () => { process.env.EMAIL_PROVIDER = "ses"; process.env.SES_REGION = "eu-west-1"; process.env.EMAIL_FROM = "support@example.com"; delete process.env.SES_ACCESS_KEY; delete process.env.SES_SECRET_KEY; delete process.env.SES_CONFIGURATION_SET; expect(loadSesEmailConfig()).toEqual({ region: "eu-west-1", from: "support@example.com" }); });
  it("requires both an access key and secret when either is provided", () => { process.env.EMAIL_PROVIDER = "ses"; process.env.SES_REGION = "eu-west-1"; process.env.EMAIL_FROM = "support@example.com"; process.env.SES_ACCESS_KEY = "example"; delete process.env.SES_SECRET_KEY; expect(() => loadSesEmailConfig()).toThrow(/configured together/); });
  it("rejects missing required settings", () => { process.env.EMAIL_PROVIDER = "ses"; delete process.env.SES_REGION; delete process.env.EMAIL_FROM; expect(() => loadSesEmailConfig()).toThrow(/SES_REGION and EMAIL_FROM/); });
});
