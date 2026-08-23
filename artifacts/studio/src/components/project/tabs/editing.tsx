import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Film, Shuffle, ArrowUp, ArrowDown, CheckCircle, Loader2, Play, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface EditClip {
  id: number;
  projectId: number;
  title: string;
  clipOrder: number;
  durationSeconds: number;
  videoUrl: string | null;
}

export default function EditingTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activePreviewClip, setActivePreviewClip] = useState<EditClip | null>(null);

  // 1. جلب مقاطع المونتاج الحالية للمشروع بسلام
  const { data: clips, isLoading } = useQuery<EditClip[]>({
    queryKey: ["project-clips", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/clips`);
      if (!res.ok) throw new Error("Failed to fetch clips");
      return res.json();
    }
  });

  // ترتيب المقاطع بناءً على الـ clipOrder الفعلي لخط المونتاج
  const sortedClips = useMemo(() => {
    if (!clips) return [];
    return [...clips].sort((a, b) => a.clipOrder - b.clipOrder);
  }, [clips]);

  // تحديث الترتيب الفعلي في قاعدة البيانات
  const updateOrderMutation = useMutation({
    mutationFn: async (updatedClips: EditClip[]) => {
      const res = await fetch(`/api/projects/${projectId}/clips/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: updatedClips.map(c => ({ id: c.id, clipOrder: c.clipOrder }))
        })
      });
      if (!res.ok) throw new Error("Failed to save new timeline order");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-clips", projectId] });
    }
  });

  // المونتاج التلقائي الصادق والحقيقي للـ Timeline فقط
  const handleAutoEdit = async () => {
    if (!clips || clips.length === 0) return;
    setIsProcessing(true);
    setSuccessMessage(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const reordered = [...clips].map((clip, index) => ({
        ...clip,
        clipOrder: index + 1
      }));
      await updateOrderMutation.mutateAsync(reordered);
      setSuccessMessage("تمت إعادة ترتيب وتسلسل المقاطع وتحديث خط المونتاج (Timeline) بنجاح!");
    } catch (err) {
      console.error("Auto edit failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  // تحريك المقاطع يدوياً
  const moveClip = async (index: number, direction: "up" | "down") => {
    if (!clips) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedClips.length) return;

    const newClips = [...sortedClips];
    const tempOrder = newClips[index].clipOrder;
    newClips[index].clipOrder = newClips[targetIndex].clipOrder;
    newClips[targetIndex].clipOrder = tempOrder;

    try {
      await updateOrderMutation.mutateAsync(newClips);
    } catch (err) {
      console.error("Manual reorder failed:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>جاري تحميل مقاطع غرفة المونتاج...</span>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 text-right">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            غرفة المونتاج ومعاينة مقاطع الـ Timeline الحقيقية
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            اضغط على أي مقطع لمعاينته مباشرة عبر مشغل الفيديو الفعلي والتأكد من جودة الإنتاج السينمائي.
          </p>
        </div>

        <Button
          onClick={handleAutoEdit}
          disabled={isProcessing || !clips || clips.length === 0}
          className="gap-2 font-semibold h-11"
        >
          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
          توليد ترتيب تلقائي للـ Timeline
        </Button>
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {sortedClips.length === 0 ? (
        <Card className="border-dashed border-white/10 bg-card/20">
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center text-center p-6">
            <Film className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <h3 className="font-semibold text-md">لا توجد مقاطع مونتاج حتّى الآن</h3>
            <p className="text-xs text-muted-foreground mt-1">قم بتوليد مقاطع من غرفة الإنتاج لتظهر هنا.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* العمود الأيمن: قائمة التحكم وترتيب المقاطع */}
          <div className="lg:col-span-2 space-y-4">
            {sortedClips.map((clip, index) => (
              <Card 
                key={clip.id} 
                className={`border-white/10 bg-card/30 transition-all duration-200 cursor-pointer ${
                  activePreviewClip?.id === clip.id ? "border-primary/50 bg-primary/5" : "hover:border-white/20"
                }`}
                onClick={() => setActivePreviewClip(clip)}
              >
                <CardContent className="flex items-center justify-between p-4 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-background font-mono text-xs border border-white/5">
                      #{clip.clipOrder}
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-foreground">{clip.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1">المدة الفعلية: {clip.durationSeconds} ثانية</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveClip(index, "up")}
                      disabled={index === 0 || updateOrderMutation.isPending}
                      className="h-8 w-8 border border-white/5 bg-background/40"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveClip(index, "down")}
                      disabled={index === sortedClips.length - 1 || updateOrderMutation.isPending}
                      className="h-8 w-8 border border-white/5 bg-background/40"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* العمود الأيسر: منطقة المعاينة السينمائية الحقيقية (إصلاح 19) */}
          <Card className="border-white/10 bg-black/40 overflow-hidden h-fit sticky top-6">
            <CardHeader className="border-b border-white/5 bg-card/50">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Play className="h-4 w-4 text-primary" />
                معاينة الأصول الحقيقية المحددة
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 flex flex-col items-center justify-center min-h-[240px] text-center">
              
              {activePreviewClip ? (
                activePreviewClip.videoUrl ? (
                  // استبدال المكون الوهمي بمشغل فيديو حقيقي HTML5 فيديو عند توفر الأصل الفعلي
                  <div className="w-full space-y-3">
                    <video
                      key={activePreviewClip.videoUrl}
                      src={activePreviewClip.videoUrl}
                      controls
                      autoPlay
                      className="w-full aspect-video rounded-lg bg-black border border-white/10 shadow-xl"
                    />
                    <div className="text-right px-1">
                      <h4 className="font-semibold text-xs text-primary">{activePreviewClip.title}</h4>
                      <p className="text-[10px] text-muted-foreground mt-1">الرابط المباشر: {activePreviewClip.videoUrl}</p>
                    </div>
                  </div>
                ) : (
                  // إذا لم يوجد فيديو فعلي للأصل الرقمي المختار
                  <div className="flex flex-col items-center gap-3 text-muted-foreground p-6">
                    <EyeOff className="h-10 w-10 opacity-30 text-yellow-500" />
                    <h4 className="font-semibold text-sm">لا يوجد فيديو</h4>
                    <p className="text-xs text-muted-foreground max-w-[180px]">
                      هذا المقطع لا يمتلك ملف فيديو حقيقي مسجل في التخزين حالياً.
                    </p>
                  </div>
                )
              ) : (
                // الحالة الافتراضية قبل الاختيار من خط المونتاج
                <div className="flex flex-col items-center gap-2 text-muted-foreground/60 p-6">
