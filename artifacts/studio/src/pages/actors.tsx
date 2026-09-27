import { useMemo, useState } from "react";
import { useListActors, getListActorsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Search, Users, Loader2, ImageOff, Sparkles, Plus, Edit2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { motion } from "framer-motion";

function placeholder(id: number) {
  const colors = [["#171717", "#3f3f46"], ["#111827", "#374151"], ["#1e1b4b", "#4338ca"], ["#18181b", "#52525b"]];
  const c = colors[id % colors.length];
  const svg = `<svg xmlns="http://w3.org" width="800" height="1000"><rect width="800" height="1000" fill="${c[0]}"/><text x="400" y="500" text-anchor="middle" fill="white" opacity=".4" font-family="Arial" font-size="40">KAYAN AI ACTOR</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function ActorsPage() {
  const queryClient = useQueryClient();
  const { data: actors, isLoading, isError, refetch } = useListActors();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("الكل");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedActor, setSelectedActor] = useState<any>(null);

  const [name, setName] = useState("");
  const [actorType, setActorType] = useState("عربي");
  const [age, setAge] = useState("30");
  const [style, setStyle] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const types = useMemo(() => ["الكل", ...Array.from(new Set((actors ?? []).map(a => a.type)))], [actors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (actors ?? []).filter(a =>
      (type === "الكل" || a.type === type) &&
      (!q || a.name.toLowerCase().includes(q) || a.style.toLowerCase().includes(q) || a.type.toLowerCase().includes(q))
    );
  }, [actors, search, type]);

  const createMutation = useMutation({
    mutationFn: (data: any) => axios.post("/api/actors", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListActorsQueryKey() });
      setIsCreateOpen(false);
      toast.success("تم تسجيل الممثل الرقمي في قاعدة البيانات.");
    },
    onError: () => toast.error("فشل إنشاء الممثل.")
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => axios.patch(`/api/actors/${data.id}`, data.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListActorsQueryKey() });
      setIsEditOpen(false);
      toast.success("تم تحديث أسلوب أداء الممثل بنجاح.");
    },
    onError: () => toast.error("فشل تعديل بيانات الممثل.")
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/actors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListActorsQueryKey() });
      toast.success("تم حذف الممثل وإلغاء عقده الرقمي.");
    },
    onError: () => toast.error("تعذر حذف سجل الممثل.")
  });

  const openCreateDialog = () => {
    setName(""); setActorType("عربي"); setAge("30"); setStyle(""); setImageUrl("");
    setIsCreateOpen(true);
  };

  const openEditDialog = (actor: any) => {
    setSelectedActor(actor);
    setName(actor.name); setActorType(actor.type); setAge(String(actor.age)); setStyle(actor.style); setImageUrl(actor.imageUrl || "");
    setIsEditOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !style.trim()) return;
    createMutation.mutate({ name, type: actorType, age: parseInt(age, 10), style, imageUrl: imageUrl.trim() || null });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedActor || !name.trim() || !style.trim()) return;
    editMutation.mutate({
      id: selectedActor.id,
      payload: { name, type: actorType, age: parseInt(age, 10), style, imageUrl: imageUrl.trim() || null }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 rounded-2xl border border-white/10 bg-card/40 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">الممثلون الرقميون</h1>
          </div>
          <Button onClick={openCreateDialog} className="bg-red-600 hover:bg-red-700 text-white font-bold gap-2">
            <Plus className="w-4 h-4" /> إضافة ممثل جديد
          </Button>
        </div>

        {!isError && (
          <div className="mb-6 space-y-4">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم الممثل أو النوع أو أسلوب الأداء..." className="h-11 border-white/10 bg-card/50 text-white pr-4" />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {types.map(t => (
                <button key={t} type="button" onClick={() => setType(t)} className={"shrink-0 rounded-full border px-4 py-1.5 text-xs transition-all " + (type === t ? "border-primary bg-primary text-white" : "border-white/10 bg-card/40 text-zinc-400")}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {isError && (
          <div className="text-center py-12">
            <p className="text-destructive font-bold">تعذر جلب سجلات الممثلين</p>
            <Button onClick={() => refetch()} className="mt-4 bg-primary text-white">إعادة المحاولة</Button>
          </div>
        )}

        {!isError && filtered.length === 0 && (
          <p className="text-center text-zinc-500 py-12">لا توجد شخصيات مطابقة للمواصفات.</p>
        )}

        {!isError && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((actor) => {
              const image = actor.imageUrl || placeholder(actor.id);
              return (
                <Card key={actor.id} className="group overflow-hidden border-white/10 bg-card/40 hover:border-primary/40 transition-all duration-300 relative">
                  <div className="relative aspect-[4/5] overflow-hidden bg-zinc-950">
                    <img src={image} alt={actor.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => { e.currentTarget.src = placeholder(actor.id); }} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    
                    <div className="absolute left-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 z-20">
                      <Button size="icon" className="h-7 w-7 bg-zinc-800 text-white hover:bg-zinc-700" onClick={() => openEditDialog(actor)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => confirm("هل أنت متأكد من حذف هذا الممثل تماماً؟") && deleteMutation.mutate(actor.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>

                    <div className="absolute bottom-0 right-0 left-0 p-4">
                      <h2 className="text-lg font-bold text-white">{actor.name}</h2>
                      <p className="text-xs text-zinc-400 mt-1">العمر: {actor.age} سنة | {actor.type}</p>
                    </div>
                  </div>
                  <CardContent className="p-3">
                    <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{actor.style}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Create Form Modal */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
            <DialogHeader><DialogTitle>إضافة ممثل جديد</DialogTitle></DialogHeader>
            <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
              <div><Label>اسم الممثل</Label><Input value={name} onChange={e => setName(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" placeholder="مثال: سارة أحمد" required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>الفئة</Label><select value={actorType} onChange={e => setActorType(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-white"><option value="عربي">عربي / شرقي</option><option value="عالمي">عالمي / غربي</option><option value="كرتوني">أنيميشن</option></select></div>
                <div><Label>العمر</Label><Input type="number" value={age} onChange={e => setAge(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" required /></div>
              </div>
              <div><Label>رابط الصورة</Label><Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" placeholder="https://example.com" /></div>
              <div><Label>أسلوب الأداء والوصف</Label><Input value={style} onChange={e => setStyle(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" placeholder="صوت عميق، نظرات غامضة، درامي حاد..." required /></div>
              <Button type="submit" disabled={createMutation.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold mt-2">{createMutation.isPending ? "جاري الحفظ..." : "بدء تسجيل الممثل"}</Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit Form Modal */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
            <DialogHeader><DialogTitle>تحديث أسلوب أداء الممثل</DialogTitle></DialogHeader>
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
              <div><Label>اسم الممثل</Label><Input value={name} onChange={e => setName(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" required /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>النوع</Label><select value={actorType} onChange={e => setActorType(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-white"><option value="عربي">عربي / شرقي</option><option value="عالمي">عالمي / غربي</option><option value="كرتوني">أنيميشن</option></select></div>
                <div><Label>العمر</Label><Input type="number" value={age} onChange={e => setAge(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" required /></div>
              </div>
              <div><Label>رابط الصورة</Label><Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" /></div>
              <div><Label>أسلوب الأداء والوصف</Label><Input value={style} onChange={e => setStyle(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" required /></div>
              <Button type="submit" disabled={editMutation.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold mt-2">{editMutation.isPending ? "جاري التحديث..." : "تأكيد وحفظ التغييرات"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
