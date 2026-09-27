import { VideoPlayerPanel } from "./video-player-panel";
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Film, Video, AudioLines, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ProductionJob {
  id: string;
  projectId?: number;
  type: "VIDEO_GEN" | "VOICE_GEN" | "LIP_SYNC" | "MUSIC_SFX_GEN";
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  error?: string | null;
  retryCount: number;
  output?: any;
}

interface ProductionTabProps {
  project: {
    id: number;
    title: string;
    worldId: string;
    projectType?: string;
    style?: string;
    status?: string;
    createdAt?: string;
  };
}

export function ProductionTab({ project }: ProductionTabProps) {
  const projectId = project.id;
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [videoPrompt, setVideoPrompt] = useState(`Cinematic shot of ${project.title}, masterpieces, 4k`);
  const [voiceText, setVoiceText] = useState("مرحباً بكم في استوديو كيان للإنتاج السينمائي.");
  const [syncVideoUrl, setSyncVideoUrl] = useState("");
  const [syncAudioUrl, setSyncAudioUrl] = useState("");

  const fetchJobs = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/production/projects/${projectId}/jobs`);
      const data = await res.json();
      if (data.success && Array.isArray(data.jobs)) {
        setJobs(data.jobs);
      }
    } catch {
      console.error("فشل تحديث سجلات مهمات التوليد.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleStartJob = async (type: string) => {
    setActionLoading(type);
    let payload: Record<string, any> = { type, projectId };
    if (type === "VIDEO_GEN") payload.prompt = videoPrompt;
    if (type === "VOICE_GEN") payload.text = voiceText;
    if (type === "LIP_SYNC") {
      if (!syncVideoUrl || !syncAudioUrl) {
        toast.error("خطأ: يجب إدخال روابط الفيديو والصوت لبدء تركيب الشفاه.");
        setActionLoading(null);
        return;
      }
      payload.videoUrl = syncVideoUrl;
      payload.audioUrl = syncAudioUrl;
    }
    try {
      const res = await fetch("/api/production/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`تم إطلاق مَهمة الإنتاج [${type}] بنجاح وجدولتها في الـ Queue.`);
        fetchJobs();
      } else {
        throw new Error(data.error || "فشلت جدولة المهمة.");
      }
    } catch (err: any) {
      toast.error("فشل إطلاق المَهمة: " + err.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6 text-white" dir="rtl">
      <div className="rounded-xl border border-white/10 bg-card p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-primary">
            <Film className="w-6 h-6" /> غرفة الإنتاج المركزي والتحكم بالـ Queue
          </h2>
          <p className="text-sm text-zinc-400 mt-1">إطلاق مهام التوليد السينمائي الحقيقي (Replicate & Deepgram) وتتبع تتابع خط الإنتاج.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-zinc-900 border-zinc-800 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-zinc-200">
                <Video className="w-4 h-4 text-blue-500" /> محرك توليد الفيديو السينمائي (Video Generation)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                value={videoPrompt}
                onChange={e => setVideoPrompt(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                placeholder="ادخل برومبت توليد المشهد البصري..."
              />
              <Button
                onClick={() => handleStartJob("VIDEO_GEN")}
                disabled={actionLoading === "VIDEO_GEN"}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold w-full text-xs py-1"
              >
                {actionLoading === "VIDEO_GEN" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />} 
                إطلاق توليد لقطة الفيديو
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-zinc-200">
                <AudioLines className="w-4 h-4 text-green-500" /> محرك تركيب الحوارات الصوتية (Voice TTS)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                value={voiceText}
                onChange={e => setVoiceText(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 p-2 text-xs text-white"
                placeholder="ادخل نص الحوار الصوتي لتوليده عبر Deepgram..."
              />
              <Button
                onClick={() => handleStartJob("VOICE_GEN")}
                disabled={actionLoading === "VOICE_GEN"}
                className="bg-green-600 hover:bg-green-700 text-white font-bold w-full text-xs py-1"
              >
                {actionLoading === "VOICE_GEN" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />} 
                إطلاق توليد مسار الحوار الصوتي
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-zinc-900 border-zinc-800 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-zinc-200">
                <Sparkles className="w-4 h-4 text-purple-500" /> محرك مزامنة حركة الشفاه (Lip Sync Audio Visual)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  value={syncVideoUrl}
                  onChange={e => setSyncVideoUrl(e.target.value)}
                  type="text"
                  className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-[11px] text-white"
                  placeholder="رابط فيديو المصدر (MP4 URL)..."
                />
                <input
                  value={syncAudioUrl}
                  onChange={e => setSyncAudioUrl(e.target.value)}
                  type="text"
                  className="h-8 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-[11px] text-white"
                  placeholder="رابط صوت الحوار (MP3 URL)..."
                />
              </div>
              <Button
                onClick={() => handleStartJob("LIP_SYNC")}
                disabled={actionLoading === "LIP_SYNC"}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold w-full text-xs py-1"
              >
                {actionLoading === "LIP_SYNC" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />} 
                بدء معالجة ومزامنة الشفاه الفعلية
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="border-b border-zinc-800 py-3">
              <CardTitle className="text-xs font-semibold flex items-center justify-between text-zinc-300">
                <span>شاشة مراقبة الـ Queue الخلفي</span>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-600" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 max-h-[350px] overflow-y-auto divide-y divide-zinc-800">
              {loadingList && jobs.length === 0 ? (
                <div className="p-4 text-center text-zinc-500 text-[11px] flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري الاتصال بمحرك الإنتاج...
                </div>
              ) : jobs.length === 0 ? (
                <p className="text-[11px] text-zinc-500 p-4 text-center">لا توجد مَهمات نشطة في الـ Queue حالياً.</p>
              ) : (
                jobs.map((job) => (
                  <div key={job.id} className="p-3 space-y-1.5 text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-zinc-200 uppercase font-mono">{job.type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                        job.status === "completed" ? "bg-green-950 text-green-400 border border-green-900" :
                        job.status === "failed" ? "bg-red-950 text-red-400 border border-red-900" :
                        "bg-blue-950 text-blue-400 border border-blue-900"
                      }`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                      <span>ID: {job.id}</span>
                      <span>Retries: {job.retryCount}</span>
                    </div>
                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-350 ${job.status === "failed" ? "bg-red-600" : job.status === "completed" ? "bg-green-500" : "bg-blue-500"}`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    {job.status === "completed" && job.output && (
                      <div className="bg-zinc-950 p-1.5 rounded border border-zinc-800 text-[9px] text-zinc-400 break-all font-mono">
                        المخرج: {job.output.videoUrl || job.output.audioUrl || job.output.syncedVideoUrl}
                      </div>
                    )}
                    {job.status === "failed" && job.error && (
                      <div className="text-[9px] text-red-400 font-mono flex items-center gap-1">
                        <AlertCircle className="w-2.5 h-2.5 shrink-0" /> {job.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border">
        <VideoPlayerPanel project={project as any} microExpression="neutral" prompt="Default video generation prompt" />
      </div>
    </div>
  );
}

export default ProductionTab;
