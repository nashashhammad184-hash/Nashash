import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, User, Image as ImageIcon, Mic, Drama, FolderOpen, CheckCircle2, AlertTriangle, Plus, Trash2 } from "lucide-react";
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
  // Visual upload
  const [isUploadRefOpen, setIsUploadRefOpen] = useState(false);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refType, setRefType] = useState("primary_portrait");
  const [refIsPrimary, setRefIsPrimary] = useState(false);
  const [isUploadingRef, setIsUploadingRef] = useState(false);
  // Voice upload
  const [isUploadVoiceOpen, setIsUploadVoiceOpen] = useState(false);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voiceRefText, setVoiceRefText] = useState("");
  const [voiceDialect, setVoiceDialect] = useState("أردني");
  const [voiceProjectId, setVoiceProjectId] = useState<string>("");
  const [voiceMakeDefault, setVoiceMakeDefault] = useState(true);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);

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

  // ===== Visual handlers =====
  const handleUploadRef = async () => {
    if (!refFile || !actorId) return;
    setIsUploadingRef(true);
    try {
      const params = new URLSearchParams();
      params.set("reference_type", refType);
      if (refIsPrimary) params.set("is_primary", "true");
      const r = await fetch(`/api/actors/${actorId}/references/upload?${params.toString()}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": refFile.type || "image/jpeg" },
        body: refFile,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({} as any));
        const code = (err as any)?.error || `HTTP_${r.status}`;
        throw new Error(code === "TOO_LARGE" ? "الصورة أكبر من 5MB" : code);
      }
      toast.success("تم رفع الصورة");
      await refetch();
      setIsUploadRefOpen(false);
      setRefFile(null);
      setRefIsPrimary(false);
    } catch (e: any) {
      toast.error(e?.message || "فشل رفع الصورة");
    } finally {
      setIsUploadingRef(false);
    }
  };

  const handleDeleteRef = async (refId: number, isPrimary: boolean) => {
    if (isPrimary && !confirm("هذه الصورة الرئيسية. متأكد من الحذف؟")) return;
    try {
      const r = await axios.delete(`/api/references/${refId}`);
      if (r.status === 204) {
        toast.success("تم حذف الصورة");
        await refetch();
      }
    } catch (e: any) {
      const code = e?.response?.data?.error;
      if (code === "CANNOT_DELETE_PRIMARY") toast.error("لا يمكن حذف الصورة الرئيسية — عيّن صورة بديلة أولاً");
      else toast.error(code || "فشل الحذف");
    }
  };

  const handleSetPrimaryRef = async (refId: number) => {
    try {
      await axios.patch(`/api/references/${refId}/primary`);
      toast.success("تم تعيين الصورة الرئيسية");
      await refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "فشل التعيين");
    }
  };

  // ===== Voice handlers =====
  const handleUploadVoice = async () => {
    if (!voiceFile || !voiceRefText || !actorId || !voiceProjectId) return;
    setIsUploadingVoice(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(voiceFile);
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await axios.post(`/api/actors/${actorId}/voice`, {
          projectId: parseInt(voiceProjectId),
          audioBase64: base64,
          refText: voiceRefText,
          dialect: voiceDialect,
          engine: "audar_flash",
          makeDefault: voiceMakeDefault,
        });
        toast.success("تم حفظ الصوت");
        await refetch();
        setIsUploadVoiceOpen(false);
        setVoiceFile(null);
        setVoiceRefText("");
      };
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "فشل رفع الصوت");
    } finally {
      setIsUploadingVoice(false);
    }
  };

  const handleDeleteVoice = async (voiceId: number) => {
    if (!actorId || !confirm("حذف هذا الملف الصوتي؟")) return;
    try {
      await axios.delete(`/api/actors/${actorId}/voice/${voiceId}`);
      toast.success("تم حذف الصوت");
      await refetch();
    } catch (e: any) {
      const code = e?.response?.data?.error;
      if (code === "VOICE_IN_USE_IN_SHOTS") toast.error("هذا الصوت مستخدم في مشاهد — لا يمكن حذفه");
      else toast.error(code || "فشل الحذف");
    }
  };

  const handleSetDefaultVoice = async (voiceId: number) => {
    if (!actorId) return;
    try {
      await axios.patch(`/api/actors/${actorId}/voice/${voiceId}`, { isDefault: true });
      toast.success("تم تعيين الصوت الافتراضي");
      await refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "فشل التعيين");
    }
  };

  const handlePlaySample = (voiceId: number) => {
    if (!actorId) return;
    const audio = new Audio(`/api/actors/${actorId}/voice/${voiceId}/sample`);
    audio.play().catch(() => toast.error("تعذر تشغيل العينة"));
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

              {/* === VISUAL === */}
              <TabsContent value="visual" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> الصور المرجعية
                    {data?.references?.length > 0 && <span className="text-xs text-muted-foreground">({data.references.length})</span>}
                  </h3>
                  <Button size="sm" variant="outline" onClick={() => setIsUploadRefOpen(true)}><Plus className="w-3 h-3 ml-1" /> رفع صورة</Button>
                </div>
                {data?.references?.length > 0 ? (
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                    {data.references.map((r: any) => (
                      <div key={r.id} className="rounded overflow-hidden border border-border/30 bg-muted flex flex-col">
                        <div className="relative aspect-square">
                          {r.assetUrl ? <img src={r.assetUrl} alt={r.referenceType} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">رابط منتهي</div>}
                          {r.isPrimary && <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold">★ رئيسية</span>}
                          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{r.referenceType || "other"}</span>
                        </div>
                        <div className="flex flex-col gap-1 p-1.5 bg-background/50">
                          {!r.isPrimary && <Button size="sm" variant="secondary" onClick={() => handleSetPrimaryRef(r.id)} className="h-7 text-xs">تعيين رئيسية</Button>}
                          <Button size="sm" variant="destructive" onClick={() => handleDeleteRef(r.id, r.isPrimary)} className="h-7 text-xs"><Trash2 className="w-3 h-3 ml-1" /> حذف</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">لا توجد صور مرجعية بعد. اضغط "رفع صورة" للبدء.</p>
                )}
              </TabsContent>

              {/* === VOICE === */}
              <TabsContent value="voice" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Mic className="w-4 h-4" /> الملفات الصوتية
                    {data?.voices?.length > 0 && <span className="text-xs text-muted-foreground">({data.voices.length})</span>}
                  </h3>
                  {data?.projects?.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setIsUploadVoiceOpen(true)}><Plus className="w-3 h-3 ml-1" /> رفع صوت</Button>
                  )}
                </div>
                {data?.projects?.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center">أضف الممثل لمشروع أولاً لرفع صوت.</p>
                )}
                {data?.voices?.length > 0 ? (
                  <div className="space-y-2">
                    {data.voices.map((v: any) => (
                      <div key={v.id} className="rounded border border-border/30 bg-muted/20 p-3 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{v.dialect} · {v.engine}</p>
                            {v.isDefault && <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">افتراضي</span>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{v.refText || "—"}</p>
                          <p className="text-[10px] text-muted-foreground">مشروع #{v.projectId}</p>
                        </div>
                        <div className="flex gap-1">
                          {v.refWavPath && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handlePlaySample(v.id)}><span className="text-xs">▶</span></Button>}
                          {!v.isDefault && <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleSetDefaultVoice(v.id)}>افتراضي</Button>}
                          <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => handleDeleteVoice(v.id)}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">لا توجد ملفات صوتية بعد.</p>
                )}
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

      {/* Upload Reference Modal */}
      <Dialog open={isUploadRefOpen} onOpenChange={setIsUploadRefOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>📷 رفع صورة مرجعية</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>ملف الصورة (JPEG, PNG, WebP — حد أقصى 5MB)</Label>
              <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setRefFile(e.target.files?.[0] || null)} />
            </div>
            {refFile && <img src={URL.createObjectURL(refFile)} alt="preview" className="max-h-48 mx-auto rounded border border-border/30" />}
            <div>
              <Label>نوع الصورة</Label>
              <select className="w-full h-9 rounded border border-input bg-background px-3 text-sm" value={refType} onChange={(e) => setRefType(e.target.value)}>
                <option value="primary_portrait">وجه رئيسي</option>
                <option value="front_view">أمامي</option>
                <option value="three_quarter">ثلاثة أرباع</option>
                <option value="side_view">جانبي</option>
                <option value="full_body">جسم كامل</option>
                <option value="expression">تعبير</option>
                <option value="other">أخرى</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border/30">
              <input id="ref-primary-new" type="checkbox" checked={refIsPrimary} onChange={(e) => setRefIsPrimary(e.target.checked)} className="h-4 w-4 accent-primary" />
              <Label htmlFor="ref-primary-new" className="text-sm cursor-pointer">اجعلها الصورة الرئيسية</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsUploadRefOpen(false)}>إلغاء</Button>
            <Button onClick={handleUploadRef} disabled={!refFile || isUploadingRef}>{isUploadingRef ? "جاري الرفع..." : "رفع الصورة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Voice Modal */}
      <Dialog open={isUploadVoiceOpen} onOpenChange={setIsUploadVoiceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>🎙️ رفع ملف صوتي</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>المشروع</Label>
              <select className="w-full h-9 rounded border border-input bg-background px-3 text-sm" value={voiceProjectId} onChange={(e) => setVoiceProjectId(e.target.value)}>
                <option value="">— اختر مشروعاً —</option>
                {(data?.projects || []).map((p: any) => (
                  <option key={p.projectId} value={p.projectId}>مشروع #{p.projectId} ({p.roleName})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>ملف الصوت (WAV / MP3)</Label>
              <Input type="file" accept="audio/wav,audio/mpeg" onChange={(e) => setVoiceFile(e.target.files?.[0] || null)} />
            </div>
            <div>
              <Label>النص المنطوق في الملف *</Label>
              <Textarea rows={2} value={voiceRefText} onChange={(e) => setVoiceRefText(e.target.value)} placeholder="اكتب النص بدقة..." />
            </div>
            <div>
              <Label>اللهجة</Label>
              <select className="w-full h-9 rounded border border-input bg-background px-3 text-sm" value={voiceDialect} onChange={(e) => setVoiceDialect(e.target.value)}>
                <option value="أردني">أردني</option>
                <option value="شامي">شامي</option>
                <option value="خليجي">خليجي</option>
                <option value="مصري">مصري</option>
                <option value="فصحى">فصحى</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border/30">
              <input id="voice-default-new" type="checkbox" checked={voiceMakeDefault} onChange={(e) => setVoiceMakeDefault(e.target.checked)} className="h-4 w-4 accent-primary" />
              <Label htmlFor="voice-default-new" className="text-sm cursor-pointer">اجعله الصوت الافتراضي</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsUploadVoiceOpen(false)}>إلغاء</Button>
            <Button onClick={handleUploadVoice} disabled={!voiceFile || !voiceRefText || !voiceProjectId || isUploadingVoice}>{isUploadingVoice ? "جاري الحفظ..." : "حفظ الصوت"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
