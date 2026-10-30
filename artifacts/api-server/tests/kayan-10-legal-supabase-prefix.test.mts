/**
 * KAYAN-10 — legalGuard accepts /api/storage/supabase/ with safe key validation.
 * Pure-function tests. NO DB. NO network. NO paid calls.
 */
import { assertSyntheticReference, isSyntheticReference } from "../src/lib/legalGuard.ts";

let pass = 0, fail = 0;
const ok = (n: string, cond: boolean, ev = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${n}${ev ? " :: " + ev : ""}`); cond ? pass++ : fail++; };
const accepts = (n: string, u: string) => { try { assertSyntheticReference(u); ok(n, true); } catch (e: any) { ok(n, false, e.message); } };
const rejects = (n: string, u: string) => { try { assertSyntheticReference(u); ok(n, false, "should have thrown"); } catch (e: any) { ok(n, e.code === "LEGAL_GUARD_NON_SYNTHETIC", "code=" + e.code); } };

// A. Accept valid supabase path
accepts("A1 supabase valid key", "/api/storage/supabase/actor-refs/abc.jpg");
accepts("A2 supabase nested", "/api/storage/supabase/videos/uuid-x.mp4");
ok("A3 isSynthetic true", isSyntheticReference("/api/storage/supabase/actor-refs/abc.jpg") === true);

// B. Reject unsafe supabase keys
rejects("B1 traversal", "/api/storage/supabase/../../etc/passwd");
rejects("B2 empty key", "/api/storage/supabase/");
rejects("B3 leading slash", "/api/storage/supabase//x.jpg");
rejects("B4 backslash", "/api/storage/supabase/actor-refs\\x.jpg");
rejects("B5 NUL byte", "/api/storage/supabase/actor-refs/a" + String.fromCharCode(0) + ".jpg");

// C. Regression — existing behavior unchanged
accepts("C1 /uploads/", "/uploads/actor-refs/abc.jpg");
accepts("C2 data:image/png", "data:image/png;base64,iVBORw0KGgo=");
accepts("C3 /api/storage/r2/", "/api/storage/r2/actor-refs/abc.jpg");
rejects("C4 external https", "https://evil.com/x.jpg");
rejects("C5 empty string", "");
rejects("C6 just scheme", "javascript:alert(1)");

console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
