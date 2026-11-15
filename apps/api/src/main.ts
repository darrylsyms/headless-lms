// Process entry point: env → config → container → server → listen → pubsub → relay.
import { fileURLToPath } from "node:url";
import { buildServer, closeOnSignals, createContainer } from "@headless-lms/server";
import { MarkdownBodyParser } from "@headless-lms/adapter-body-markdown";
import { ResendEmailAdapter } from "@headless-lms/adapter-email-resend";
import { MinioStorageAdapter } from "@headless-lms/adapter-storage-minio";
import { HatchetAutomationEngine } from "@headless-lms/adapter-workflow-hatchet";
import { ReactEmailTemplateRenderer } from "@headless-lms/adapter-email-templates";
import { PushAdapter } from "@headless-lms/adapter-push";
import { PostgresPubSub } from "@headless-lms/adapter-pubsub-postgres";
import { FileSinkEmailAdapter } from "@headless-lms/adapter-defaults/email";
import {
  loadEmailConfig,
  loadEmailSinkDir,
  loadPushConfig,
  loadServerConfig,
  loadStorageConfig,
} from "./config.js";

const config = loadServerConfig();
if (process.env.FRETWISE_STAGING_WORDPRESS_SSO === "1") {
  config.container.trustedOrigins = [...new Set([...config.container.trustedOrigins, "http://localhost:3020"])];
}
const emailConfig = loadEmailConfig();
const emailSinkDir = loadEmailSinkDir();
const pushConfig = loadPushConfig();
const container = await createContainer(config, {
  ...(process.env.FRETWISE_STAGING_WORDPRESS_SSO === "1" ? {
    externalIdentity: async (db) => (await import("../../../adapters/db/staging-wordpress.js")).stagingWordPressIdentity(db),
  } : {}),
  pluginsDir: fileURLToPath(new URL("./plugins/", import.meta.url)),
  adapters: {
    email: emailSinkDir
      ? new FileSinkEmailAdapter(emailSinkDir)
      : emailConfig && new ResendEmailAdapter(emailConfig),
    storage: new MinioStorageAdapter(loadStorageConfig()),
    templates: new ReactEmailTemplateRenderer(),
    workflows: process.env.HATCHET_CLIENT_TOKEN
      ? (logger) => new HatchetAutomationEngine(undefined, logger)
      : undefined,
    push: pushConfig,
    pushSender: new PushAdapter(pushConfig),
    pubsub: (logger) => new PostgresPubSub({ connectionString: config.pubsubDatabaseUrl, logger }),
    bodyParser: new MarkdownBodyParser(),
  },
});
const app = await buildServer(config, container);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
closeOnSignals(app);

await container.pubsub?.start();
await container.chatHub?.start();
container.outboxRelay.start();
container.organizations.auditRoleKeys().catch((err) => {
  container.logger.error("role key audit failed", {
    err: err instanceof Error ? err : new Error(String(err)),
  });
});
container.automationEngine.start().catch((err) => {
  container.logger.error("automation engine failed to start", {
    err: err instanceof Error ? err : new Error(String(err)),
  });
});
