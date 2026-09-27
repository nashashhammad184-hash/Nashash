import React, { useState, useEffect } from "react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../ui/card";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Sparkles, Loader2, AlertCircle, FileText, Globe, User } from "lucide-react";
import { Project, getListProjectShotsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Script {
  id: number;
  projectId: number;
  worldId: string;
  idea: string;
  generatedContent: string;
  createdAt: string;
}

export default function WritingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const projectIdFromUrl = project.id;
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [projectActors, setProjectActors] = useState<string[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchScriptsAndActors = () => {
    if (!projectIdFromUrl) return;
    
    fetch(`/api/projects/${projectIdFromUrl}/scripts`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setScripts(data);
          if (data.length > 0 && !selectedScript) setSelectedScript(data[0]);
        }
      })
      .catch((err) => console.error("Error loading scripts:", err));

    fetch(`/api/projects/${projectIdFromUrl}/subtitles`)
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.subtitles)) {
          const names = data.subtitles.map((a: any) => a.text).filter(Boolean);
          setProjectActors(names);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchScriptsAndActors();
  }, [projectIdFromUrl]);

  const handleGenerate = async () => {
    if (!projectIdFromUrl || !idea.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectIdFromUrl,
          worldId: project.worldId,
          idea: idea.trim(),
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || "فشلت عملية التوليد الإخراجية.");
      }

      setScripts((prev) => [resData, ...prev]);
      setSelectedScript(resData);
      setIdea("");
      
      // إبطال كاش اللقطات (Shots) فوراً ليقوم محرك الإخراج بسحب المشاهد المشتقة الجديدة تلقائياً
      queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(project.id) });
      
      toast.success("تم توليد السيناريو السينمائي وتفكيك اللقطات بداخل PostgreSQL بنجاح حقيقي.");
      fetchScriptsAndActors();
    } catch (err: any) {
      setError(err.message || "حدث خطأ غير متوقع أثناء الاتصال بخادم التوليد.");
      toast.error("فشل التوليد: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const splitScriptContent = (content: string) => {
    if (!content) return { mainText: "", subtitles: "" };
    // إذا كان المحرك يعيد الهيكل كـ JSON String من السيرفر نقوم بصياغته بشكل مقروء ونظيف للمخرج
    try {
      const parsed = JSON.parse(content);
      let textBuffer = `🎬 عنوان العمل: ${parsed.title || "غير معنون"}\n\n`;
      let subBuffer = "";
      
      if (Array.isArray(parsed.scenes)) {
        parsed.scenes.forEach((scene: any) => {
          textBuffer += `🎬 مشهد رقم [${scene.sceneNumber}]: ${scene.sceneTitle || ""}\n`;
          textBuffer += `🔹 الوصف المرئي: ${scene.visualDescription || ""}\n`;
          textBuffer += `💬 الحوارات: ${scene.characterDialogue || "لا يوجد"}\n`;
          textBuffer += `🎵 المؤثرات الصوتية: ${scene.audioMusic || ""}\n\n`;
          if (scene.englishSubtitles) {
            subBuffer += `[Scene ${scene.sceneNumber} Subtitles]:\n${scene.englishSubtitles}\n\n`;
          }
        });
      }
      return { mainText: textBuffer.trim(), subtitles: subBuffer.trim() };
    } catch {
      const parts = content.split("---ENGLISH_SUBTITLES---");
      return { mainText: parts[0]?.trim() || "", subtitles: parts[1]?.trim() || "" };
    }
  };

  const { mainText, subtitles } = splitScriptContent(selectedScript?.generatedContent || "");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-white" dir="rtl">
      <div className="space-y-6 lg:col-span-1">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary"><Sparkles className="h-5 w-5" /> AI Script Generator</CardTitle>
            <CardDescription className="text-zinc-400">صياغة السيناريوهات واللقطات السينمائية عبر الذكاء الاصطناعي الحقيقي.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea placeholder="مثال: نقاش حاد بين شخصيتين داخل سيارة مظلمة تحت المطر..." value={idea} onChange={(e) => setIdea(e.target.value)} rows={5} className="bg-zinc-800 border-zinc-700 text-white" disabled={loading} />
            {error && (
              <Alert variant="destructive" className="bg-red-950/20 border-red-900/50 py-2"><AlertCircle className="h-4 w-4" /><AlertTitle>خطأ في التوليد</AlertTitle><AlertDescription className="text-xs">{error}</AlertDescription></Alert>
            )}
            <Button className="w-full bg-red-600 hover:bg-red-700 text-white font-bold gap-2" onClick={handleGenerate} disabled={loading || !idea.trim()}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري صياغة النص...</> : <><Sparkles className="h-4 w-4" /> توليد السيناريو السينمائي</>}
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-zinc-300"><FileText className="h-4 w-4" /> مسودات السيناريو السابقة ({scripts.length})</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[300px] overflow-y-auto">
            {scripts.length === 0 ? (
              <p className="text-xs text-zinc-500 p-4 text-center">لا توجد نصوص مولدة بعد.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {scripts.map((s) => (
                  <button key={s.id} onClick={() => setSelectedScript(s)} className={`w-full text-right p-3 text-xs transition-colors hover:bg-zinc-800/50 block ${selectedScript?.id === s.id ? "bg-zinc-800 font-medium border-r-2 border-red-500" : ""}`}>
                    <div className="truncate text-white mb-1">{s.idea}</div>
                    <div className="text-[10px] text-zinc-500">{new Date(s.createdAt).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <Card className="bg-zinc-900 border-zinc-800 min-h-[500px] flex flex-col">
          <CardHeader className="border-b border-zinc-800 bg-zinc-900/50">
            <CardTitle className="text-md flex items-center gap-2 text-zinc-200"><FileText className="h-5 w-5 text-red-500" /> النص السينمائي النهائي الفعال</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[600px] font-mono text-sm leading-relaxed text-zinc-200">
            {!selectedScript ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 py-20">
                <FileText className="h-12 w-12 mb-2 opacity-30" /><p className="text-xs">ادخل الفكرة التوجيهية في القائمة الجانبية لإطلاق مهام التوليد السينمائي.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="whitespace-pre-wrap bg-zinc-950 p-4 rounded-md border border-zinc-800 shadow-inner text-right">{mainText}</div>
                {subtitles && (
                  <div className="mt-6 pt-4 border-t border-zinc-800">
                    <div className="flex items-center gap-2 text-xs font-semibold text-red-400 mb-2 uppercase tracking-wider"><Globe className="h-4 w-4" /> English Translation Subtitles</div>
                    <div className="whitespace-pre-wrap bg-red-950/10 text-red-200/80 p-4 rounded-md border border-red-900/20 text-xs text-left" dir="ltr">{subtitles}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
