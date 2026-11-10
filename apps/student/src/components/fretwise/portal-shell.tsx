"use client";

import { useEffect, useState, type ReactNode } from "react";
import { listVisibleCourses } from "@/lib/api/visible-courses";
import { ensureClientSdk } from "@/lib/api/client-sdk";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Download, MessageCircle, Sparkles } from "lucide-react";

const links = [
  { href: "/", label: "My courses", icon: BookOpen },
  { href: "/insider", label: "Insider Feed", icon: Sparkles },
  { href: "/community", label: "Community", icon: MessageCircle },
  { href: "/downloads", label: "Downloads", icon: Download },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [categories, setCategories] = useState<string[]>([]);
  const isAuthPage = ["/login", "/welcome", "/session"].some((path) => pathname.startsWith(path));
  useEffect(() => {
    if (isAuthPage) return;
    let current = true;
    ensureClientSdk();
    listVisibleCourses()
      .then((courses) => {
        if (current)
          setCategories(
            [...new Set(courses.map((course) => course.category.trim()).filter(Boolean))].sort(),
          );
      })
      .catch(() => {
        if (current) setCategories([]);
      });
    return () => {
      current = false;
    };
  }, [isAuthPage]);
  if (isAuthPage) {
    return children;
  }
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-5 pb-2 pt-5 text-lg font-semibold text-ink">Fretwise</div>
        <nav aria-label="Student navigation" className="flex gap-1 overflow-x-auto p-3 md:flex-col">
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/" || pathname.startsWith("/courses/")
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${active ? "bg-brand-soft text-brand-strong" : "text-ink-2 hover:bg-hover-surface hover:text-ink"}`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
          {categories.length > 0 && (
            <div className="flex gap-1 border-l border-line pl-3 md:flex-col md:border-l-0 md:pl-0 md:pt-4">
              <p className="px-3 text-xs font-medium text-ink-3">COURSE TYPES</p>
              {categories.map((category) => (
                <Link
                  className="rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-hover-surface hover:text-ink"
                  key={category}
                  href={`/?category=${encodeURIComponent(category)}`}
                >
                  {category}
                </Link>
              ))}
            </div>
          )}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
