"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export function DatePicker({
  id,
  value,
  label = "Date",
  onChange,
  onClear,
  disabled = false,
  direction = "past",
}: {
  id: string;
  value: string;
  label?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  disabled?: boolean;
  direction?: "past" | "future";
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthStart(value ? asDate(value) : new Date()));
  const today = dayKey(new Date());
  const currentMonth = today.slice(0, 7);
  const offset = (month.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const previousMonth = () =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)));
  const nextMonth = () =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMonth(monthStart(value ? asDate(value) : new Date()));
      }}
    >
      <div className="relative">
        <PopoverTrigger asChild>
          <Button
            id={id}
            aria-label={`${label}: ${value ? dayFormat.format(asDate(value)) : "Select date"}`}
            variant="secondary"
            disabled={disabled}
            className={cn("w-full justify-start font-normal", value && onClear ? "pr-20" : "pr-10")}
            onKeyDown={(event) => {
              if (onClear && value && (event.key === "Backspace" || event.key === "Delete")) {
                event.preventDefault();
                onClear();
                setOpen(false);
              }
            }}
          >
            <span className={cn(!value && "text-ink-4")}>
              {value ? dayFormat.format(asDate(value)) : "Select date"}
            </span>
          </Button>
        </PopoverTrigger>
        <CalendarDays
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-3 top-2.5 size-4 text-ink-3",
            disabled && "opacity-50",
          )}
        />
        {value && onClear && !disabled && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Clear ${label.toLowerCase()}`}
            className="absolute right-9 top-0.5"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <X />
          </Button>
        )}
      </div>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={previousMonth}
            disabled={direction === "future" && dayKey(month).slice(0, 7) <= currentMonth}
            aria-label="Previous month"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium" aria-live="polite">
            {monthFormat.format(month)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={nextMonth}
            disabled={direction === "past" && dayKey(month).slice(0, 7) >= currentMonth}
            aria-label="Next month"
          >
            <ChevronRight />
          </Button>
        </div>
        <div
          className="mt-2 grid grid-cols-7 gap-1 text-center"
          role="group"
          aria-label={monthFormat.format(month)}
        >
          {weekdays.map((day) => (
            <span key={day} className="py-1 text-xs text-ink-4" aria-label={day}>
              {day.slice(0, 1)}
            </span>
          ))}
          {Array.from({ length: offset }, (_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {Array.from({ length: days }, (_, index) => {
            const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index + 1));
            const day = dayKey(date);
            return (
              <Button
                key={day}
                variant={value === day ? "primary" : "ghost"}
                size="icon-sm"
                disabled={direction === "past" ? day > today : day < today}
                aria-label={dayFormat.format(date)}
                aria-pressed={value === day}
                onClick={() => {
                  onChange(day);
                  setOpen(false);
                }}
                className="mx-auto"
              >
                {index + 1}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
