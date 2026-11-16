import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["adapters/db/product-course-mappings.postgres.test.ts"] } });
