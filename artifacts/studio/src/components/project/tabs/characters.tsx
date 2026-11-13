import { useState, useRef } from "react";
import { Project } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Trash2, User, Play, CheckCircle2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

export default function CharactersTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"cast" | "library">("cast");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedActor, setSelectedActor] = useState<any>(null);
  
  // Add to cast state
  const [newActorId, setNewActorId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleType, setRoleType] = useState("supporting");

  // Voice upload state
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [refText, setRefText] = useState("");
  const [dialect, setDialect] = useState("أردني");
  const [isUploading, setIsUploading] = useState(false);

  // --- Fetching ---
  const { data: castData, isLoading: castLoading, refetch: refetchCast } = useQuery({
    queryKey: ["cast", project.id],
    queryFn: async () => (await axios.get(`/api/projects/${project.id}/cast`)).data,
  });

  const { data: libraryData, isLoading: libLoading } = useQuery({
    queryKey: ["library"],
    queryFn: async () => (await axios.get(`/api/actors/library`)).data,
  });

  const { data: actorDetails } = useQuery({
    queryKey: ["actor-details", selectedActor?.actorId],
    queryFn: async () => (await axios.get(`/api/actors/${selectedActor.actorId}`)).data,
    enabled: !!selectedActor?.actorId && isDetailsOpen,
  });

  // --- Mutations ---
  const addToCast = useMutation({
    mutationFn: async () => axios.post(`/api/projects/${project.id}/cast`, {
      actorId: parseInt(newActorId),
      roleName: roleName || "شخصية",
      roleType,
    }),
    onSuccess: () => {
      refetchCast();
      setIsAddOpen(false);
      setNewActorId(""); setRoleName(""); setRoleType("supporting");
      toast.success("أُضيف الممثل للفيلم");
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "خطأ في الإضافة"),
  });

  const removeFromCast = useMutation({
    mutationFn: async (actorId: number) => axios.delete(`/api/projects/${project.id}/cast/${actorId}`),
    onSuccess: () => { refetchCast(); toast.success("أُزيل من الفيلم"); },
    onError: (e: any) => toast.error(e.response?.data?.error || "لا يمكن الإزالة: الممثل مستخدم في مشاهد"),
  });

  const uploadVoice = async () => {
    if (!voiceFile || !refText || !selectedActor) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(voiceFile);
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await axios.post(`/api/actors/${selectedActor.actorId}/voice`, {
          projectId: project.id,
          audioBase64: base64,
          refText,
          dialect,
          engine: "audar_flash",
          makeDefault,
        });
        toast.success("تم حفظ الصوت بنجاح");
        refetchCast();
        setIsVoiceOpen(false);
        setVoiceFile(null); setRefText("");
      };
    } catch (e: any) {
      toast.error(e.response?.data?.error || "فشل الرفع");
    } finally {
      setIsUploading(false);
    }
  };

  const playSample = (voiceId: number, actorId: number) => {
    const audio = new Audio(`/api/actors/${actorId}/voice/${voiceId}/sample`);
    audio.play().catch(() => toast.error("تعذر تشغيل العينة"));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎬 غرفة الممثلين</h2>
          <p className="text-muted-foreground text-sm">
            {castData?.cast?.length || 0} في الفيلم · {libraryData?.actors?.length || 0} في المكتبة
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}><Plus className="w-4 h-4 ml-2" /> إضافة ممثل</Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="cast">Cast الفيلم</TabsTrigger>
          <TabsTrigger value="library">المكتبة العالمية</TabsTrigger>
        </TabsList>

        <TabsContent value="cast" className="mt-4">
          {castLoading ? <Loader2 className="animate-spin mx-auto" /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {castData?.cast?.map((c: any) => (
                <Card key={c.castId} className="overflow-hidden">
                  <CardContent className="p-4 flex gap-4">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {c.imageUrl ? <img src={c.imageUrl} className="w-full h-full object-cover" /> : <User className="w-8 h-8 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold truncate">{c.name}</h3>
                      <p className="text-xs text-muted-foreground">{c.roleName} · {c.roleType}</p>
                      <div className="mt-2 flex items-center gap-2">
                        {c.defaultVoiceId ? (
                          <span className="text-xs flex items-center gap-1 text-green-500 bg-green-500/10 px-2 py-1 rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> {c.defaultEngine}
                          </span>
                        ) : (
                          <span className="text-xs flex items-center gap-1 text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-full">
                            <AlertTriangle className="w-3 h-3" /> يحتاج صوت
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                  <div className="bg-muted/30 px-4 py-2 flex justify-end gap-2 border-t">
                    {c.defaultVoiceId ? (
                      <Button variant="ghost" size="sm" onClick={() => playSample(c.defaultVoiceId, c.actorId)}><Play className="w-3 h-3 mr-1" /> استماع</Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => { setSelectedActor(c); setIsVoiceOpen(true); }}>🎙️ أضف صوتاً</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => { setSelectedActor(c); setIsDetailsOpen(true); }}>التفاصيل</Button>
                    <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => removeFromCast.mutate(c.actorId)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="library" className="mt-4">
          {libLoading ? <Loader2 className="animate-spin mx-auto" /> : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {libraryData?.actors?.map((a: any) => (
                <Card key={a.id} className="overflow-hidden text-center cursor-pointer hover:border-primary transition-colors" onClick={() => { setSelectedActor({...a, actorId: a.id}); setIsDetailsOpen(true); }}>
                  <CardContent className="p-4 flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                      {a.imageUrl ? <img src={a.imageUrl} className="w-full h-full object-cover" /> : <User className="w-8 h-8 text-muted-foreground" />}
                    </div>
                    <h4 className="font-semibold text-sm truncate w-full">{a.name}</h4>
                    <p className="text-xs text-muted-foreground">{a.age} سنة · {a.dialect || 'غير محدد'}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add to Cast Modal */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة ممثل إلى الفيلم</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div><Label>الممثل</Label>
              <Select value={newActorId} onValueChange={setNewActorId}>
                <SelectTrigger><SelectValue placeholder="اختر ممثلاً..." /></SelectTrigger>
                <SelectContent>
                  {libraryData?.actors?.filter((a: any) => !castData?.cast?.some((c: any) => c.actorId === a.id)).map((a: any) => (
                    <SelectItem key={a.id} value={a.id.toString()}>{a.name} ({a.dialect})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>اسم الشخصية في الفيلم</Label><Input value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="مثال: خالد" /></div>
            <div><Label>نوع الدور</Label>
              <Select value={roleType} onValueChange={setRoleType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="protagonist">البطل</SelectItem>
                  <SelectItem value="supporting">مساند</SelectItem>
                  <SelectItem value="extra">إضافي</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={() => addToCast.mutate()} disabled={!newActorId || addToCast.isPending}>إضافة</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voice Upload Modal */}
      <Dialog open={isVoiceOpen} onOpenChange={setIsVoiceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>🎙️ إضافة صوت لـ {selectedActor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div><Label>الملف الصوتي (WAV / MP3)</Label><Input type="file" accept="audio/wav,audio/mpeg" onChange={e => setVoiceFile(e.target.files?.[0] || null)} /></div>
            {voiceFile && <audio controls src={URL.createObjectURL(voiceFile)} className="w-full" />}
            <div><Label>النص المنطوق في الملف *</Label><Textarea value={refText} onChange={e => setRefText(e.target.value)} placeholder="اكتب النص الذي قاله الممثل بدقة..." /></div>
            <div><Label>اللهجة</Label>
              <Select value={dialect} onValueChange={setDialect}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="أردني">أردني</SelectItem>
                  <SelectItem value="شامي">شامي</SelectItem>
                  <SelectItem value="خليجي">خليجي</SelectItem>
                  <SelectItem value="مصري">مصري</SelectItem>
                  <SelectItem value="فصحى">فصحى</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
          <input id="make-default" type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-primary" />
          <Label htmlFor="make-default" className="text-sm cursor-pointer">اجعله الصوت الافتراضي لهذا الممثل</Label>
        </div>
        <DialogFooter><Button onClick={uploadVoice} disabled={!voiceFile || !refText || isUploading}>{isUploading ? "جاري الحفظ..." : "حفظ الصوت"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Actor Details Modal */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{selectedActor?.name}</DialogTitle></DialogHeader>
          <div className="py-4 space-y-6">
            <div className="flex gap-4 items-start">
              <div className="w-24 h-24 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {selectedActor?.imageUrl ? <img src={selectedActor.imageUrl} className="w-full h-full object-cover" /> : <User className="w-10 h-10 text-muted-foreground" />}
              </div>
              <div className="space-y-1">
                <p><span className="text-muted-foreground">العمر:</span> {selectedActor?.age}</p>
                <p><span className="text-muted-foreground">اللهجة:</span> {selectedActor?.dialect || 'غير محدد'}</p>
                <p><span className="text-muted-foreground">الجنس:</span> {selectedActor?.gender || 'غير محدد'}</p>
                <p className="text-sm text-muted-foreground mt-2">{selectedActor?.description}</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-2"><ImageIcon className="w-4 h-4" /> الصور المرجعية</h4>
              {actorDetails?.references?.length ? (
                <div className="grid grid-cols-4 gap-2">
                  {actorDetails.references.map((r: any) => (
                    <img key={r.id} src={r.assetUrl} className={`w-full aspect-square object-cover rounded ${r.isPrimary ? 'ring-2 ring-primary' : ''}`} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">لا توجد صور مرجعية بعد.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
