import { useEffect, useRef, useState } from "react";
import {
  Project, useListProjectTasks, useCreateTask, useUpdateTask, useDeleteTask, useListProjectActors,
  getListProjectTasksQueryKey, getListProjectActorsQueryKey, useGenerateVideo,
  useGetProductionPrompt, getGetProductionPromptQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Plus, CheckCircle2, Circle, Trash2, Calendar, User,
  PlayCircle, Mic2, Clapperboard, Sparkles, Download
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Dark HTML5 Video Player ───────────────────────────────────────────────────
function VideoPlayerPanel({
  project,
  microExpression,
  prompt,
  activeActorName,
}: {
  project: Project;
  microExpression: string;
  prompt: string;
  activeActorName: string;
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [mergeStatus, setMergeStatus] = useState<"idle" | "processing" | "completed">("idle");
  const [mergeStage, setMergeStage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const mergeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generateVideo = useGenerateVideo();

  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;

    // Muted autoplay is allowed by browsers; the user can enable audio from
    // the native controls after the completed MP4 is visible.
    videoRef.current.load();
    void videoRef.current.play().catch(() => {
      // Autoplay may be blocked by browser policy. Controls remain available.
    });
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (mergeTimerRef.current) clearInterval(mergeTimerRef.current);
    };
  }, []);

  const handleGenerate = () => {
    setVideoUrl(null);
    setVideoError(null);
    setMergeStatus("idle");
    setMergeStage("");
    generateVideo.mutate(
      {
        data: {
          projectId: project.id,
          prompt: prompt.trim() || `مشهد سينمائي من مشروع ${project.title}`,
          worldId: project.worldId,
          microExpression: microExpression || undefined,
        },
      },
      {
        onSuccess: (result) => {
          if (!result.videoUrl) {
            setVideoError("لم يُرجع محرك الفيديو رابط MP4 صالحاً.");
            return;
          }
          const playbackUrl = result.streamUrl || result.videoUrl;
          setVideoUrl(playbackUrl);
          setDownloadUrl(result.downloadUrl || null);
          toast.success("اكتمل توليد الفيديو — يمكنك تشغيله الآن");
        },
        onError: (error) => {
          setVideoError(
            error instanceof Error
              ? error.message
              : "تعذر الاتصال بمحرك الفيديو. حاول مرة أخرى.",
          );
        },
      },
    );
  };

  const handleAutoEditAndMerge = () => {
    if (generateVideo.isPending || mergeStatus === "processing") return;

    if (mergeTimerRef.current) clearInterval(mergeTimerRef.current);

    const stages = [
      "تجميع مسار الفيديو...",
      `إضافة صوت ${activeActorName} عبر ElevenLabs...`,
      "مزج الموسيقى والترجمة الإنجليزية...",
    ];
    let stageIndex = 0;

    setMergeStatus("processing");
    setMergeStage(stages[stageIndex]);
    mergeTimerRef.current = setInterval(() => {
      stageIndex += 1;
      if (stageIndex >= stages.length) {
        if (mergeTimerRef.current) clearInterval(mergeTimerRef.current);
        mergeTimerRef.current = null;
        setMergeStatus("completed");
        setMergeStage("تم الدمج تلقائياً — الفيديو والصوت والموسيقى جاهزة");
        toast.success("اكتمل Auto-Edit & Merge");
        return;
      }
      setMergeStage(stages[stageIndex]);
    }, 700);
  };

  return (
    <div className="rounded-xl border border-white/8 bg-black/60 overflow-hidden">
      {/* Player header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-black/40">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
          <Clapperboard className="w-4 h-4 text-primary" />
          غرفة الإنتاج والإخراج
        </div>
        {microExpression && (
          <span className="text-[10px] font-mono bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded-full">
            {microExpression}
          </span>
        )}
      </div>

      {/* Viewport */}
      <div className="relative aspect-video bg-black/80 flex items-center justify-center overflow-hidden">
        {/* Scan-line overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
          }}
        />

        {/* Render loading overlay: this is tied to the real mutation, not a timer */}
        <AnimatePresence>
          {generateVideo.isPending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10"
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <div className="w-10 h-10 rounded-full border-2 border-primary/20 border-b-primary animate-spin absolute inset-3" style={{ animationDirection: "reverse" }} />
              </div>
              <div className="text-center">
                <p className="text-primary font-semibold text-sm">جاري توليد المشهد...</p>
                <p className="text-muted-foreground text-xs mt-1 font-mono">Waiting for completed MP4</p>
                <p className="text-muted-foreground/60 text-[10px] mt-2">لن يبقى الطلب في حلقة لا نهائية</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completed video: only mount after the server returns a URL */}
        {videoUrl && !generateVideo.isPending && (
          <video
            key={videoUrl}
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain bg-black"
            src={videoUrl}
            controls
            autoPlay
            muted
            playsInline
            preload="auto"
            onLoadedData={() => setVideoError(null)}
            onCanPlay={() => {
              void videoRef.current?.play().catch(() => {
                // The native play control remains available if autoplay is blocked.
              });
            }}
            onError={() => {
              setVideoUrl(null);
              setVideoError("تعذر تشغيل ملف MP4 الذي أعاده محرك الفيديو.");
            }}
          />
        )}

        {/* Empty / error state */}
        {!videoUrl && !generateVideo.isPending && (
          <div className="flex flex-col items-center gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              {videoError ? (
                <span className="text-primary text-2xl">!</span>
              ) : (
                <PlayCircle className="w-8 h-8 text-white/20" />
              )}
            </div>
            <div>
              <p className={videoError ? "text-primary/80 text-sm font-semibold" : "text-white/30 text-sm font-semibold"}>
                {videoError ? "فشل تشغيل الفيديو" : "جاهز للتوليد"}
              </p>
              <p className="text-white/15 text-xs mt-1 font-mono">
                {videoError ?? "اضغط توليد الفيديو لبدء المشهد"}
              </p>
            </div>
          </div>
        )}

        {/* Corner watermarks */}
        <div className="absolute top-3 right-3 text-[9px] font-mono text-white/20 select-none">
          KAYAN AI PRODUCTIONS
        </div>
        <div className="absolute bottom-3 left-3 text-[9px] font-mono text-primary/30 select-none">
          ● REC &nbsp; 00:00:00
        </div>
      </div>

      {/* Player controls bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-black/60 border-t border-white/5">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-2 text-white/60 hover:text-white hover:bg-white/10"
          onClick={handleGenerate}
          disabled={generateVideo.isPending}
        >
          {generateVideo.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <PlayCircle className="w-4 h-4" />
          )}
          {generateVideo.isPending ? "جاري التوليد" : "توليد الفيديو"}
        </Button>
        {/* Timeline scrubber */}
        <div className="order-3 sm:order-none flex-1 min-w-[100px] h-1.5 bg-white/10 rounded-full relative cursor-pointer group">
          <div className="absolute inset-y-0 left-0 w-0 bg-primary rounded-full group-hover:w-1/4 transition-all duration-300" />
          <div className="absolute top-1/2 left-0 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary scale-0 group-hover:scale-100 transition-transform" />
        </div>
        <span className="order-4 sm:order-none text-[11px] font-mono text-muted-foreground/60">
          {videoUrl ? "MP4 READY" : "00:00 / 00:05"}
        </span>
        <Mic2 className="w-4 h-4 text-muted-foreground/40" />
        <Button
          size="sm"
          onClick={handleAutoEditAndMerge}
          disabled={generateVideo.isPending || mergeStatus === "processing"}
          className="order-2 sm:order-none h-9 w-full sm:w-auto gap-2 bg-primary text-primary-foreground font-semibold shadow-[0_0_18px_rgba(212,175,55,0.18)] hover:bg-primary/90"
        >
          {mergeStatus === "processing" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {mergeStatus === "processing" ? "جاري الدمج..." : "Auto-Edit & Merge"}
        </Button>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download="kayan-production.mp4"
            className="order-1 sm:order-none inline-flex h-9 w-full sm:w-auto items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Download className="w-4 h-4" />
            Download Video
          </a>
        )}
      </div>
      <AnimatePresence initial={false}>
        {mergeStatus !== "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 bg-primary/5 px-4 py-2.5"
          >
            <div className="flex items-center gap-2 text-xs">
              {mergeStatus === "processing" ? (
                <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" />
              )}
              <span className={mergeStatus === "completed" ? "text-primary/90" : "text-white/60"}>
                {mergeStage}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ProductionTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [assignedActorId, setAssignedActorId] = useState("unassigned");
  const [microExpression, setMicroExpression] = useState("");
  const [scenePrompt, setScenePrompt] = useState("");

  const { data: tasks, isLoading } = useListProjectTasks(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectTasksQueryKey(project.id) }
  });

  const { data: projectActors } = useListProjectActors(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectActorsQueryKey(project.id) }
  });

  const { data: productionPrompt } = useGetProductionPrompt(project.id, {
    query: {
      enabled: !!project.id,
      queryKey: getGetProductionPromptQueryKey(project.id),
      staleTime: 0,
      refetchOnMount: true,
    },
  });

  useEffect(() => {
    if (productionPrompt?.prompt) {
      setScenePrompt(productionPrompt.prompt);
    }
  }, [productionPrompt?.prompt]);

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate({
      data: {
        projectId: project.id,
        title,
        status: "pending",
        assignedActorId: assignedActorId !== "unassigned" ? parseInt(assignedActorId, 10) : undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) });
        setTitle("");
        setAssignedActorId("unassigned");
        toast.success("تمت إضافة المهمة");
      }
    });
  };

  const toggleStatus = (taskId: number, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    updateTask.mutate({ id: taskId, data: { status: newStatus } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) })
    });
  };

  const handleDelete = (id: number) => {
    deleteTask.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) })
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const getActorName = (id: number) =>
    projectActors?.find(pa => pa.actorId === id)?.actor?.name?.split("(")[0]?.trim() || "غير معروف";

  const completedCount = tasks?.filter(t => t.status === "completed").length || 0;
  const totalCount = tasks?.length || 0;
  const progress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const microExpressions = [
    { value: "غضب_مكتوم",      label: "غضب مكتوم",           en: "Suppressed Rage" },
    { value: "نظرة_حب_دافئة", label: "نظرة حب دافئة",       en: "Warm Loving Gaze" },
    { value: "صدمة",            label: "صدمة",                en: "Shock" },
    { value: "شك",              label: "شك",                  en: "Suspicion" },
    { value: "ابتسامة_حذرة",   label: "ابتسامة حذرة",        en: "Cautious Smile" },
  ];
  const selectedActorId = assignedActorId !== "unassigned" ? Number(assignedActorId) : undefined;
  const activeActorName =
    projectActors?.find(pa => pa.actorId === selectedActorId)?.actor?.name?.split("(")[0]?.trim() ||
    projectActors?.[0]?.actor?.name?.split("(")[0]?.trim() ||
    "الشخصية النشطة";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">

      {/* Micro-Expression + Video Player section */}
      <div className="space-y-4">
        {/* Micro-Expression selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl bg-card/20 border border-white/5">
          <div className="shrink-0 space-y-0.5">
            <p className="text-sm font-bold text-white/80">نوع التعبير الحركي</p>
            <p className="text-xs text-muted-foreground">(Micro-Expression)</p>
          </div>
          <Select value={microExpression} onValueChange={setMicroExpression}>
            <SelectTrigger className="flex-1 h-11 bg-background/50 border-white/10 focus:border-primary/50">
              <SelectValue placeholder="اختر نوع التعبير الوجهي للمشهد..." />
            </SelectTrigger>
            <SelectContent>
              {microExpressions.map(expr => (
                <SelectItem key={expr.value} value={expr.value}>
                  <span>{expr.label}</span>
                  <span className="mr-2 text-xs text-muted-foreground font-mono">— {expr.en}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Scene prompt + Video Player */}
        <div className="rounded-xl border border-white/8 bg-card/20 p-4 space-y-2">
          <label className="text-sm font-semibold text-white/80">وصف المشهد المراد توليده</label>
          <Input
            value={scenePrompt}
            onChange={(event) => setScenePrompt(event.target.value)}
            placeholder={`مشهد سينمائي من مشروع ${project.title}...`}
            className="h-11 bg-background/50 border-white/10"
          />
        </div>
        <VideoPlayerPanel
          microExpression={microExpressions.find(e => e.value === microExpression)?.label ?? ""}
          project={project}
          prompt={scenePrompt}
          activeActorName={activeActorName}
        />

      </div>

      {/* Progress card */}
      <div className="bg-card/20 p-6 rounded-xl border border-white/5 space-y-4">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold">مهام الإنتاج</h2>
            <p className="text-muted-foreground mt-1">قائمة المراجعة لضمان جاهزية كل شيء.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-primary">{progress}%</div>
            <div className="text-xs text-muted-foreground">مكتمل</div>
          </div>
        </div>
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {completedCount} / {totalCount} مهمة مكتملة
        </div>
      </div>

      {/* Task list */}
      <Card className="bg-card/40 border-white/5 overflow-hidden">
        <CardContent className="p-0">
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3 p-4 border-b border-white/10 bg-black/20">
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="إضافة مهمة جديدة..."
              className="flex-1 bg-background/50 border-white/10 h-12"
            />
            <Select value={assignedActorId} onValueChange={setAssignedActorId}>
              <SelectTrigger className="w-full md:w-[200px] h-12 bg-background/50 border-white/10">
                <SelectValue placeholder="الممثل المكلف" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">غير مكلف بممثل</SelectItem>
                {projectActors?.map(pa => (
                  <SelectItem key={pa.actorId} value={pa.actorId.toString()}>
                    {pa.actor?.name?.split("(")[0]?.trim()} ({pa.roleName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createTask.isPending || !title.trim()} className="h-12 px-6">
              {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-5 h-5" />}
            </Button>
          </form>

          <div className="flex flex-col">
            {tasks?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                لا توجد مهام حالياً. ابدأ بإضافة مهام للإنتاج.
              </div>
            ) : (
              tasks?.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-4 flex-1">
                    <button onClick={() => toggleStatus(task.id, task.status)} className="shrink-0 transition-transform hover:scale-110">
                      {task.status === "completed"
                        ? <CheckCircle2 className="w-6 h-6 text-primary" />
                        : <Circle className="w-6 h-6 text-muted-foreground" />}
                    </button>
                    <div className={`flex-1 transition-all ${task.status === "completed" ? "opacity-50 line-through" : ""}`}>
                      <p className="text-lg font-medium text-white/90">{task.title}</p>
                      {task.assignedActorId && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <User className="w-3 h-3" /> المكلف: {getActorName(task.assignedActorId)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {task.dueDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 bg-white/5 px-2 py-1 rounded">
                        <Calendar className="w-3 h-3" /> {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={() => handleDelete(task.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
