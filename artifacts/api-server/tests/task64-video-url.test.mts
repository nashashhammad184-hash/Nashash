import { validateVideoUrl } from "../src/lib/videoShotLink";

let passed = 0, failed = 0;
const report = (n: string, ok: boolean, x = "") => {
  console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : ""));
  ok ? passed++ : failed++;
};

// Helper
function run(label: string, input: unknown, expected: "accept" | "reject") {
  const r = validateVideoUrl(input);
  if (expected === "accept") {
    report(label, r.ok === true, r.ok === false ? `rejected: ${r.error}` : "");
  } else {
    report(label, r.ok === false, r.ok === true ? "was accepted (BUG)" : "");
  }
}

// ═══ Valid local paths ═══
run("accept /uploads/videos/x.mp4", "/uploads/videos/x.mp4", "accept");
run("accept /uploads/videos/a-b_c.mp4", "/uploads/videos/a-b_c.mp4", "accept");
run("accept /uploads/videos/nested/x.mp4", "/uploads/videos/nested/x.mp4", "accept");

// ═══ Valid http(s) URLs ═══
run("accept https://example.com/x.mp4", "https://example.com/x.mp4", "accept");
run("accept https://cdn.example.com/a/b.mp4?token=xyz", "https://cdn.example.com/a/b.mp4?token=xyz", "accept");
run("accept http://example.com/x.mp4", "http://example.com/x.mp4", "accept");

// ═══ Empty / whitespace ═══
run("reject empty", "", "reject");
run("reject whitespace", "   ", "reject");
run("reject non-string", 42, "reject");
run("reject null", null, "reject");
run("reject undefined", undefined, "reject");

// ═══ Dangerous schemes ═══
run("reject javascript:", "javascript:alert(1)", "reject");
run("reject data:video", "data:video/mp4;base64,AAAA", "reject");
run("reject data:image", "data:image/png;base64,AAAA", "reject");
run("reject file://", "file:///etc/passwd", "reject");
run("reject vbscript:", "vbscript:msgbox(1)", "reject");
run("reject blob:", "blob:https://x/y", "reject");
run("reject about:", "about:blank", "reject");
run("reject mailto:", "mailto:x@y.com", "reject");
run("reject unknown scheme", "gopher://x/y", "reject");

// ═══ Path traversal ═══
run("reject ..", "/uploads/videos/../../../etc/passwd", "reject");
run("reject .. in middle", "/uploads/../../../etc/passwd", "reject");
run("reject leading ..", "../etc/passwd", "reject");

// ═══ Backslashes / NUL ═══
run("reject backslash", "/uploads\\videos\\x.mp4", "reject");
run("reject NUL", "/uploads/videos/x\u0000.mp4", "reject");

// ═══ /uploads/ structural issues ═══
run("reject /uploads/ alone", "/uploads/", "reject");
run("reject /uploads//x.mp4", "/uploads//videos/x.mp4", "reject");
run("reject /uploads/./x.mp4", "/uploads/./videos/x.mp4", "reject");

// ═══ Relative paths without scheme ═══
run("reject relative", "videos/x.mp4", "reject");
run("reject plain filename", "x.mp4", "reject");

// ═══ malformed URLs ═══
run("reject https:// (no host)", "https://", "reject");
run("reject http:// (no host)", "http://", "reject");

// ═══ Case insensitivity ═══
run("reject JavaScript: (case)", "JavaScript:alert(1)", "reject");
run("reject DATA: (case)", "DATA:text/plain,hi", "reject");
run("reject FILE: (case)", "FILE:///etc/passwd", "reject");

console.log("\nSUMMARY passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
