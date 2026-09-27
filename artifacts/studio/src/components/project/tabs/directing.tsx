import { useState } from "react";
import {
  Project, useListProjectShots, useCreateShot, useDeleteShot,
  getListProjectShotsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Clapperboard, Clock, Video, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function DirectingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sceneNumber, setSceneNumber] = useState<string>("1");
  const [description, setDescription] = useState("");
  const [cameraMovement, setCameraMovement] = useState("Static (ثابت)");
  const [durationSeconds, setDurationSeconds] = useState<string>("5");
  const [dialogue, setDialogue] = useState("");

  const { data: shots, isLoading } = useListProjectShots(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectShotsQueryKey(project.id) }
  });

  const createShot = useCreateShot();
  const deleteShot = useDeleteShot();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !cameraMovement) {
      toast.error("خطأ: يرجى ملء حقول الوصف المرئي وحركة الكاميرا.");
      return;
    }

    createShot.mutate({
      data: {
        projectId: project.id,
        sceneNumber: parseInt(sceneNumber, 10) || 1,
        description: description.trim(),
        cameraMovement,
        durationSeconds: parseInt(durationSeconds, 10) || 5,
        dialogue: dialogue.trim() || undefined
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(project.id) });
        setIsDialogOpen(false);
        setDescription("");
        setDialogue("");
        toast.success("تم إضافة وحفظ اللقطة الإخراجية في قاعدة البيانات بنجاح حقيقي.");
      },
      onError: (err: any) => {
        toast.error("فشل حفظ اللقطة: " + (err?.message || "خطأ مجهول"));
      }
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("هل أنت متأكد من حذف هذه اللقطة نهائياً من السيناريو؟")) return;
    deleteShot.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectShotsQueryKey(project.id) });
        toast.success("تم حذف اللقطة من قاعدة البيانات بنجاح.");
      },
      onError: (err: any) => {
        toast.error("تعذر مسح اللقطة: " + (err?.message || "خطأ مجهول"));
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const cameraOptions = [
    "Static (ثابت)", "Pan (مسح أفقي)", "Tilt (مسح عمودي)",
    "Dolly (متحرك)", "Tracking (تتبع)", "Crane (رافعة)",
    "Handheld (محمول باليد)", "Drone (طائرة)"
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex justify-between items-center bg-card/20 p-6 rounded-xl border border-white/5">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Clapperboard className="w-6 h-6 text-primary" /> قائمة اللقطات (Shot List)</h2>
          <p className="text-muted-foreground mt-1">تخطيط الكاميرا وحركة المشاهد للتصوير الفعلي.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"><Plus className="w-4 h-4" /> إضافة لقطة</Button>
          </DialogTrigger>
          <DialogContent className="border-zinc-800 bg-zinc-900 text-white sm:max-w-[600px]">
            <DialogHeader><DialogTitle>تفاصيل اللقطة الإخراجية الجديدة</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">رقم المشهد</label>
                  <Input type="number" min="1" value={sceneNumber} onChange={e => setSceneNumber(e.target.value)} required className="bg-zinc-800 border-zinc-700 text-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">المدة (ثواني)</label>
                  <Input type="number" min="1" value={durationSeconds} onChange={e => setDurationSeconds(e.target.value)} required className="bg-zinc-800 border-zinc-700 text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">حركة الكاميرا والزاوية</label>
                <select value={cameraMovement} onChange={e => setCameraMovement(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white" required>
                  {cameraOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">وصف الحدث المرئي التوليدي</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} required className="bg-zinc-800 border-zinc-700 text-white resize-none" rows={3} placeholder="ادخل تفاصيل المشهد، الإضاءة، وحركة الشخصية..." />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">الحوار المنطوق (إن وجد)</label>
                <Textarea value={dialogue} onChange={e => setDialogue(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white resize-none" rows={2} placeholder="نص الحوار للتزامن الصوتي البصري لاحقاً..." />
              </div>
              <DialogFooter className="mt-6 gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={createShot.isPending} className="bg-red-600 hover:bg-red-700 text-white font-bold">{createShot.isPending ? "جاري الحفظ..." : "حفظ اللقطة"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!shots || shots.length === 0 ? (
        <Card className="bg-card/20 border-dashed border-white/10 h-64 flex flex-col items-center justify-center">
          <Video className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-lg">لا توجد لقطات مخططة بعد في قاعدة البيانات.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {shots.map((shot: any, idx: number) => (
            <motion.div key={shot.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(idx * 0.05, 0.4) }}>
              <Card className="bg-card/40 border-r-4 border-r-primary border-t-white/5 border-l-white/5 border-b-white/5 overflow-hidden group">
                <div className="flex flex-col md:flex-row">
                  <div className="bg-black/40 p-4 md:w-32 flex md:flex-col items-center justify-between md:justify-center gap-2 shrink-0 border-b md:border-b-0 md:border-r border-white/10">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground font-mono">SCENE</div>
                      <div className="text-2xl font-black text-white">{shot.sceneNumber}</div>
                    </div>
                    <div className="flex items-center gap-1 text-primary text-xs font-mono bg-primary/10 px-2 py-1 rounded">
                      <Clock className="w-3 h-3" /> {shot.durationSeconds}s
                    </div>
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-2 max-w-3xl">
                        <div className="inline-flex items-center rounded bg-secondary/50 px-2 py-0.5 text-xs font-semibold text-white border border-white/10">
                          <Video className="w-3 h-3 ml-1 text-primary" /> {shot.cameraMovement}
                        </div>
                        <p className="text-white/90 text-md leading-relaxed text-right">{shot.description}</p>
                        {shot.dialogue && (
                          <div className="mt-2 pr-4 border-r-2 border-primary/40 text-zinc-400 italic text-sm">
                            "{shot.dialogue}"
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDelete(shot.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
