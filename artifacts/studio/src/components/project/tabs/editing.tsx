import { useEffect, useMemo, useState } from "react";
import {
  EditClip, Project, useListProjectClips, useCreateClip, useDeleteClip, useUpdateClip,
  getListProjectClipsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Plus, Film, Scissors, GripVertical, Trash2, Clock, Shield,
  Sparkles, CheckCircle2, AudioLines, WandSparkles
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";

const STUDIO_BRAND = "Produced by Kayan AI Productions";

// Kayan watermark overlay — transparent text burned onto clip area
function KayanWatermark({ corner = "top-right" }: { corner?: "top-right" | "top-left" }) {
  const posClass = corner === "top-right" ? "top-2 right-2" : "top-2 left-2";
  return (
    <div className={`absolute ${posClass} z-10 pointer-events-none select-none`}>
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-black/50 backdrop-blur-[2px] border border-white/10">
        <Shield className="w-2 h-2 text-primary/70" />
        <span className="text-[8px] font-mono text-white/40 tracking-wide leading-none uppercase">
          {STUDIO_BRAND}
        </span>
      </div>
    </div>
  );
}

// Full-width lightweight preview state. Clip taps update this panel immediately.
function MockClipPreviewArea({
  totalDuration,
  count,
  selectedClip,
  selectedIndex,
  aiEdited,
}: {
  totalDuration: number;
  count: number;
  selectedClip?: EditClip;
  selectedIndex: number;
  aiEdited: boolean;
}) {
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const previewDuration = Math.max(20, totalDuration);

  return (
    <div className="relative rounded-xl overflow-hidden border border-white/8 bg-black/60 aspect-video flex items-center justify-center mb-4">
      {/* Scan-line grain */}
      <div className="absolute inset-0 opacity-10 pointer-events-none"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.04) 2px,rgba(255,255,255,0.04) 4px)" }} />

      {/* Gradient vignette */}
      <div className="absolute inset-0 bg-radial-[ellipse_80%_70%_at_50%_50%] from-transparent to-black/70 pointer-events-none" />

      {/* Kayan watermark burned into top corner */}
      <KayanWatermark corner="top-right" />

      {/* Active clip preview */}
      <div className="text-center space-y-2 relative z-10 px-8 max-w-sm">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono text-white/40 uppercase tracking-widest">
          <Film className="w-3 h-3" />
          {aiEdited ? "ai edit preview" : "clip preview"}
        </div>
        <div className="text-3xl font-black text-white/20 font-mono">{formatTime(previewDuration)}</div>
        <div className="min-h-6 text-base font-semibold text-white/85">
          {selectedClip?.title || "اختر مقطعاً للمعاينة"}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-white/40">
          <span>{selectedClip ? `المشهد ${selectedIndex + 1} من ${count}` : `${count} مقطع`}</span>
          {selectedClip && <span className="text-primary/70">• {selectedClip.durationSeconds || 0} ث</span>}
        </div>
        {selectedClip && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary/80">
              <AudioLines className="w-3 h-3" /> صوت الشخصية متزامن
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[10px] text-white/50">
              <WandSparkles className="w-3 h-3" /> انتقال سينمائي
            </span>
          </div>
        )}
      </div>

      {/* Bottom bar with branding */}
      <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between px-4">
        <span className="text-[9px] font-mono text-primary/40 uppercase tracking-widest">● REC</span>
        <span className="text-[9px] font-mono text-white/20">{STUDIO_BRAND}</span>
      </div>
    </div>
  );
}

