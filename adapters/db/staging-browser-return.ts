const localOrigin = "http://localhost:3020";
const allowedPaths = ["/dashboard", "/courses", "/songs", "/insider", "/my-list", "/community", "/practice-lab"];
const invalidCharacters = (input: string) => [...input].some((char) => char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function localReturnDestination(input: string | null): string {
  if (!input) {return `${localOrigin}/dashboard`;}
  if (!input.startsWith("/") || input.startsWith("//") || invalidCharacters(input))
    {throw new Error("Invalid local return destination.");}
  const url = new URL(input, localOrigin);
  if (url.origin !== localOrigin || url.hash ||
      !allowedPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)))
    {throw new Error("Invalid local return destination.");}
  return url.href;
}

export function localStudentReturnDestination(input: string | null): string {
  const origin = "http://localhost:8002";
  if (!input) {return `${origin}/`;}
  if (!input.startsWith("/") || input.startsWith("//") || invalidCharacters(input))
    {throw new Error("Invalid local return destination.");}
  const url = new URL(input, origin);
  const paths = ["/courses", "/insider", "/community", "/downloads"];
  if (url.origin !== origin || url.hash || !(url.pathname === "/" || paths.some(path => url.pathname === path || url.pathname.startsWith(`${path}/`))))
    {throw new Error("Invalid local return destination.");}
  return url.href;
}
