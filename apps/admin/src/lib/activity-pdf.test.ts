import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActivityPdf } from "./activity-pdf";

let server: Server;
let imageRequests: string[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url?.startsWith("/api/activity-export/")) {
      imageRequests.push(req.url);
      res.setHeader("content-type", "image/png");
      return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXkAAAAASUVORK5CYII=", "base64"));
    }
    try { const name = (req.url || "").split("/").pop() || ""; res.end(await readFile(new URL(`../../public/fonts/noto-sans/${name}`, import.meta.url))); } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No server address");
  Object.assign(globalThis, { window: { location: { origin: `http://127.0.0.1:${addr.port}` } } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => originalFetch(typeof input === "string" && input.startsWith("/") ? `${window.location.origin}${input}` : input, init)) as typeof fetch;
  Object.assign(globalThis, { FileReader: class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((data) => { this.result = `data:${blob.type};base64,${Buffer.from(data).toString("base64")}`; this.onload?.(); }).catch(() => this.onerror?.()); }
  } });
});
afterAll(() => server?.close());
it("generates a multipage PDF containing formatted lesson content without videos", async () => {
  const nodes = [
    { type: "h1", children: [{ text: "First heading" }] },
    { type: "p", children: [{ text: "Text after first heading." }] },
    { type: "h2", children: [{ text: "Intervals" }] },
    { type: "p", children: [{ text: "Minor ", bold: true }, { text: "♭3 and ♯4" }] },
    { type: "h3", children: [{ text: "Third heading" }] },
    { type: "p", children: [{ text: "Text after third heading." }] },
    { type: "table", children: [{ type: "tr", children: [{ type: "th", children: [{ type: "p", children: [{ text: "Simple" }] }] }, { type: "th", children: [{ type: "p", children: [{ text: "Compound" }] }] }] }] },
    { type: "video", url: "https://vimeo.com/123456", children: [{ text: "" }] },
    { type: "file", name: "secret-filename.zip", children: [{ text: "" }] },
    { type: "img", assetId: "ast_Test", children: [{ text: "" }] },
    ...Array.from({ length: 80 }, (_, i) => ({ type: "p", children: [{ text: `Lesson paragraph ${i}` }] })),
  ];
  const { blob, missingImages } = await createActivityPdf("Practice example", nodes, {}, "act_Test");
  const output = join(tmpdir(), "fretwise-pdf-test.pdf");
  await writeFile(output, new Uint8Array(await blob.arrayBuffer()));
  const bytes = Buffer.from(await blob.arrayBuffer());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect((bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length).toBeGreaterThan(1);
  expect(bytes.toString("latin1")).toContain("/Subtype /Image");
  expect(missingImages).toBe(0);
  expect(imageRequests).toContain("/api/activity-export/act_Test/images/ast_Test");
}, 30000);