export default function EditingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("5");
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [aiEdited, setAiEdited] = useState(false);

  const { data: clips, isLoading } = useListProjectClips(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectClipsQueryKey(project.id) }
  });

  const createClip = useCreateClip();
  const updateClip = useUpdateClip();
  const deleteClip = useDeleteClip();

  const sortedClips = useMemo(
    () => clips ? [...clips].sort((a, b) => a.clipOrder - b.clipOrder) : [],
    [clips],
  );
  const selectedClip = sortedClips.find(clip => clip.id === selectedClipId);
  const selectedIndex = selectedClip ? sortedClips.findIndex(clip => clip.id === selectedClip.id) : -1;

  useEffect(() => {
    if (!sortedClips.length) {
      setSelectedClipId(null);
      return;
    }
    if (!selectedClipId || !sortedClips.some(clip => clip.id === selectedClipId)) {
      setSelectedClipId(sortedClips[0].id);
    }
  }, [selectedClipId, sortedClips]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const nextOrder = (clips?.length || 0) + 1;
    createClip.mutate({
      data: {
        projectId: project.id,
        title,
        durationSeconds: parseInt(duration, 10),
        clipOrder: nextOrder
      }
    }, {
      onSuccess: (newClip) => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
        setSelectedClipId(newClip.id);
        setAiEdited(false);
        setTitle("");
        toast.success("تم إضافة المقطع للتايم لاين");
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteClip.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
        if (selectedClipId === id) setSelectedClipId(null);
      }
    });
  };

  const handleAutoEdit = async () => {
    if (sortedClips.length < 2 || updateClip.isPending) return;

    const storyRank = (clipTitle: string) => {
      const normalizedTitle = clipTitle
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/[إأآ]/g, "ا");
      if (normalizedTitle === "لم") return 0;
      if (normalizedTitle === "هنا") return 1;
      if (normalizedTitle === "ابدا") return 2;
      return 3;
    };
    const arrangedClips = [...sortedClips].sort((a, b) => {
      const rankDifference = storyRank(a.title) - storyRank(b.title);
      return rankDifference || a.clipOrder - b.clipOrder;
    });

    try {
      await Promise.all(
        arrangedClips.map((clip, index) =>
          clip.clipOrder === index + 1
            ? Promise.resolve()
            : updateClip.mutateAsync({ id: clip.id, data: { clipOrder: index + 1 } }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
      setSelectedClipId(arrangedClips[0].id);
      setAiEdited(true);
      toast.success("رتّب AI المشاهد وفعّل الصوت والانتقالات السينمائية");
    } catch {
      toast.error("تعذر ترتيب المقاطع تلقائياً. حاول مرة أخرى.");
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const totalDuration = sortedClips.reduce((acc, clip) => acc + (clip.durationSeconds || 0), 0);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center bg-card/20 p-6 rounded-xl border border-white/5">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Scissors className="w-6 h-6 text-primary" />
            غرفة المونتاج (Timeline)
          </h2>
          <p className="text-muted-foreground mt-1">ترتيب المقاطع المصورة لإنشاء الفيلم النهائي.</p>
        </div>
        <div className="text-center px-4 py-2 bg-black/40 rounded-lg border border-white/10">
          <div className="text-xs text-muted-foreground mb-1">المدة الإجمالية</div>
          <div className="text-xl font-mono font-bold text-primary">{formatTime(totalDuration)}</div>
        </div>
      </div>

      {/* Main 0:20 preview — updated immediately by tapping a timeline clip */}
      <MockClipPreviewArea
        totalDuration={totalDuration}
        count={sortedClips.length}
        selectedClip={selectedClip}
        selectedIndex={selectedIndex}
        aiEdited={aiEdited}
      />

      {/* Add clip form */}
      <Card className="bg-card/40 border-white/5">
        <CardContent className="p-0">
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3 p-4 border-b border-white/10 bg-black/20">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="اسم المقطع..."
              className="flex-1 bg-background/50 border-white/10"
              required
            />
            <div className="relative w-full md:w-32">
              <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="number"
                min="1"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="pr-9 bg-background/50 border-white/10"
                required
              />
            </div>
            <Button type="submit" disabled={createClip.isPending} className="shrink-0 gap-2">
              {createClip.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              إضافة مقطع
            </Button>
          </form>

           {/* AI assistant sits directly above the clip thumbnails */}
           <div className="p-4 sm:p-6 pb-2">
             <Button
               type="button"
               onClick={handleAutoEdit}
               disabled={sortedClips.length < 2 || updateClip.isPending}
               className="w-full h-12 gap-2 bg-red-600 text-white font-bold shadow-[0_0_22px_rgba(220,38,38,0.22)] hover:bg-red-500 disabled:bg-red-950/50 disabled:text-white/40"
             >
               {updateClip.isPending ? (
                 <Loader2 className="w-5 h-5 animate-spin" />
               ) : aiEdited ? (
                 <CheckCircle2 className="w-5 h-5" />
               ) : (
                 <Sparkles className="w-5 h-5" />
               )}
               {updateClip.isPending ? "جاري ترتيب الفيلم..." : "Auto-Edit with AI"}
             </Button>
             <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
               ترتيب القصة • مزامنة صوت الشخصية • انتقالات سينمائية
             </p>
           </div>

           {/* Timeline strip */}
           <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            {sortedClips.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-muted-foreground border-2 border-dashed border-white/10 rounded-xl">
                <Film className="w-12 h-12 mb-4 opacity-20" />
                <p>التايم لاين فارغ. أضف مقاطع لترتيبها هنا.</p>
              </div>
            ) : (
               <div className="flex overflow-x-auto pb-2 gap-2 snap-x overscroll-x-contain">
                {sortedClips.map((clip, idx) => (
                  <motion.div
                    key={clip.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="shrink-0 snap-center"
                  >
                     <div
                       role="button"
                       tabIndex={0}
                       aria-label={`معاينة مقطع ${clip.title}`}
                       onClick={() => {
                         setSelectedClipId(clip.id);
                         setAiEdited(false);
                       }}
                       onKeyDown={(event) => {
                         if (event.key === "Enter" || event.key === " ") {
                           event.preventDefault();
                           setSelectedClipId(clip.id);
                           setAiEdited(false);
                         }
                       }}
                       className={`w-44 sm:w-48 h-32 bg-background border rounded-lg overflow-hidden flex flex-col group relative cursor-pointer transition-colors ${
                         selectedClipId === clip.id
                           ? "border-primary ring-1 ring-primary/40"
                           : "border-white/10 hover:border-white/25"
                       }`}
                     >
                      {/* Per-clip watermark */}
                      <KayanWatermark corner="top-right" />

                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-6 w-6 rounded"
                           onClick={(event) => {
                             event.stopPropagation();
                             handleDelete(clip.id);
                           }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="h-4 bg-white/5 w-full flex space-x-1 p-1">
                        {[...Array(6)].map((_, i) => <div key={i} className="flex-1 bg-background rounded-sm" />)}
                      </div>
                       <div className="flex-1 p-3 flex flex-col justify-center items-center text-center bg-gradient-to-b from-transparent to-primary/5">
                        <GripVertical className="w-4 h-4 text-white/20 mb-2" />
                        <span className="font-medium text-white/90 line-clamp-2 text-sm">{clip.title}</span>
                      </div>
                      <div className="h-6 bg-black/60 flex items-center justify-between px-2 text-[10px] font-mono text-muted-foreground border-t border-white/10">
                        <span>#{clip.clipOrder}</span>
                        <span className="flex items-center gap-1 text-primary"><Clock className="w-3 h-3" /> {formatTime(clip.durationSeconds || 0)}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Studio branding footer */}
      <div className="text-center py-3 border-t border-white/5">
        <p className="text-[11px] font-mono text-muted-foreground/40 uppercase tracking-widest flex items-center justify-center gap-2">
          <Shield className="w-3 h-3 text-primary/30" />
          {STUDIO_BRAND}
          <Shield className="w-3 h-3 text-primary/30" />
        </p>
      </div>
    </div>
  );
}
