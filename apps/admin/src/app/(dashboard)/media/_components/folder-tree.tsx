"use client";

import { useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaFolder } from "../actions";

export function FolderTree({
  folders,
  selected,
  onSelect,
  onDrop,
}: {
  folders: MediaFolder[];
  selected: string;
  onSelect: (id: string) => void;
  onDrop?: (event: DragEvent, destination: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  function entry(id: string, label: string, destination: string | null, depth = 0) {
    return (
      <button
        type="button"
        aria-current={selected === id ? "true" : undefined}
        onClick={() => onSelect(id)}
        onDragOver={
          onDrop && id !== "all"
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
              }
            : undefined
        }
        onDrop={
          onDrop && id !== "all"
            ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop(e, destination);
              }
            : undefined
        }
        className={cn(
          "flex min-h-9 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-ink-3 hover:bg-surface-2",
          selected === id && "bg-surface-2 font-medium text-ink",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {id === "all" ? (
          <FolderOpen className="size-4 shrink-0" />
        ) : (
          <Folder className="size-4 shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </button>
    );
  }
  function children(parent: string | null, depth: number): React.ReactNode {
    return folders
      .filter((f) => f.parentId === parent)
      .map((f) => {
        const hasChildren = folders.some((c) => c.parentId === f.id);
        return (
          <div
            key={f.id}
            draggable={!!onDrop}
            onDragStart={
              onDrop
                ? (e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData("application/x-fretwise-folder", f.id);
                  }
                : undefined
            }
          >
            <div className="relative">
              {hasChildren && (
                <button
                  type="button"
                  aria-label={`${collapsed.has(f.id) ? "Expand" : "Collapse"} ${f.name}`}
                  aria-expanded={!collapsed.has(f.id)}
                  className="absolute left-0 top-2 z-10"
                  style={{ left: `${depth * 16}px` }}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(f.id) ? (
                    <ChevronRight className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </button>
              )}
              {entry(f.id, f.name, f.id, depth + 1)}
            </div>
            {!collapsed.has(f.id) && children(f.id, depth + 1)}
          </div>
        );
      });
  }
  return (
    <nav aria-label="Media folders" className="flex min-w-0 flex-col gap-1">
      {entry("all", "All media", null)}
      {entry("unfiled", "Unfiled", null)}
      {children(null, 0)}
    </nav>
  );
}
