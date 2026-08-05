import { useState } from "react";
import { Project, useListProjectScripts, useGenerateScript, getListProjectScriptsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, PenTool, Sparkles, ScrollText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function WritingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [idea, setIdea] = useState("");
  
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
        worldId: project.worldId 
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

  // Find the latest script to display
  const latestScript = scripts && scripts.length > 0 ? scripts[0] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
      <div className="lg:col-span-1 space-y-6 flex flex-col h-full">
        <Card className="bg-card/40 border-white/5 flex-1 flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <PenTool className="w-5 h-5" />
              المساعد الإبداعي
            </CardTitle>
            <CardDescription>أدخل فكرتك وسيقوم الذكاء الاصطناعي بتحويلها إلى سيناريو احترافي في هذا العالم.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4">
            <Textarea 
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="وصف المشهد... مثلاً: البطل يواجه خصمه لأول مرة في وسط عاصفة ممطرة، وهناك حوار مشحون بالتوتر."
              className="flex-1 bg-background/50 border-white/10 resize-none text-base leading-relaxed"
            />
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
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2 h-full">
        <Card className="bg-card/20 border-white/5 h-full flex flex-col overflow-hidden">
          <CardHeader className="border-b border-white/5 bg-background/30 backdrop-blur-sm shrink-0">
            <CardTitle className="flex justify-between items-center text-lg">
              <span className="flex items-center gap-2"><ScrollText className="w-5 h-5" /> مسودة السيناريو</span>
              {latestScript && (
                <span className="text-xs font-mono text-muted-foreground">
                  نسخة: {new Date(latestScript.createdAt).toLocaleString('en-GB')}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <div className="flex-1 overflow-hidden">
            {latestScript ? (
              <ScrollArea className="h-full w-full">
                <div className="p-8 md:p-12">
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-2xl mx-auto"
                  >
                    <div className="font-mono text-sm text-center text-muted-foreground mb-8 pb-4 border-b border-white/10 uppercase tracking-widest">
                      {project.title} - مسودة مولدة
                    </div>
                    {/* Cinematic script formatting using prose */}
                    <div className="prose prose-invert prose-p:text-lg prose-p:leading-loose text-white/90 whitespace-pre-wrap font-serif" dir="rtl">
                      {latestScript.generatedContent}
                    </div>
                  </motion.div>
                </div>
              </ScrollArea>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center space-y-4">
                <ScrollText className="w-16 h-16 opacity-20" />
                <p className="text-xl">لا يوجد سيناريو بعد.</p>
                <p className="text-sm max-w-sm opacity-70">استخدم المساعد الإبداعي لولادة أول مشهد لك. سيكتب النظام وفقاً لقواعد العالم والشخصيات التي عينتها.</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
