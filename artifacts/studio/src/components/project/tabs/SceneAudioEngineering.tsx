import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RotateCcw, Eye } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getListProjectShotsQueryKey } from "@workspace/api-client-react";

const EMOTIONS = ["neutral","joy","sadness","anger","fear","surprise","disgust","romantic","anxious","confident"];
const AUDAR_TAGS = ["[laughs]","[curious]","[excited]","[sighs]","[exhales]","[mischievously]","[whispers]","[sarcastic]"];

const EMOTION_LABELS: Record<string, string> = {
  neutral: "محايد", joy: "فرح", sadness: "حزن", anger: "غضب", fear: "خوف",
  surprise: "مفاجأة", disgust: "اشمئزاز", romantic: "رومانسي", anxious: "قلق", confident: "ثقة"
};
const TAG_LABELS: Record<string, string> = {
  "[laughs]": "ضحك", "[curious]": "فضول", "[excited]": "حماس", "[sighs]": "تنهد",
  "[exhales]": "زفير", "[mischievously]": "مكر", "[whispers]": "همس", "[sarcastic]": "سخرية"
};


export default function SceneAudioEngineering({ shot, projectId }: { shot: any; projectId: number }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"analyze"|"preview"|"restore"|null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const instr = shot.audioInstruction;
  const manual = shot.manualInstruction;
  const mergedEmotion = manual?.fields?.emotion?.value ?? instr?.fields?.emotion?.value ?? null;
  const mergedTag = manual?.fields?.audar_tag?.value ?? instr?.fields?.audar_tag?.value ?? null;
  const mergedIntensity = manual?.fields?.intensity?.value ?? instr?.fields?.intensity?.value ?? null;
  const resolved = shot.resolvedText;
  const confidence = instr?.fields?.emotion?.confidence ?? null;

  const analyze = async (force = false) => {
    setBusy("analyze");
    try {
      const r = await fetch(`/api/shots/${shot.id}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "فشل التحليل");
      toast.success("تم تحليل المشهد");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const patchManual = async (fields: any) => {
    setBusy("analyze");
    try {
      const r = await fetch(`/api/shots/${shot.id}/manual-instruction`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "فشل الحفظ");
      toast.success("تم الحفظ");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const restore = async () => {
    setBusy("restore");
    try {
      const r = await fetch(`/api/shots/${shot.id}/restore-director`, { method: "POST" });
      if (!r.ok) throw new Error("فشل الاستعادة");
      toast.success("تمت الاستعادة");
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(projectId) });
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const preview = async () => {
    setBusy("preview");
    setPreviewUrl(null);
    try {
      const r = await fetch(`/api/shots/${shot.id}/preview-audio`, { method: "POST" });
      if (!r.ok) throw new Error("فشل التوليد");
      const blob = await r.blob();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold text-primary">
          <Sparkles className="w-4 h-4" /> الهندسة الصوتية
        </div>
        <div className="flex items-center gap-1">
          {manual && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded font-mono">يدوي</span>}
          {confidence !== null && confidence < 0.6 && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded font-mono">ثقة منخفضة</span>}
          {instr?.fields?.audar_tag?.source === "dialogue" && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono">حوار يدوي</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <label className="text-[10px] text-muted-foreground">Emotion</label>
          <select value={mergedEmotion ?? ""} onChange={e => patchManual({ emotion: e.target.value || null })}
            className="w-full h-8 rounded border border-white/10 bg-zinc-900 px-2 text-xs text-white">
            <option value="">—</option>
            {EMOTIONS.map(x => <option key={x} value={x}>{EMOTION_LABELS[x]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Audar Tag</label>
          <select value={mergedTag ?? ""} onChange={e => patchManual({ audar_tag: e.target.value || null })}
            className="w-full h-8 rounded border border-white/10 bg-zinc-900 px-2 text-xs text-white">
            <option value="">—</option>
            {AUDAR_TAGS.map(x => <option key={x} value={x}>{TAG_LABELS[x]}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Intensity: {mergedIntensity ?? "—"}</label>
          <input type="range" min="0" max="1" step="0.1" value={mergedIntensity ?? 0.5}
            onChange={e => patchManual({ intensity: parseFloat(e.target.value) })}
            className="w-full" />
        </div>
      </div>

      {resolved && (
        <div className="text-[11px] font-mono bg-black/40 p-2 rounded border border-white/5 text-green-300 break-all">
          Resolved: {resolved}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => analyze()} disabled={busy !== null} className="h-7 text-xs gap-1">
          {busy === "analyze" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} تحليل
        </Button>
        <Button size="sm" variant="outline" onClick={preview} disabled={busy !== null || !resolved} className="h-7 text-xs gap-1">
          {busy === "preview" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} معاينة
        </Button>
        {manual && (
          <Button size="sm" variant="outline" onClick={restore} disabled={busy !== null} className="h-7 text-xs gap-1 text-yellow-400">
            {busy === "restore" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} استعادة
          </Button>
        )}
      </div>

      {previewUrl && <audio src={previewUrl} controls className="w-full h-8 mt-2" />}
    </div>
  );
}
