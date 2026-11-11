import { authHeaders, API_URL } from "@/lib/api/server-call";

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string; assetId: string }> }) {
  const { activityId, assetId } = await params;
  if (!/^act_[A-Za-z0-9]+$/.test(activityId) || !/^ast_[A-Za-z0-9]+$/.test(assetId)) return new Response(null, { status: 400 });
  const { headers } = await authHeaders();
  const url = `${API_URL}/api/member/activities/${activityId}/assets/${assetId}`;
  const response = await fetch(url, { headers, redirect: "manual", cache: "no-store" });
  let image = response;
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return new Response(null, { status: 502 });
    const target = new URL(location, API_URL);
    if (target.protocol !== "https:" && target.protocol !== "http:") return new Response(null, { status: 502 });
    image = await fetch(target, { cache: "no-store", redirect: "error" });
  }
  if (!image.ok || !image.headers.get("content-type")?.startsWith("image/")) return new Response(null, { status: image.ok ? 415 : image.status });
  return new Response(image.body, { headers: { "content-type": image.headers.get("content-type")!, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
