import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, User, Image as ImageIcon, Mic, Drama, FolderOpen, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface ActorDnaModalProps {
  actorId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function ActorDnaModal({ actorId, open, onClose }: ActorDnaModalProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("identity");
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<any>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["actor-dna", actorId],
    queryFn: async () => (await axios.get(`/api/actors/${actorId}/dna`)).data,
    enabled: !!actorId && open,
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (data?.actor) {
      setForm({
        name: data.actor.name || "",
        gender: data.actor.gender || "",
        age: data.actor.age || 30,
        description: data.actor.description || "",
        dialect: data.actor.dialect || "",
        personality_traits: data.actor.personalityTraits || "",
        speech_style: data.actor.speechStyle || "",
        behavior: data.actor.behavior || "",
        psychological_traits: data.actor.psychologicalTraits || "",
        background: data.actor.background || "",
      });
    }
    setEditMode(false);
  }, [data?.actor?.id]);

  const saveIdentity = async () => {
    try {
      await axios.patch(`/api/actors/${actorId}`, {
        name: form.name,
        gender: form.gender,
        age: parseInt(form.age) || 30,
        description: form.description,
        dialect: form.dialect,
      });
      toast.success("تم حفظ الهوية");
      setEditMode(false);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "فشل الحفظ");
    }
  };

  const savePerformance = async () => {
    try {
      await axios.patch(`/api/actors/${actorId}`, {
        personalityTraits: form.personality_traits,
        speechStyle: form.speech_style,
        behavior: form.behavior,
        psychologicalTraits: form.psychological_traits,
        background: form.background,
      });
      toast.success("تم حفظ الأداء");
      setEditMode(false);
      await refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "فشل الحفظ");
    }
  };

  if (!open) return null;

  const c = data?.completeness || {};

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>🧬 Actor DNA — {data?.actor?.name || "..."}</span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin w-8 h-8" /></div>
        ) : (
          <>
            {/* Completeness bar */}
            <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">اكتمال DNA</span>
                <span className="font-bold">{c.score || 0}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${c.score || 0}%` }} />
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge ok={c.identity} label="الهوية" />
                <Badge ok={c.description} label="الوصف" />
                <Badge ok={c.visual} label="الصورة الأساسية" />
                <Badge ok={c.references} label={`المراجع (${c.referenceCount || 0})`} />
                <Badge ok={c.voice} label={`الصوت (${c.voiceCount || 0})`} />
                <Badge ok={c.performance} label="الأداء" />
              </div>
              {c.missing && c.missing.length > 0 && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  ⚠️ ناقص: {c.missing.map((m: string) => ({ identity_core: "الهوية", description: "الوصف", primary_visual: "صورة أساسية", reference_images: "صور مرجعية", primary_voice: "صوت افتراضي", performance_dna: "الأداء" } as any)[m] || m).join("، ")}
                </p>
              )}
            </div>

            <Tabs value={tab} onValueChange={setTab} className="mt-4">
              <TabsList className="grid w-full grid-cols-5 h-auto">
                <TabsTrigger value="identity" className="text-xs"><User className="w-3 h-3 ml-1" />الهوية</TabsTrigger>
                <TabsTrigger value="visual" className="text-xs"><ImageIcon className="w-3 h-3 ml-1" />بصري</TabsTrigger>
                <TabsTrigger value="voice" className="text-xs"><Mic className="w-3 h-3 ml-1" />صوت</TabsTrigger>
                <TabsTrigger value="performance" className="text-xs"><Drama className="w-3 h-3 ml-1" />أداء</TabsTrigger>
                <TabsTrigger value="projects" className="text-xs"><FolderOpen className="w-3 h-3 ml-1" />مشاريع</TabsTrigger>
              </TabsList>

              {/* === IDENTITY === */}
              <TabsContent value="identity" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">الهوية الأساسية</h3>
                  {!editMode ? (
                    <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>تعديل</Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>إلغاء</Button>
                      <Button size="sm" onClick={saveIdentity}>حفظ</Button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الاسم</Label><Input value={form.name || ""} onChange={e => setForm({...form, name: e.target.value})} disabled={!editMode} /></div>
                  <div><Label>الجنس</Label>
                    <select className="w-full h-9 rounded border border-input bg-background px-3 text-sm" value={form.gender || ""} onChange={e => setForm({...form, gender: e.target.value})} disabled={!editMode}>
                      <option value="">—</option>
                      <option value="male">ذكر</option>
                      <option value="female">أنثى</option>
                    </select>
                  </div>
                  <div><Label>العمر</Label><Input type="number" value={form.age || 30} onChange={e => setForm({...form, age: e.target.value})} disabled={!editMode} /></div>
                  <div><Label>اللهجة</Label><Input value={form.dialect || ""} onChange={e => setForm({...form, dialect: e.target.value})} disabled={!editMode} placeholder="أردني / فصحى / خليجي..." /></div>
                </div>
                <div><Label>الوصف الأساسي</Label><Textarea rows={3} value={form.description || ""} onChange={e => setForm({...form, description: e.target.value})} disabled={!editMode} placeholder="وصف ثابت للشخصية، يظهر في تعليمات التوليد..." /></div>
              </TabsContent>

              {/* === VISUAL (placeholder — Phase 2b) === */}
              <TabsContent value="visual" className="space-y-4 mt-4">
                <div className="flex justify-center py-8 text-muted-foreground text-sm">قيد التطوير — Phase 2b</div>
              </TabsContent>

              {/* === VOICE (placeholder — Phase 2b) === */}
              <TabsContent value="voice" className="space-y-4 mt-4">
                <div className="flex justify-center py-8 text-muted-foreground text-sm">قيد التطوير — Phase 2b</div>
              </TabsContent>

              {/* === PERFORMANCE === */}
              <TabsContent value="performance" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">الأداء والشخصية</h3>
                  {!editMode ? (
                    <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>تعديل</Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>إلغاء</Button>
                      <Button size="sm" onClick={savePerformance}>حفظ</Button>
                    </div>
                  )}
                </div>
                <div><Label>السمات النفسية</Label><Textarea rows={2} value={form.personality_traits || ""} onChange={e => setForm({...form, personality_traits: e.target.value})} disabled={!editMode} placeholder="هادئ، عنيد، حنون..." /></div>
                <div><Label>أسلوب الكلام</Label><Textarea rows={2} value={form.speech_style || ""} onChange={e => setForm({...form, speech_style: e.target.value})} disabled={!editMode} placeholder="بطيء، متحمس، هامس..." /></div>
                <div><Label>السلوك</Label><Textarea rows={2} value={form.behavior || ""} onChange={e => setForm({...form, behavior: e.target.value})} disabled={!editMode} /></div>
                <div><Label>الخلفية</Label><Textarea rows={3} value={form.background || ""} onChange={e => setForm({...form, background: e.target.value})} disabled={!editMode} /></div>
              </TabsContent>

              {/* === PROJECTS === */}
              <TabsContent value="projects" className="space-y-3 mt-4">
                <h3 className="font-semibold">المشاريع التي تستخدم هذه الشخصية</h3>
                {data?.projects?.length > 0 ? (
                  <div className="space-y-2">
                    {data.projects.map((p: any) => (
                      <div key={p.projectId} className="flex items-center justify-between rounded border border-border/40 bg-muted/10 p-3">
                        <div>
                          <p className="text-sm font-medium">مشروع #{p.projectId}</p>
                          <p className="text-xs text-muted-foreground">الدور: {p.roleName} ({p.roleType})</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">لم تُستخدم هذه الشخصية في أي مشروع بعد.</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"}`}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}
