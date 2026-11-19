"use client";

/**
 * Library picker: browse the media library and choose one asset.
 *
 * Unlike the media page — which is server-rendered off URL params — this runs
 * entirely client-side (the editor is a client surface and must not navigate),
 * so it fetches through `listAssetsAction` and keeps its own search/page state.
 * The grid is the same `AssetCard`, in select mode.
 */

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import type { Asset, AssetKind } from "@/lib/api/types";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/data-table/pagination";
import { AssetCard } from "./asset-card";
import { listAssetsAction, listMediaFoldersAction, type MediaFolder } from "../actions";
import { usePermissions } from "@/lib/auth/permissions-context";
import { FolderTree } from "./folder-tree";

// Must be one of the page sizes `Pagination` offers, or its Rows select renders blank.
const PAGE_SIZE = 20;

const KIND_LABEL: Record<AssetKind, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "file",
};

export function AssetPickerDialog({
  open,
  kind,
  onOpenChange,
  onSelect,
  contentId,
}: {
  open: boolean;
  kind: AssetKind;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Asset) => void;
  contentId?: string;
}) {
  const canBrowseFolders = usePermissions().has("media:read");
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [folderError, setFolderError] = useState(false);
  const [folderId, setFolderId] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [opening, setOpening] = useState({ open, kind, count: 0 });
  const [result, setResult] = useState<{
    key: string;
    rows: Asset[];
    total: number;
    error: string | null;
  } | null>(null);

  // Reset per opening: a picker that remembers the last search is a picker
  // that looks empty when you open it for a different kind of media.
  if (opening.open !== open || opening.kind !== kind) {
    setOpening({ open, kind, count: open ? opening.count + 1 : opening.count });
    if (open) {
      setFolderId("all");
      setSearch("");
      setDebounced("");
      setPage(1);
    }
  }

  const requestKey = JSON.stringify([opening.count, kind, contentId ?? null, folderId, debounced, page, pageSize]);
  const currentResult = search === debounced && result?.key === requestKey ? result : null;
  const loading = open && !currentResult;
  const rows = currentResult?.rows ?? [];
  const total = currentResult?.total ?? 0;
  const error = currentResult?.error ?? null;

  useEffect(() => {
    if (!open || !canBrowseFolders) return;
    let cancelled = false;
    void listMediaFoldersAction().then(value => { if (!cancelled) { setFolders(value); setFolderError(false); } }).catch(() => { if (!cancelled) { setFolders([]); setFolderError(true); } });
    return () => { cancelled = true; };
  }, [open, canBrowseFolders]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void listAssetsAction(
      {
        page,
        pageSize,
        search: debounced || undefined,
        filters: { kind: [kind], ...(folderId === "all" ? {} : { folderId: [folderId] }) },
      },
      contentId,
    )
      .then((res) => {
        if (cancelled) return;
        setResult({ key: requestKey, rows: res.rows, total: res.total, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          rows: [],
          total: 0,
          error: e instanceof Error ? e.message : "Couldn't load the media library",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, kind, debounced, page, pageSize, requestKey, contentId, folderId]);

  const noun = KIND_LABEL[kind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose from library</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            aria-label="Search media"
            className="pl-9"
          />
        </div>

        <div className="flex min-h-[18rem] gap-4">
          {canBrowseFolders && <div className="w-40 shrink-0 overflow-y-auto"><FolderTree folders={folders} selected={folderId} onSelect={id => { setFolderId(id); setPage(1); }} />{folderError && <p role="alert" className="text-xs text-danger">Couldn&apos;t load folders. Reopen the picker to try again.</p>}</div>}
          <div className="min-w-0 flex-1">
          {loading && rows.length === 0 ? (
            <div className="grid h-72 place-items-center text-ink-4">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="grid h-72 place-items-center px-6 text-center text-sm text-danger">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="grid h-72 place-items-center px-6 text-center text-sm text-ink-3">
              {debounced
                ? "No matching media. Try a different search."
                : folderId !== "all" ? `No ${noun}s in this folder.` : `No ${noun}s in the library yet. Upload one from the Upload tab.`}
            </p>
          ) : (
            <div className="grid max-h-[26rem] grid-cols-2 gap-x-4 gap-y-5 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
              {rows.map((asset) => (
                <AssetCard key={asset.id} asset={asset} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>

        </div>
        {total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            isFetching={loading}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
