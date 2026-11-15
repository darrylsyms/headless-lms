export function publicationDay(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

export function publicationTime(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(11, 16) : "";
}

export function publicationInstant(day: string, time: string, previous?: string | null): string {
  const seconds =
    previous && publicationTime(previous) === time
      ? new Date(previous).toISOString().slice(16)
      : ":00.000Z";
  return new Date(`${day}T${time}${seconds}`).toISOString();
}

export function publicationIsFuture(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}

export function minimumScheduleTime(day: string, now: Date = new Date()): string | undefined {
  if (day !== now.toISOString().slice(0, 10)) return undefined;
  const next = new Date(now.getTime() + 60_000);
  if (next.toISOString().slice(0, 10) !== day) return "23:59";
  return next.toISOString().slice(11, 16);
}
