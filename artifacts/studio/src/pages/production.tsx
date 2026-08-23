import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Play, Film, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ProductionPage() {
  const [searchParams] = useSearchParams();
  const shotId = searchParams.get("shotId") || "1";
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<string | null>(null);

  // 1. دالة إرسال طلب التوليد وإنشاء الـ Job في الخلفية
  const handleGenerateVideo = async () => {
    setIsGenerating(true);
    setErrorLog(null);
    setVideoUrl(null);
    
    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotId: parseInt(shotId, 10),
          prompt: "Cinematic shot production with enhanced parameters for studio workflow."
        })
      });

      const data = await response.json();
      if (response.ok && data.jobId) {
        setJobId(data.jobId);
        setJobStatus(data.status); // queued في البداية
      } else {
        throw new Error(data.error || "Failed to start generation job");
      }
    } catch (err: any) {
      setErrorLog(err.message || "An error occurred");
      setIsGenerating(false);
    }
  };

  // 2. ميكانيكية الـ Polling للاستعلام الدوري عن الحالة الحقيقية للـ Job (إصلاح 16)
  useEffect(() => {
    if (!jobId) return;

    let intervalId = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/jobs/${jobId}`);
        if (!res.ok) return;
        
        const jobData = await res.json();
        setJobStatus(jobData.status); // جلب الحالة الحقيقية: queued, processing, completed, failed

        if (jobData.status === "completed") {
          setVideoUrl(jobData.videoUrl);
          setIsGenerating(false);
          clearInterval(intervalId);
        } else if (jobData.status === "failed") {
          setErrorLog(jobData.errorLog || "Generation job failed on the provider side.");
          setIsGenerating(false);
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error("Error polling job status:", err);
      }
    }, 1500); // استعلام خفيف كل 1.5 ثانية للمحافظة على السيرفر المجاني

    return () => clearInterval(intervalId);
  }, [jobId]);

  return (
    <div dir="rtl" className="container mx-auto p-6 space-y-6 text-right">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <Film className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">غرفة الإنتاج وتوليد الفيديو</h1>
          <p className="text-sm text-muted-foreground">تابع حالة معالجة اللقطات وتوليدها حياً من محرك الذكاء الاصطناعي</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* لوحة التحكم وإطلاق العملية */}
        <Card className="border-white/10 bg-card/40">
          <CardHeader>
            <CardTitle className="text-xl">التحكم في اللقطة #{shotId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-6">
              عند الضغط على البدء، سيتم ترحيل اللقطة إلى خادم الجدولة المنفصل وسيتم تحديث الحالة أمامك تلقائياً دون تثبيت وهمي.
            </p>
            
            <Button 
              onClick={handleGenerateVideo} 
              disabled={isGenerating}
              className="w-full h-12 text-md font-semibold"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  جاري المعالجة...
                </>
              ) : (
                <>
                  <Play className="ml-2 h-5 w-5" />
                  بدء إنتاج وتوليد اللقطة
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* شاشة مراقبة الحالة الحقيقية والمشغل البصري */}
        <Card className="lg:col-span-2 border-white/10 bg-card/40 overflow-hidden">
          <CardHeader className="border-b border-white/5 bg-black/20">
            <CardTitle className="text-md flex items-center justify-between">
              <span>حالة وظيفة الإنتاج الحالية</span>
              {jobStatus && (
                <span className="text-xs px-3 py-1 rounded-full border bg-background/50 flex items-center gap-1.5">
                  {jobStatus === "queued" && <Clock className="h-3 w-3 text-yellow-500" />}
                  {jobStatus === "processing" && <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />}
                  {jobStatus === "retrying" && <Loader2 className="h-3 w-3 text-orange-500 animate-spin" />}
                  {jobStatus === "completed" && <CheckCircle className="h-3 w-3 text-green-500" />}
                  {jobStatus === "failed" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                  الحالة الفعلية: {jobStatus}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex flex-col items-center justify-center min-h-[300px] bg-black/40 relative">
            
            {/* 1. في حالة الانتظار الأولي والجدولة */}
            {jobStatus === "queued" && (
              <div className="flex flex-col items-center gap-3 text-yellow-500 p-6 text-center">
                <Clock className="h-12 w-12 animate-pulse" />
                <h3 className="font-semibold text-lg">تمت الجدولة بنجاح (Queued)</h3>
                <p className="text-xs text-muted-foreground max-w-sm">المهمة تنتظر دورها في طابور المعالجة بالسيرفر لتوفير الموارد...</p>
              </div>
            )}

            {/* 2. في حالة المعالجة الحقيقية */}
            {(jobStatus === "processing" || jobStatus === "retrying") && (
              <div className="flex flex-col items-center gap-3 text-blue-400 p-6 text-center">
                <Loader2 className="h-12 w-12 animate-spin" />
                <h3 className="font-semibold text-lg">جاري التوليد من المحرك الحقيقي (Processing)</h3>
                <p className="text-xs text-muted-foreground max-w-sm">يتم الآن سحب البث وتوليد الفيديو، يرجى عدم إغلاق هذه الصفحة...</p>
              </div>
            )}

            {/* 3. في حالة فشل الإنتاج الفعلي وعرض الخطأ الصريح */}
            {errorLog && (
              <div className="flex flex-col items-center gap-3 text-red-400 p-6 text-center">
                <AlertTriangle className="h-12 w-12" />
                <h3 className="font-semibold text-lg">فشل إنتاج اللقطة</h3>
                <p className="text-xs bg-red-950/40 border border-red-500/20 p-3 rounded-md font-mono text-right max-w-md text-foreground">
                  {errorLog}
                </p>
              </div>
            )}

            {/* 4. اكتمال التوليد وجاهزية الفيديو الفعلي والعرض للمستخدم */}
            {jobStatus === "completed" && videoUrl && (
              <div className="w-full h-full flex flex-col p-4">
                <video 
                  src={videoUrl} 
                  controls 
                  autoPlay
                  className="w-full aspect-video rounded-lg border border-white/10 bg-black shadow-2xl"
                />
                <p className="mt-3 text-xs text-green-400 text-center font-medium flex items-center justify-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5" />
                  تم جاهزية وإنتاج الفيديو الفعلي بنجاح 100%!
                </p>
              </div>
            )}

            {/* 5. شاشة الاستعداد الافتراضية قبل إطلاق المهمة */}
            {!jobStatus && !isGenerating && !errorLog && (
              <div className="flex flex-col items-center gap-2 text-muted-foreground p-6 text-center">
                <Film className="h-12 w-12 opacity-20" />
                <p className="text-sm">اضغط على زر البدء لتوليد وعرض الفيديو السينمائي حياً</p>
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
