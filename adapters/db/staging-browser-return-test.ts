import assert from "node:assert/strict";
import { localReturnDestination, localStudentReturnDestination } from "./staging-browser-return.js";

assert.equal(localReturnDestination(null), "http://localhost:3020/dashboard");
assert.equal(localReturnDestination("/community?view=spaces"), "http://localhost:3020/community?view=spaces");
assert.equal(localReturnDestination("/courses/example"), "http://localhost:3020/courses/example");
for (const path of ["/notifications", "/profile", "/members/member-id", "/help"]) {
  assert.equal(localReturnDestination(path), `http://localhost:3020${path}`);
}
for (const destination of ["https://example.com/", "//example.com/", "/\\example.com", "/%2e%2e/admin", "/dashboard#fragment", "/other"]) {
  assert.throws(() => localReturnDestination(destination));
}
assert.equal(localStudentReturnDestination("/courses/crs_123?lesson=1"), "http://localhost:8002/courses/crs_123?lesson=1");
assert.equal(localStudentReturnDestination(null), "http://localhost:8002/");
for (const destination of ["https://example.com/", "//example.com/", "/\\example.com", "/api/auth/sign-out", "/courses#fragment"]) {
  assert.throws(() => localStudentReturnDestination(destination));
}
process.stdout.write("PASS: local sign-in return destinations stay within allowed member pages.\n");
