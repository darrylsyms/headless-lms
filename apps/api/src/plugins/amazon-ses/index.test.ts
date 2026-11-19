import { describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@headless-lms/adapter-email-ses", () => ({ SesEmailAdapter: class { send = send; } }));
import ses from "./index.js";

describe("SES support delivery", () => {
  it("uses the configured support inbox and the member's reply address", async () => {
    const action = ses.actions.find(item => item.id === "sendSupportRequest")!;
    await action.invoke({ config: { region: "eu-west-1", from: "sender@example.com", supportEmail: "help@example.com" }, secrets: { accessKeyId: "key", secretAccessKey: "secret" } }, { message: "Help", username: "player", name: "Alex Guitar", email: "member@example.com" });
    expect(send).toHaveBeenCalledWith({ to: "help@example.com", replyTo: "member@example.com", subject: "Help request", text: "Help\n---\nUsername: player\nUser name: Alex Guitar" });
  });
});

describe("SES notification delivery", () => {
  it("sends a rendered notification to its member recipient", async () => {
    const action = ses.actions.find(item => item.id === "sendNotificationEmail")!;
    await action.invoke({ config: { region: "eu-west-1", from: "sender@example.com", supportEmail: "help@example.com" }, secrets: { accessKeyId: "key", secretAccessKey: "secret" } }, { to: "member@example.com", subject: "New reply", text: "Hello", html: "<p>Hello</p>" });
    expect(send).toHaveBeenCalledWith({ to: "member@example.com", subject: "New reply", text: "Hello", html: "<p>Hello</p>" });
  });
});
