import { z } from "zod";
import type { Integration } from "@headless-lms/core/types";
import { zodAction, zodConfig, zodSecrets } from "@headless-lms/core/integrations";
import { SesEmailAdapter } from "@headless-lms/adapter-email-ses";

export const sesConfig = z.object({
  region: z.string().trim().min(1).max(64).describe("AWS region for your SES sending identity, such as eu-west-1."),
  from: z.email().describe("Verified Fretwise email address used to send messages."),
  supportEmail: z.email().describe("Email address that receives Get Help requests."),
  configurationSetName: z.string().trim().max(64).optional().describe("Optional SES configuration set."),
}).strict();
export const sesSecrets = z.object({
  accessKeyId: z.string().min(1).describe("AWS access key ID for an identity permitted to send with SES."),
  secretAccessKey: z.string().min(1).describe("AWS secret access key. It is encrypted and not shown again."),
}).strict();

const sendSupportRequest = zodAction({
  id: "sendSupportRequest",
  description: "Send a member's help request to the configured support inbox.",
  input: z.object({ message: z.string().trim().min(1).max(5000), username: z.string().min(1).max(255), name: z.string().max(510), email: z.email() }).strict(),
  output: z.object({ accepted: z.literal(true) }),
  async run(ctx, input) {
    const config = sesConfig.parse(ctx.config);
    const secrets = sesSecrets.parse(ctx.secrets);
    const singleLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
    const sender = new SesEmailAdapter({ region: config.region, from: config.from, ...secrets, ...(config.configurationSetName ? { configurationSetName: config.configurationSetName } : {}) });
    await sender.send({ to: config.supportEmail, replyTo: input.email, subject: "Help request", text: `${input.message}\n---\nUsername: ${singleLine(input.username)}\nUser name: ${singleLine(input.name) || "Not available"}` });
    return { accepted: true as const };
  },
});
const sendNotificationEmail = zodAction({
  id: "sendNotificationEmail",
  description: "Deliver an LMS email using the configured SES sender.",
  input: z.object({ to: z.email(), subject: z.string().min(1).max(998), text: z.string(), html: z.string().optional() }).strict(),
  output: z.object({ accepted: z.literal(true) }),
  async run(ctx, input) {
    const config = sesConfig.parse(ctx.config);
    const secrets = sesSecrets.parse(ctx.secrets);
    const sender = new SesEmailAdapter({ region: config.region, from: config.from, ...secrets, ...(config.configurationSetName ? { configurationSetName: config.configurationSetName } : {}) });
    await sender.send(input);
    return { accepted: true as const };
  },
});
const integration: Integration = { id: "amazon-ses", ...zodConfig(sesConfig), ...zodSecrets(sesSecrets), actions: [sendSupportRequest, sendNotificationEmail] };
export default integration;
