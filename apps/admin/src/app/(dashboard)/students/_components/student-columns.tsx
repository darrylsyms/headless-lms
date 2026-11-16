"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check } from "lucide-react";

import { ColumnHeader } from "@/components/data-table/column-header";
import { RowActions } from "@/components/data-table/row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { NameAvatar } from "@/components/ui/avatar";
import { fullName, relativeTime } from "@/lib/format";
import { ItemRoleBadges } from "@/components/status-badge";
import type { Student } from "@/lib/api/types";

import { ProgressCell } from "./progress-meter";

/**
 * Column set for the students list. The callbacks drive the row-action menu and
 * are absent when the viewer lacks the permission; row clicks are wired
 * separately on the table (onRowClick).
 */
export function studentColumns({
  titles,
  onView,
  onSetRole,
  onResend,
  onRemove,
  commerceOrigin,
}: {
  titles: Record<string, string>;
  onView: (id: string) => void;
  onSetRole?: (student: Student) => void;
  onResend?: (student: Student) => void;
  onRemove?: (student: Student) => void;
  commerceOrigin?: string;
}): ColumnDef<Student, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => <ColumnHeader column={column} title="Student" />,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="flex items-center gap-3">
            <NameAvatar name={fullName(s)} image={s.image} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-ink">{fullName(s)}</span>
              <span className="truncate text-xs text-ink-3">{s.email}</span>
            </div>
          </div>
        );
      },
    },
    {
      id: "items",
      accessorFn: (student) => student.items,
      meta: { label: "Roles on items" },
      header: ({ column }) => <ColumnHeader column={column} title="Roles on items" />,
      enableSorting: false,
      cell: ({ row }) => <ItemRoleBadges items={row.original.items} titles={titles} />,
    },
    {
      id: "subscribed",
      accessorFn: (student) => student.wooSubscribed,
      header: ({ column }) => <ColumnHeader column={column} title="Subscribed" />,
      enableSorting: false,
      cell: ({ row }) => row.original.wooSubscribed === true
        ? <span aria-label="Subscribed" title="Subscribed"><Check className="size-4 text-ink-2" /></span>
        : row.original.wooSubscribed === false
          ? <span aria-label="Not subscribed" title="Not subscribed">—</span>
          : <span className="text-ink-3" aria-label="Subscription status unknown" title="Subscription status unknown">?</span>,
    },
    {
      accessorKey: "entitlementCount",
      header: ({ column }) => <ColumnHeader column={column} title="Entitlements" align="right" />,
      cell: ({ row }) => <span className="text-ink-2">{row.original.entitlementCount}</span>,
      meta: { align: "right" },
    },
    {
      id: "syncStatus",
      accessorFn: (student) => student.wooSyncIssues,
      meta: { label: "Sync status" },
      header: ({ column }) => <ColumnHeader column={column} title="Sync status" />,
      enableSorting: false,
      cell: ({ row }) => row.original.wooSyncIssues?.length
        ? <span className="text-danger" title={`Synchronization will retry. Affected: ${row.original.wooSyncIssues.join(", ")}`}>Needs attention</span>
        : !row.original.wooCustomerId
          ? <span className="text-ink-3">—</span>
          : row.original.wooSyncHealth === "error"
            ? <span className="text-danger">Sync unavailable</span>
            : <span className="text-ink-3">{row.original.wooSyncHealth !== "ok" || row.original.wooSubscribed == null ? "Not checked" : "No issues"}</span>,
    },
    {
      accessorKey: "avgProgress",
      header: ({ column }) => <ColumnHeader column={column} title="Avg. progress" align="right" />,
      cell: ({ row }) => <ProgressCell value={row.original.avgProgress} />,
      meta: { align: "right" },
    },
    {
      accessorKey: "joinedAt",
      header: ({ column }) => <ColumnHeader column={column} title="Joined" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-ink-3">{relativeTime(row.original.joinedAt)}</span>
      ),
    },
    {
      accessorKey: "lastActiveAt",
      header: ({ column }) => <ColumnHeader column={column} title="Last active" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-ink-3">
          {relativeTime(row.original.lastActiveAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions>
            <DropdownMenuItem onClick={() => onView(row.original.id)}>
              View student
            </DropdownMenuItem>
            {commerceOrigin && row.original.wooCustomerId ? (
              <>
                <DropdownMenuItem asChild>
                  <a href={`${commerceOrigin}/wp-admin/user-edit.php?user_id=${row.original.wooCustomerId}`} target="_blank" rel="noopener noreferrer">Edit customer</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`${commerceOrigin}/wp-admin/admin.php?page=wc-orders&_customer_user=${row.original.wooCustomerId}`} target="_blank" rel="noopener noreferrer">View orders</a>
                </DropdownMenuItem>
              </>
            ) : commerceOrigin ? (
              <>
                <DropdownMenuItem disabled title="No verified WooCommerce customer linked">Edit customer</DropdownMenuItem>
                <DropdownMenuItem disabled title="No verified WooCommerce customer linked">View orders</DropdownMenuItem>
              </>
            ) : null}
            {onSetRole ? (
              <DropdownMenuItem onClick={() => onSetRole(row.original)}>Set role</DropdownMenuItem>
            ) : null}
            {onResend && row.original.status === "invited" ? (
              <DropdownMenuItem onClick={() => onResend(row.original)}>
                Resend invite
              </DropdownMenuItem>
            ) : null}
            {onRemove ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onClick={() => onRemove(row.original)}>
                  Remove from org
                </DropdownMenuItem>
              </>
            ) : null}
          </RowActions>
        </div>
      ),
      meta: { align: "right" },
    },
  ];
}
