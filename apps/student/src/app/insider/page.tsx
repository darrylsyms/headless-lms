import { requireAuth } from "@/lib/auth/server-session";

export default async function InsiderPage() {
  await requireAuth();
  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-4 px-7 py-10">
      <h1 className="text-3xl font-semibold text-ink">Insider Feed</h1>
      <p className="text-ink-2">
        The Insider Feed is being built. Your existing posts and completion history have not been
        imported yet.
      </p>
    </main>
  );
}
