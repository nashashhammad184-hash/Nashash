/**
 * KAYAN-CINEMA-07: extracted presentational component for a single production
 * job row. Pure props-only — no hooks, no fetches, no context. This makes it
 * testable with react-dom/server (SSR) without needing jsdom or RTL.
 */
import React from "react";
import { AlertCircle } from "lucide-react";
import { isSubmitUncertain } from "../../../lib/production-status";

export interface ProductionJobRowData {
  id: string;
  type: string;
  status: string;
  progress: number;
  error?: string | null;
  submitUncertain?: boolean;
  retryCount: number;
  output?: any;
}

export function ProductionJobRow({ job }: { job: ProductionJobRowData }): React.ReactElement {
  const uncertain = isSubmitUncertain(job);
  const badgeClass = uncertain
    ? "bg-amber-950 text-amber-400 border border-amber-700"
    : job.status === "completed"
    ? "bg-green-950 text-green-400 border border-green-900"
    : job.status === "failed"
    ? "bg-red-950 text-red-400 border border-red-900"
    : "bg-blue-950 text-blue-400 border border-blue-900";
  const barClass = uncertain
    ? "bg-amber-500"
    : job.status === "failed"
    ? "bg-red-600"
    : job.status === "completed"
    ? "bg-green-500"
    : "bg-blue-500";
  return (
    <div className="p-3 space-y-1.5 text-[11px]" data-testid={`job-row-${job.id}`}>
      <div className="flex justify-between items-center">
        <span className="font-bold text-zinc-200 uppercase font-mono" data-testid="job-type">
          {job.type}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${badgeClass}`}
          data-testid="job-badge"
          data-uncertain={uncertain ? "true" : "false"}
        >
          {uncertain ? "⚠ مراجعة يدوية" : job.status}
        </span>
      </div>
      <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
        <span>ID: {job.id}</span>
        <span>Retries: {job.retryCount}</span>
      </div>
      <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-350 ${barClass}`}
          style={{ width: `${job.progress}%` }}
        />
      </div>
      {uncertain && (
        <div
          className="bg-amber-950/50 border border-amber-800 rounded p-2 text-[9px] text-amber-200 leading-relaxed"
          data-testid="submit-uncertain-warning"
        >
          <div className="flex items-center gap-1 font-bold mb-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            نتيجة إرسال غير مؤكدة
          </div>
          <div className="font-mono text-amber-300/80 break-all mb-1">
            {(job.error || "").replace(/^SUBMIT_UNCERTAIN:\s*/i, "").slice(0, 150)}
          </div>
          <div className="text-amber-200/90">
            قد يكون المزود قَبِل الطلب. لا تُعِد الإرسال تلقائياً — راجع لوحة WaveSpeed يدوياً.
          </div>
        </div>
      )}
      {!uncertain && job.status === "failed" && job.error && (
        <div
          className="text-[9px] text-red-400 font-mono flex items-center gap-1"
          data-testid="job-error"
        >
          <AlertCircle className="w-2.5 h-2.5 shrink-0" /> {job.error}
        </div>
      )}
      {job.status === "completed" && job.output && (job.output.isRealAI === false || job.output.provider === "mock") && (
        <div
          className="bg-red-950/60 border border-red-800 rounded p-2 text-[9px] text-red-200 leading-relaxed flex items-start gap-1"
          data-testid="mock-video-warning"
        >
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            <strong>MOCK_VIDEO_NOT_AI:</strong> هذا الفيديو ليس مخرجات ذكاء اصطناعي حقيقية (مزود=mock). لا تستخدمه كدليل على جاهزية الإنتاج.
          </span>
        </div>
      )}
      {job.status === "completed" && job.output && (
        <div
          className="bg-zinc-950 p-1.5 rounded border border-zinc-800 text-[9px] text-zinc-400 break-all font-mono"
          data-testid="job-output"
        >
          المخرج: {job.output.videoUrl || job.output.audioUrl || job.output.syncedVideoUrl}
        </div>
      )}
    </div>
  );
}
