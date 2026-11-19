import { test } from "node:test";
import assert from "node:assert/strict";
import { readStagingWordPressProfile } from "./staging-wordpress-profile.js";

test("reads the documented claims for the verified subject", async () => {
  let target = "";
  const fetcher: typeof fetch = async input => { target = String(input); return Response.json({ sub: "23003227", preferred_username: "player", given_name: "Alex", family_name: "Smith", email: "alex@example.test", name: "Public name" }); };
  assert.deepEqual(await readStagingWordPressProfile("token", "23003227", fetcher), { subject: "23003227", username: "player", firstName: "Alex", lastName: "Smith", email: "alex@example.test" });
  assert.equal(target, "https://getfretwise-cydd.1wp.site/wenisch-tech/keystone-oidc/oauth/userinfo");
});
test("refuses a mismatched subject and malformed claims", async () => {
  await assert.rejects(readStagingWordPressProfile("token", "23003227", async () => Response.json({ sub: "23003226" })), /subject mismatch/);
  await assert.rejects(readStagingWordPressProfile("token", "23003227", async () => Response.json({ sub: "23003227", given_name: ["Alex"] })), /Invalid WordPress profile field/);
});
test("distinguishes absent fields from cleared fields", async () => {
  const profile = await readStagingWordPressProfile("token", "23003227", async () => Response.json({ sub: "23003227", given_name: "" }));
  assert.equal(profile.firstName, null);
  assert.equal(profile.lastName, undefined);
});
