# Fretwise LMS prototype

> Current cross-repository status and next steps are in `fretwise-lms-frontend/docs/handoff.md`. This README also contains setup details and historical notes.

This repository is based on the upstream Headless LMS source, retained under its MIT license. It is a local evaluation environment, not a production service. The `upstream` Git remote points to the original project; `origin` is the Fretwise fork. Check current remotes and branch before pushing, and never push Fretwise work to upstream.

## Start

From the repository root, run `./fretwise/start-local.sh`. Open the admin at http://localhost:8001 and the student portal at http://localhost:8002. The API is on port 8000. Create an admin account and an organisation in the admin app. Press Ctrl+C to stop the apps; `./fretwise/stop-database.sh` stops the local database.

This initial machine setup uses Homebrew PostgreSQL on port 8005 and local, ignored credentials in `.env`. Its database files and captured test emails are in `tmp/`; they are not in Git. Keep them private. This setup is specific to this machine. For a fresh installation see the upstream README and self-hosting documentation. Do not use real customer information here.

The local test uses MinIO for object storage; `start-local.sh` starts it on loopback when storage credentials are configured in `.env`. Install the Homebrew `minio` formula if the binary is unavailable. Data, configuration and logs live under `tmp/` and are ignored by Git; `./fretwise/stop-storage.sh` stops this instance. These local files and credentials need a backup before deleting the checkout or changing machines. A local email sink can write test emails to `tmp/emails`; the platform also has an SES integration, but production configuration and a real delivery test remain outstanding. See the frontend's `docs/amazon-ses-support.md` for which email paths use each transport. Docker is not required for this local setup.

## Initial Fretwise evaluation (historical)

The list below describes the initial investigation; many local prototype features now exist. See the frontend handoff for current status.

1. Create a sample course, module and lesson. Try embedding a Vimeo video and marking the lesson complete.
2. Explore whether a separate course or another existing content type provides a good basis for an Insider Feed. Check publishing workflow, chronological presentation, completion and access.
3. Try comments, replies and moderation on a lesson and the proposed feed item.
4. Test an invited student, course access and progress. Invitations are captured in the local email directory.
5. Before migration, verify historical completion and comment import, customer identity, WordPress metadata mappings, subscription changes and reconciliation. None is implemented here.

The supplied apps and their UI are upstream defaults. Vimeo embed behaviour, feed modelling, historical imports and a WooCommerce/WordPress integration still require investigation and implementation. This repository is an evaluation starting point; it is not ready for customers or production deployment.

## Fretwise customisations and upstream updates

The checkout keeps `upstream` pointing to Headless LMS. The first commit in this checkout is shallow; fetch full history before attempting to merge upstream (`git fetch --unshallow upstream` once, then `git fetch upstream`). Review upstream release and migration notes, back up the local database, and test an update on a separate branch before merging. Upstream updates can change APIs, environment variables and database migrations; compatibility cannot be assumed.

Fretwise-specific navigation lives in `apps/student/src/components/fretwise/portal-shell.tsx`; it is attached by a small change to the upstream root layout. The Insider and community pages are additions under `apps/student/src/app`. The community preview uses the current LMS API and is read-only. It needs `FRETWISE_COMMUNITY_ID` in `apps/student/.env.local`, set to the community ID for this local installation. It does not enumerate multiple communities. Do not commit local IDs or secrets. Course type links use the category field of the signed-in student’s accessible courses. The separate frontend now implements an Insider Feed; the admin also has an Insider authoring experience.

The course library combines a learner’s granted courses with published courses that their account has permission to read. This lets an owner or permitted instructor preview courses without a separate grant. Regular students still need a grant; a separate test student is useful to check their exact access experience. Admin and student apps share a localhost session cookie, so use a separate browser profile for simultaneous testing. Community access is also controlled by a grant, although staff with community-read permission can preview it.

## Lesson discussion extension

The local Fretwise checkout extends lesson discussions to retain the exact parent when replying to a reply. The LMS writes the comment and notification event together, and its notification processor applies access and channel preferences. The optional activity-comment `clientId` makes retries idempotent; reusing it with a different payload is rejected. Migration `0020_secret_bullseye` adds request records, and the OpenAPI contract and SDK reflect the new field. The change applies to lesson comments; community post threading retains the upstream behaviour. Older preview replies may still use the frontend's legacy SQLite reply-target mapping. Outbound email is not configured in this local environment.

The local LMS also exposes `DELETE /api/member/notifications/:notificationId/read` to mark the signed-in member's in-app notification unread. The companion Practice Lab uses this together with the LMS mark-read endpoint so LMS-backed notifications share read state across both interfaces.

The local file test uses a private bucket and five-minute signed download URLs. Lesson access is checked before a link is issued; a previously issued link can still be used until it expires. This local storage is for fictional test content, not a production service. Vimeo remains the intended video host; its domain privacy settings were not changed.

The local LMS exposes an activity-file download route for lesson resources. It checks the same course and attachment access as the inline file route, then signs an attachment response using the stored filename. Inline media continues to use the existing file route.

## Staging purchase synchronization

The local database has a staging-only mapping between a disposable shop customer and an LMS test student. The labelled staging subscription bundle contains Darryl Test only. The prototype worker at `adapters/db/staging-sync-worker.ts` accepts temporary read-only staging credentials through `FRETWISE_STAGING_WOO_KEY` and `FRETWISE_STAGING_WOO_SECRET`; it checks every 30 seconds and stops on Ctrl+C. It is restricted to this local database and the explicitly mapped test customer, products, student and course. Do not put credentials in Git or use this worker for real customers. The existing course grant belongs to another source and requires review rather than being overwritten. No worker or credentials are left running by default.

The test purchase, subscription status changes, manual renewal and refund flows have been exercised in staging with Stripe test-mode payments. The earlier manual-renewal limitation was subsequently investigated with disposable staging test data. A new checkout customer also signed in through WordPress and reached a mapped course in the local LMS. This is restricted test plumbing, not general production customer onboarding or synchronization; production mappings, secret management and deployment still need work. See the companion frontend repository's `docs/access-purchases-prototype.md` for the test record and limitations.
