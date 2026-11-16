import { requirePermission } from "@/lib/auth/server-permissions";
import { serverApi } from "@/lib/api/server";
import { parseListParams } from "@/lib/table/parse-list-params";

import { StudentsTable } from "./students-table";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { permissions } = await requirePermission("people:read");
  const sp = await searchParams;
  const params = parseListParams(sp, {
    pageSize: 10,
    initialSort: [{ id: "lastActiveAt", desc: true }],
  });

  const [{ rows, total }, roles, titles] = await Promise.all([
    serverApi.listStudents(params),
    permissions.has("roles:read") ? serverApi.listRoles() : Promise.resolve([]),
    serverApi.contentTitles(permissions),
  ]);

  const commerceOrigin = process.env.NODE_ENV === "production" ? undefined : "https://getfretwise-cydd.1wp.site";
  return <StudentsTable rows={rows} total={total} params={params} roles={roles} titles={titles} commerceOrigin={commerceOrigin} />;
}
