"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type SearchableSelectProps = {
  id: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  createLabel?: (query: string) => string;
  onCreate?: (query: string) => Promise<string>;
  onEdit?: (option: Option) => void;
  editLabel?: (option: Option) => string;
  maxLength?: number;
};

export function SearchableSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Select an option",
  emptyLabel = "No options found",
  createLabel = (query) => `Create “${query}”`,
  onCreate,
  onEdit,
  editLabel = (option) => `Edit ${option.label}`,
  maxLength,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState(false);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const term = query.trim();
  const matching = options.filter((option) =>
    option.label.toLowerCase().includes(term.toLowerCase()),
  );
  const canCreate = Boolean(
    onCreate &&
    term &&
    !options.some((option) => option.label.toLowerCase() === term.toLowerCase()),
  );
  const count = matching.length + (canCreate ? 1 : 0);
  const activeIndex = Math.min(active, Math.max(0, count - 1));

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  async function choose(index: number) {
    const option = matching[index];
    if (option) {
      onChange(option.value);
      close();
    } else if (canCreate && onCreate && !pending) {
      setPending(true);
      try {
        const created = await onCreate(term);
        onChange(created);
        close();
      } catch {
        return;
      } finally {
        setPending(false);
      }
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && count ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            maxLength={maxLength}
            placeholder={open ? "Search…" : placeholder}
            value={open ? query : (selected?.label ?? "")}
            disabled={pending}
            className="pr-9"
            onFocus={() => {
              setOpen(true);
              setQuery("");
              setActive(0);
            }}
            onClick={() => {
              if (!open) {
                setOpen(true);
                setQuery("");
                setActive(0);
              }
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) {
                  setOpen(true);
                  setQuery("");
                } else if (count)
                  setActive(
                    (current) => (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
                  );
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                if (count) void choose(activeIndex);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-2.5 size-4 text-ink-3"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if ((event.target as HTMLElement).closest(`#${CSS.escape(id)}`)) event.preventDefault();
        }}
      >
        <div id={listId} role="listbox" className="max-h-64 overflow-y-auto">
          {matching.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                index === activeIndex && "bg-hover",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => void choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check aria-hidden="true" className="size-4" />}
            </div>
          ))}
          {canCreate && (
            <div
              id={`${listId}-${matching.length}`}
              role="option"
              aria-selected={false}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                activeIndex === matching.length && "bg-hover",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(matching.length)}
              onClick={() => void choose(matching.length)}
            >
              <Plus aria-hidden="true" className="size-4" />
              {pending ? "Creating…" : createLabel(term)}
            </div>
          )}
          {!count && <p className="px-2 py-3 text-sm text-ink-3">{emptyLabel}</p>}
        </div>
        {selected && onEdit && (
          <div className="mt-1 border-t border-line pt-1">
            <Button
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-1.5 text-sm font-normal"
              onClick={() => {
                close();
                onEdit(selected);
              }}
            >
              <Pencil aria-hidden="true" /> {editLabel(selected)}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
