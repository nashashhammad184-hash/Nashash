import { useState } from "react";
import { Project, useListProjectScripts, useGenerateScript, getListProjectScriptsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, PenTool, Sparkles, ScrollText, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";

// Separator used by the script engine to split Arabic from English
const EN_SUBTITLE_SEPARATOR = "---ENGLISH_SUBTITLES---";

function splitScriptContent(content: string): { arabic: string; english: string | null } {
  const idx = content.indexOf(EN_SUBTITLE_SEPARATOR);
  if (idx === -1) return { arabic: content, english: null };
  return {
    arabic:  content.slice(0, idx).trim(),
    english: content.slice(idx + EN_SUBTITLE_SEPARATOR.length).trim(),
  };
}

// English Subtitles collapsible panel
function EnglishSubtitlesPanel({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 overflow-hidden mt-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-sky-300/80 hover:text-sky-200 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400/70" />
          English Subtitles — الترجمة المدمجة
          <span className="text-[10px] font-mono text-sky-500/50 bg-sky-500/10 px-2 py-0.5 rounded">
            synchronized
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="overflow-hidden"
          >
            <div className="border-t border-sky-500/15 bg-sky-950/10 px-6 py-5">
              <div className="text-xs font-mono text-sky-500/50 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-6 h-px bg-sky-500/30" />
                Kayan AI Productions — English Subtitle Track
                <span className="w-6 h-px bg-sky-500/30" />
              </div>
              <pre className="text-sky-100/75 text-sm leading-loose font-mono whitespace-pre-wrap" dir="ltr">
                {content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WritingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("1");
  const [targetScenes, setTargetScenes] = useState("2");
  const [genre, setGenre] = useState("cinematic");

  const { data: scripts, isLoading: scriptsLoading } = useListProjectScripts(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectScriptsQueryKey(project.id) }
  });

  const generateScript = useGenerateScript();

  const handleGenerate = () => {
    if (!idea.trim()) {
      toast.error("يجب إدخال فكرة المشهد أولاً");
      return;
    }
    generateScript.mutate({
      data: {
        projectId: project.id,
        idea,
        worldId: project.worldId,
          durationMinutes: Number(durationMinutes),
          targetScenes: Number(targetScenes),
          genre
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectScriptsQueryKey(project.id) });
        setIdea("");
        toast.success("تم توليد السيناريو بنجاح");
      },
      onError: () => {
        toast.error("فشل في توليد السيناريو. تأكد من اتصالك بالذكاء الاصطناعي.");
      }
    });
  };

  if (scriptsLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const latestScript = scripts && scripts.length > 0 ? scripts[0] : null;
  const { arabic: arabicContent, english: englishContent } = latestScript
    ? splitScriptContent(latestScript.generatedContent)
    : { arabic: "", english: null };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[80vh]">
      {/* Left panel — Creative assistant */}
      <div className="lg:col-span-1 space-y-6 flex flex-col h-full">
        <Card className="bg-card/40 border-white/5 flex-1 flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <PenTool className="w-5 h-5" />
              المساعد الإبداعي
            </CardTitle>
            <CardDescription>
              أدخل فكرتك وسيقوم النظام بتحويلها إلى سيناريو احترافي مع موسيقى تصويرية ومؤثرات صوتية وترجمة إنجليزية.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="وصف المشهد... مثلاً: البطل يواجه خصمه لأول مرة في وسط عاصفة ممطرة، وهناك حوار مشحون بالتوتر."
              className="flex-1 bg-background/50 border-white/10 resize-none text-base leading-relaxed"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  مدة الفيلم
                </label>
                <Select value={durationMinutes} onValueChange={setDurationMinutes}>
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue placeholder="المدة" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value} {value === 1 ? "دقيقة" : "دقائق"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  عدد المشاهد
                </label>
                <Select value={targetScenes} onValueChange={setTargetScenes}>
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue placeholder="المشاهد" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 6 }, (_, i) => i + 1).map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value} {value === 1 ? "مشهد" : "مشاهد"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  نوع الفيلم
                </label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue placeholder="النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cinematic">سينمائي</SelectItem>
                    <SelectItem value="science fiction cinematic">خيال علمي</SelectItem>
                    <SelectItem value="action cinematic">أكشن</SelectItem>
                    <SelectItem value="drama cinematic">دراما</SelectItem>
                    <SelectItem value="horror cinematic">رعب</SelectItem>
                    <SelectItem value="fantasy cinematic">فانتازيا</SelectItem>
                    <SelectItem value="documentary cinematic">وثائقي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generateScript.isPending || !idea.trim()}
              className="w-full h-14 text-lg gap-3 bg-gradient-to-r from-primary to-accent hover:from-primary/80 hover:to-accent/80"
            >
              {generateScript.isPending ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> جاري التوليد...</>
              ) : (
                <><Sparkles className="w-5 h-5" /> توليد المشهد</>
              )}
            </Button>

            {/* Feature badges */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: "🎵", label: "موسيقى Udio/Suno" },
                { icon: "🔊", label: "مؤثرات صوتية" },
                { icon: "🎬", label: "5 مشاهد سينمائية" },
                { icon: "🌐", label: "ترجمة إنجليزية" },
              ].map(f => (
                <div key={f.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 bg-white/3 border border-white/5 rounded-lg px-2 py-1.5">
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right panel — Script output */}
      <div className="lg:col-span-2 h-full flex flex-col gap-0">
        <Card className="bg-card/20 border-white/5 flex-1 flex flex-col overflow-hidden">
          <CardHeader className="border-b border-white/5 bg-background/30 backdrop-blur-sm shrink-0">
            <CardTitle className="flex justify-between items-center text-lg">
              <span className="flex items-center gap-2">
                <ScrollText className="w-5 h-5" /> مسودة السيناريو
              </span>
              {latestScript && (
                <div className="flex items-center gap-3">
                  {englishContent && (
                    <span className="text-[10px] font-mono text-sky-400/70 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" /> EN subtitles
                    </span>
                  )}
                  <span className="text-xs font-mono text-muted-foreground">
                    {new Date(latestScript.createdAt).toLocaleString("en-GB")}
                  </span>
                </div>
              )}
            </CardTitle>
          </CardHeader>

          <div className="flex-1 overflow-hidden">
            {latestScript ? (
              <ScrollArea className="h-full w-full">
                <div className="p-6 md:p-10">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-2xl mx-auto"
                  >
                    {/* Script header label */}
                    <div className="font-mono text-sm text-center text-muted-foreground mb-8 pb-4 border-b border-white/10 uppercase tracking-widest">
                      {project.title} — مسودة مولدة · Kayan AI Productions
                    </div>

                    {/* Arabic script (main) */}
                    <div
                      className="prose prose-invert prose-p:text-base prose-p:leading-loose text-white/88 whitespace-pre-wrap font-serif"
                      dir="rtl"
                    >
                      {arabicContent}
                    </div>

                    {/* English subtitle panel — shown if present */}
                    {englishContent && (
                      <EnglishSubtitlesPanel content={englishContent} />
                    )}
                  </motion.div>
                </div>
              </ScrollArea>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center space-y-4">
                <ScrollText className="w-16 h-16 opacity-20" />
                <p className="text-xl">لا يوجد سيناريو بعد.</p>
                <p className="text-sm max-w-sm opacity-70">
                  استخدم المساعد الإبداعي لتوليد أول مشهد. سيتضمن السيناريو موسيقى تصويرية، مؤثرات صوتية، وترجمة إنجليزية متزامنة.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
