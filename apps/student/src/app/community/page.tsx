import { Communities, Posts } from "@headless-lms/sdk";
import { unstable_rethrow } from "next/navigation";
import { requireAuth } from "@/lib/auth/server-session";
import { authHeaders } from "@/lib/api/server-call";
import { statusOf } from "@/lib/api/shared";

export default async function CommunityPage() {
  await requireAuth();
  const communityId = process.env.FRETWISE_COMMUNITY_ID;
  if (!communityId) {
    return <CommunityMessage text="The community has not been configured yet." />;
  }
  const headers = await authHeaders();
  let community;
  let feed;
  try {
    [community, feed] = await Promise.all([
      Communities.getMemberCommunityHome({ communityId }, headers),
      Posts.getMemberFeed({ communityId, pageSize: 20 }, headers),
    ]);
  } catch (error) {
    unstable_rethrow(error);
    if (statusOf(error) === 404 || statusOf(error) === 403) {
      return (
        <CommunityMessage text="This community is not available to your account. Ask an administrator to check your access." />
      );
    }
    throw error;
  }
  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-8 px-7 py-10">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-brand-strong">Community</p>
        <h1 className="text-3xl font-semibold text-ink">{community.title}</h1>
        <p className="text-ink-2">{community.description}</p>
      </div>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Spaces</h2>
        {community.spaces.length === 0 ? (
          <p className="text-ink-2">No spaces are available yet.</p>
        ) : (
          community.spaces.map((space) => (
            <div key={space.id} className="flex flex-col gap-1 border-b border-line pb-4">
              <h3 className="font-medium">{space.name}</h3>
              <p className="text-sm text-ink-2">
                {space.locked ? "Access required" : space.description}
              </p>
            </div>
          ))
        )}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Recent posts</h2>
        {feed.rows.length === 0 ? (
          <p className="text-ink-2">No posts yet.</p>
        ) : (
          feed.rows.map((post) => (
            <article key={post.id} className="flex flex-col gap-2 border-b border-line pb-5">
              <h3 className="font-medium">{post.title}</h3>
              <p className="text-sm text-ink-3">
                {post.author.displayName ||
                  [post.author.firstName, post.author.lastName].filter(Boolean).join(" ") ||
                  "Member"}
              </p>
              <p className="whitespace-pre-wrap text-ink-2">{post.body}</p>
            </article>
          ))
        )}
      </section>
      <p className="text-sm text-ink-3">
        This first community preview is read-only. Posting, replies and space navigation are still
        to be built.
      </p>
    </main>
  );
}

function CommunityMessage({ text }: { text: string }) {
  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-4 px-7 py-10">
      <h1 className="text-3xl font-semibold">Community</h1>
      <p className="text-ink-2">{text}</p>
    </main>
  );
}
