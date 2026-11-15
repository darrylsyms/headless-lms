import Link from "next/link";
import { cn } from "@/lib/utils";

export function FeedTabs({
  active,
  canModerate,
}: {
  active: "activities" | "comments";
  canModerate: boolean;
}) {
  return (
    <nav
      aria-label="Insider Feed sections"
      className="flex items-center gap-1 shadow-[inset_0_-1px_0_var(--color-line)]"
    >
      {[
        { id: "activities", label: "Activities", href: "/insider-feed" },
        ...(canModerate
          ? [{ id: "comments", label: "Comments", href: "/insider-feed/comments" }]
          : []),
      ].map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={cn(
            "border-b-2 px-3 py-2.5 text-sm font-medium",
            active === tab.id
              ? "border-brand text-ink"
              : "border-transparent text-ink-3 hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
