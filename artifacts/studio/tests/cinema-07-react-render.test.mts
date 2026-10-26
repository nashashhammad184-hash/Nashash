/**
 * KAYAN-CINEMA-07: real React SSR tests for ProductionJobRow.
 * Uses react-dom/server (already installed) — no jsdom, no RTL, no DOM.
 * Renders the actual component with real props and inspects HTML output.
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { ProductionJobRow } from "../src/components/project/tabs/production-job-row.tsx";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? " :: " + evidence : ""}`);
  ok ? pass++ : fail++;
};

const render = (job: any) => renderToString(React.createElement(ProductionJobRow, { job }));

// ── A. SUBMIT_UNCERTAIN row ────────────────────────────────────
{
  const html = render({
    id: "test-uncertain-1",
    type: "VIDEO_GEN",
    status: "failed",
    progress: 0,
    error: "SUBMIT_UNCERTAIN: ambiguous submit state (may have been charged). Manual check required via WaveSpeed dashboard. Original error: timeout",
    retryCount: 0,
  });
  check("A1 renders data-uncertain=true", html.includes('data-uncertain="true"'));
  check("A2 shows 'مراجعة يدوية'", html.includes("مراجعة يدوية"));
  check("A3 shows 'نتيجة إرسال غير مؤكدة'", html.includes("نتيجة إرسال غير مؤكدة"));
  check("A4 shows 'قد يكون المزود قَبِل الطلب'", html.includes("قد يكون المزود قَبِل الطلب"));
  check("A5 shows WaveSpeed manual-review instruction", html.includes("راجع لوحة WaveSpeed"));
  check("A6 has submit-uncertain-warning testid", html.includes('data-testid="submit-uncertain-warning"'));
  check("A7 NO normal failed-error block", !html.includes('data-testid="job-error"'));
  check("A8 NO retry button", !html.includes("إعادة") && !html.includes("retry") && !html.includes("Retry"));
  check("A9 raw prefix stripped from body", !html.includes("SUBMIT_UNCERTAIN: ambiguous"));
}

// ── B. Normal failed row (must remain normal) ─────────────────
{
  const html = render({
    id: "test-failed-1",
    type: "VIDEO_GEN",
    status: "failed",
    progress: 0,
    error: "HTTP 400 invalid body",
    retryCount: 1,
  });
  check("B1 renders data-uncertain=false", html.includes('data-uncertain="false"'));
  check("B2 shows raw error", html.includes("HTTP 400 invalid body"));
  check("B3 NO 'مراجعة يدوية'", !html.includes("مراجعة يدوية"));
  check("B4 NO uncertain-warning block", !html.includes('data-testid="submit-uncertain-warning"'));
  check("B5 shows normal error block", html.includes('data-testid="job-error"'));
}

// ── C. completed row ───────────────────────────────────────────
{
  const html = render({
    id: "test-done-1",
    type: "VIDEO_GEN",
    status: "completed",
    progress: 100,
    output: { videoUrl: "/api/storage/supabase/videos/test.mp4" },
    retryCount: 0,
  });
  check("C1 shows completed status", html.includes("completed"));
  check("C2 shows videoUrl", html.includes("/api/storage/supabase/videos/test.mp4"));
  check("C3 NO uncertain badge", !html.includes("مراجعة يدوية"));
}

// ── D. pending row ─────────────────────────────────────────────
{
  const html = render({
    id: "test-pending-1",
    type: "VOICE_GEN",
    status: "pending",
    progress: 0,
    retryCount: 0,
  });
  check("D1 shows pending status", html.includes("pending"));
  check("D2 NO uncertain badge", !html.includes("مراجعة يدوية"));
  check("D3 shows retries count", /Retries:.*?0/.test(html.replace(/<!--[^>]*-->/g, "")));
}

// ── E. explicit submitUncertain flag overrides error parse ─────
{
  const html = render({
    id: "test-flag-1",
    type: "VIDEO_GEN",
    status: "failed",
    progress: 0,
    submitUncertain: true,
    error: "some other error",
    retryCount: 0,
  });
  check("E1 explicit flag → uncertain badge", html.includes('data-uncertain="true"'));
}

console.log(`\nSUMMARY passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
