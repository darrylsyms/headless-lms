import { createServer } from "node:http";
import { localReturnDestination, localStudentReturnDestination } from "../db/staging-browser-return.js";

const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.headers.host !== "localhost:8017" || req.method !== "GET") {return res.writeHead(404).end();}
  const url = new URL(req.url ?? "/", "http://localhost:8017");
  if (url.pathname === "/callback") {
    return res.writeHead(302, { Location: `http://localhost:8000/api/auth/callback/fretwise-wordpress-staging${url.search}` }).end();
  }
  if (url.pathname !== "/start" || url.searchParams.getAll("returnTo").length > 1 || url.searchParams.getAll("target").length > 1) {return res.writeHead(404).end();}
  try {
    const target = url.searchParams.get("target");
    if (target && target !== "student") {throw new Error("Invalid sign-in target.");}
    const callbackURL = target === "student" ? localStudentReturnDestination(url.searchParams.get("returnTo")) : localReturnDestination(url.searchParams.get("returnTo"));
    const response = await fetch("http://localhost:8000/api/auth/sign-in/social", {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", origin: "http://localhost:8000" },
      body: JSON.stringify({ provider: "fretwise-wordpress-staging", callbackURL }),
    });
    const result = await response.json() as { url?: string };
    if (!response.ok || !result.url?.startsWith("https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc/oauth/authorize?"))
      {throw new Error("Unable to start staging sign-in.");}
    res.setHeader("Set-Cookie", response.headers.getSetCookie());
    return res.writeHead(302, { Location: result.url }).end();
  } catch {
    return res.writeHead(503).end("Sign-in is temporarily unavailable. Please try again.");
  }
});
server.listen(8017, "127.0.0.1", () => process.stdout.write("Staging callback relay ready on localhost:8017.\n"));
