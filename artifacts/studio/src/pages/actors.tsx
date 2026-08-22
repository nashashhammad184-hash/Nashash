import { useMemo, useState } from "react";
import { useListActors } from "@workspace/api-client-react";
import { Search, Users, Loader2, ImageOff, Sparkles, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { toast } from "sonner";

function placeholder(id: number) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://w3.org" width="800" height="1000"><rect width="800" height="1000" fill="#18181b"/><text x="400" y="500" text-anchor="middle" fill="white" opacity=".3" font-family="Arial" font-size="32">KAYAN AI</text></svg>`)}`;
}

export default function ActorsPage() {
  const { data: actors, isLoading, isError, refetch } = useListActors();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("الكل");
  const [type, setType] = useState("الكل");

  const categories = ["الكل", "عرب", "عالميون"];
  const types = useMemo(() => ["الكل", ...Array.from(new Set((actors ?? []).map(a => a.type)))], [actors]);

  const filteredArab = useMemo(() => (actors ?? []).filter(a => a.category === "arab" && (type === "الكل" || a.type === type) && (!search.trim() || a.name.toLowerCase().includes(search.toLowerCase()) || a.style.toLowerCase().includes(search.toLowerCase()))), [actors, search, type]);
  const filteredGlobal = useMemo(() => (actors ?? []).filter(a => a.category === "global" && (type === "الكل" || a.type === type) && (!search.trim() || a.name.toLowerCase().includes(search.toLowerCase()) || a.style.toLowerCase().includes(search.toLowerCase()))), [actors, search, type]);

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground p-4">
      <div className="flex justify-between items-center mb-6 bg-card/40 p-6 rounded-xl border border-white/10">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="text-primary" /> الممثلون الرقميون</h1>
          <p className="text-xs text-muted-foreground mt-1">مكتبة كيان للإنتاج الفني (Kayan AI Productions)</p>
        </div>
        <Button onClick={() => toast.info("ميزة إضافة فنان جديد جاهزة للربط قريباً")} className="gap-2"><Plus className="h-4 w-4" /> إضافة فنان</Button>
      </div>

      <div className="mb-6 space-y-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم الممثل أو أسلوب الأداء..." className="bg-card/50 border-white/10" />
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex gap-2 items-center"><span>الجنسية:</span>{categories.map(c => <button key={c} onClick={() => setCategory(c)} className={"px-3 py-1 rounded-full border " + (category === c ? "bg-primary text-white" : "border-white/10")}>{c}</button>)}</div>
          <div className="flex gap-2 items-center"><span>الفئة:</span>{types.map(t => <button key={t} onClick={() => setType(t)} className={"px-3 py-1 rounded-full border " + (type === t ? "bg-primary text-white" : "border-white/10")}>{t}</button>)}</div>
        </div>
      </div>

      {isLoading && <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>}
      {isError && <div className="text-center p-6 text-destructive">خطأ في الاتصال بالخادم</div>}

      {!isLoading && !isError && (
        <div className="space-y-8">
          {(category === "الكل" || category === "عرب") && (
            <div>
              <h2 className="text-lg font-bold text-white mb-4 border-r-4 border-primary pr-2">🟢 الفنانين العرب ({filteredArab.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredArab.map(actor => (
                  <Card key={actor.id} className="bg-card/40 border-white/10 overflow-hidden">
                    <div className="aspect-[4/5] bg-muted relative"><img src={actor.imageUrl || placeholder(actor.id)} alt={actor.name} className="w-full h-full object-cover" /><div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white">{actor.type}</div></div>
                    <CardContent className="p-3">
                      <h3 className="font-bold text-white truncate">{actor.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">العمر: {actor.age} سنة</p>
                      <p className="text-xs text-primary mt-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> {actor.style}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {(category === "الكل" || category === "عالميون") && (
            <div>
              <h2 className="text-lg font-bold text-white mb-4 border-r-4 border-primary pr-2">🌐 الفنانين العالميين ({filteredGlobal.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredGlobal.map(actor => (
                  <Card key={actor.id} className="bg-card/40 border-white/10 overflow-hidden">
                    <div className="aspect-[4/5] bg-muted relative"><img src={actor.imageUrl || placeholder(actor.id)} alt={actor.name} className="w-full h-full object-cover" /><div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white">{actor.type}</div></div>
                    <CardContent className="p-3">
                      <h3 className="font-bold text-white truncate">{actor.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">العمر: {actor.age} سنة</p>
                      <p className="text-xs text-primary mt-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> {actor.style}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
