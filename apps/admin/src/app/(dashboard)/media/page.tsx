import { serverApi } from "@/lib/api/server";
import { requirePermission } from "@/lib/auth/server-permissions";
import { parseListParams } from "@/lib/table/parse-list-params";

import { MediaView } from "./media-view";
import { listMediaFoldersAction } from "./actions";

// Media library page: reads URL params, fetches server-side, renders the media view.
export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("media:read");
  const sp = await searchParams;
  const params = parseListParams(sp, { pageSize: 24 });

  const [{ rows, total }, folders] = await Promise.all([serverApi.listAssets(params), listMediaFoldersAction()]);

  return <MediaView rows={rows} total={total} params={params} folders={folders} />;
}
