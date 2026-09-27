import { useEffect, useMemo, useState } from "react";
import {
  Project, useListProjectClips, useCreateClip, useDeleteClip,
  getListProjectClipsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Film, Scissors, Trash2, Clock, Sparkles, AudioLines } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";

function TimelinePreviewArea({ totalDuration, clips, project, onSyncSuccess }: { totalDuration: number; clips: any[]; project: Project; onSyncSuccess: () => void; }) {
  const [renderStatus, setRenderStatus] = useState("IDLE");
  const [renderProgress, setRenderProgress] = useState(0);
  const [finalMp4Url, setFinalMp4Url] = useState<string | null>(null);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  const handleStartFinalRender = async () => {
    setRenderStatus("PROCESSING");
    setRenderProgress(30);
    try {
      const response = await fetch(`/api/projects/${project.id}/timeline/sync`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await response.json();
      if (response.ok && data.success) {
        setRenderProgress(100); setRenderStatus("COMPLETED"); setFinalMp4Url(data.outputVideoUrl);
        toast.success("تمت مزامنة خط التايم لاين وإطلاق الرندر الخلفي الحقيقي بنجاح 100%.");
        onSyncSuccess();
      } else { throw new Error(); }
    } catch { setRenderStatus("FAILED"); toast.error("فشلت عملية مزامنة ورندرة أصول التايم لاين."); }
  };

  return (
    <div className="relative rounded-xl overflow-hidden border border-white/8 bg-black/60 p-4 mb-4">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-3 gap-2">
        <div className="inline-flex items-center gap-2 text-xs font-mono text-white/50 uppercase tracking-wider"><Film className="w-3.5 h-3.5 text-primary" /> مخطط المسارات الحقيقية والإنتاج المزامَن (Timeline Sync)</div>
        <div className="flex items-center gap-3">
          <div className="text-sm font-mono text-primary font-bold">إجمالي: {formatTime(totalDuration)}</div>
          <Button type="button" size="sm" onClick={handleStartFinalRender} disabled={renderStatus === "PROCESSING" || clips.length === 0} className="h-8 gap-1.5 bg-red-600 text-white font-bold hover:bg-red-500 shadow-lg text-xs rounded animate-pulse">{renderStatus === "PROCESSING" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} مزامنة ورندرة الفيلم</Button>
        </div>
      </div>
      {renderStatus !== "IDLE" && (
        <div className="mb-4 p-3 rounded-lg border bg-black/40 border-white/5 space-y-2">
          <div className="flex justify-between items-center text-[11px] font-mono"><span className="text-white/60">حالة الرندر الخلفي: <strong className="text-primary">{renderStatus}</strong></span><span className="text-primary font-bold">{renderProgress}%</span></div>
          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-primary transition-all duration-300" style={{ width: `${renderProgress}%` }} /></div>
          {finalMp4Url && <div className="pt-2"><p className="text-[10px] text-green-400 font-mono">✅ تم إنشاء الـ Manifest واستقرت أصول الـ MP4 المدمجة حقيقياً.</p></div>}
        </div>
      )}
      <div className="space-y-2 font-mono text-xs opacity-75">
        <div className="grid grid-cols-6 items-center gap-2 bg-white/2 p-2 rounded border border-white/5"><span className="col-span-1 text-white/60 flex items-center gap-1"><Film className="w-3 h-3 text-blue-400" /> VIDEO</span><div className="col-span-5 bg-blue-500/10 border border-blue-500/30 rounded p-1 text-[10px] text-blue-300 truncate">{clips.filter(c => c.trackType === "video" || !c.trackType).length} مقاطع مرئية مسجلة حقيقياً</div></div>
        <div className="grid grid-cols-6 items-center gap-2 bg-white/2 p-2 rounded border border-white/5"><span className="col-span-1 text-white/60 flex items-center gap-1"><AudioLines className="w-3 h-3 text-green-400" /> VOICE</span><div className="col-span-5 bg-green-500/10 border border-green-500/30 rounded p-1 text-[10px] text-green-300 truncate">{clips.filter(c => c.trackType === "voice").length} مسارات حوارية حية</div></div>
      </div>
    </div>
  );
}

export default function EditingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("5");
  const [trackType, setTrackType] = useState("video");
  const [volume, setVolume] = useState("1.0");
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);

  const { data: clips, isLoading, refetch } = useListProjectClips(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectClipsQueryKey(project.id) }
  });

  const createClip = useCreateClip();
  const deleteClip = useDeleteClip();

  const sortedClips = useMemo(() => clips ? [...clips].sort((a, b) => a.clipOrder - b.clipOrder) : [], [clips]);
  const selectedClip = sortedClips.find(clip => clip.id === selectedClipId);

  useEffect(() => {
    if (!sortedClips.length) { setSelectedClipId(null); return; }
    if (!selectedClipId || !sortedClips.some(clip => clip.id === selectedClipId)) {
      setSelectedClipId(sortedClips[0].id);
    }
  }, [selectedClipId, sortedClips]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const nextOrder = (clips?.length || 0) + 1;
    const durNum = parseInt(duration, 10) || 5;

    createClip.mutate({
      data: {
        projectId: project.id,
        title: title.trim(),
        durationSeconds: durNum,
        clipOrder: nextOrder,
        trackType: trackType,
        startTime: 0,
        endTime: durNum,
        sourceStart: 0,
        sourceEnd: durNum,
        volume: parseFloat(volume) || 1.0,
      }
    }, {
      onSuccess: (newClip) => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
        setSelectedClipId(newClip.id);
        setTitle("");
        toast.success("تم تحديث وحفظ سجل المونتاج في قاعدة البيانات.");
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteClip.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
        if (selectedClipId === id) setSelectedClipId(null);
        toast.success("تم مسح مقطع التايم لاين من قاعدة البيانات.");
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const totalDuration = sortedClips.reduce((acc, clip) => acc + (clip.durationSeconds || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card/20 p-6 rounded-xl border border-white/5">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Scissors className="w-6 h-6 text-primary" /> غرفة المونتاج والتايم لاين الفعال</h2>
          <p className="text-muted-foreground mt-1">تنظيم المسارات ومزامنتها حقيقياً داخل خادم قاعدة البيانات والـ Rendering Pipeline.</p>
        </div>
      </div>

      <TimelinePreviewArea totalDuration={totalDuration} clips={sortedClips} project={project} onSyncSuccess={() => refetch()} />

      <Card className="bg-card/40 border-white/5">
        <CardContent className="p-0">
          <form onSubmit={handleAdd} className="flex flex-col gap-3 p-4 border-b border-white/10 bg-black/20">
            <div className="flex flex-col md:flex-row gap-3">
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="اسم الأصل المونتاجي أو المسار..." className="flex-1 bg-background/50 border-white/10 text-white" required />
              <div className="relative w-full md:w-32">
                <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} className="pr-9 bg-background/50 border-white/10 text-white" required />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-center">
              <div className="w-full sm:flex-1 flex items-center gap-2">
                <label className="text-xs text-zinc-400 shrink-0">نوع المسار الفعال:</label>
                <select value={trackType} onChange={e => setTrackType(e.target.value)} className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white">
                  <option value="video">🎬 VIDEO (فيديو مرئي)</option>
                  <option value="voice">🗣️ VOICE (حوار صوتي)</option>
                  <option value="music">🎵 MUSIC (موسيقى تصويرية)</option>
                  <option value="sfx">🔊 SFX (مؤثرات محيطية)</option>
                </select>
              </div>
              <div className="w-full sm:w-44 flex items-center gap-2">
                <label className="text-xs text-zinc-400 shrink-0">شدة الصوت:</label>
                <select value={volume} onChange={e => setVolume(e.target.value)} className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white">
                  <option value="1.0">100% (طبيعي)</option>
                  <option value="0.5">50% (خلفية)</option>
                  <option value="0.0">0% (كتم)</option>
                </select>
              </div>
              <Button type="submit" disabled={createClip.isPending} className="w-full sm:w-auto shrink-0 bg-primary text-white font-bold gap-2">
                {createClip.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} إضافة للمسار
              </Button>
            </div>
          </form>
          <div className="p-6">
            {sortedClips.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-zinc-500 border-2 border-dashed border-white/10 rounded-xl">
                <Film className="w-12 h-12 mb-4 opacity-20" /><p>التايم لاين فارغ حالياً في قاعدة البيانات.</p>
              </div>
            ) : (
              <div className="flex overflow-x-auto pb-2 gap-2 snap-x">
                {sortedClips.map((clip) => (
                  <div key={clip.id} onClick={() => setSelectedClipId(clip.id)} className={`shrink-0 snap-center w-44 h-20 bg-zinc-950 border rounded-lg p-3 flex flex-col justify-between relative cursor-pointer ${selectedClipId === clip.id ? "border-primary ring-1 ring-primary/40" : "border-white/10"}`}>
                    <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                      <Button type="button" variant="destructive" size="icon" className="h-5 w-5 rounded" onClick={(e) => { e.stopPropagation(); handleDelete(clip.id); }}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                    <span className="font-medium text-white text-xs line-clamp-1 block text-right">{clip.title}</span>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono pt-1.5 border-t border-white/5">
                      <span className="text-primary uppercase font-bold">{clip.trackType}</span>
                      <span>{clip.durationSeconds}s</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
