import { useState, useEffect } from "react";
import { useListWorlds, Project } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Globe, Loader2, Save, Sparkles, CloudSun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function WorldTab({ project }: { project: Project }) {
  const { data: worlds, isLoading } = useListWorlds();
  const [loading, setLoading] = useState(false);
  const [era, setEra] = useState("");
  const [location, setLocation] = useState("");
  const [geography, setGeography] = useState("");
  const [architecture, setArchitecture] = useState("");
  const [clothingStyle, setClothingStyle] = useState("");
  const [technology, setTechnology] = useState("");
  const [lighting, setLighting] = useState("");
  const [colorPalette, setColorPalette] = useState("");
  const [atmosphere, setAtmosphere] = useState("");
  const [weather, setWeather] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [masterPrompt, setMasterPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  const world = worlds?.find(w => w.id === project.worldId);

  useEffect(() => {
    fetch(`/api/projects/${project.id}/world-bible`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.success && data.worldBible) {
          const wb = Array.isArray(data.worldBible) ? data.worldBible[0] : data.worldBible;
          if (wb) {
            setEra(wb.era || ""); setLocation(wb.location || ""); setGeography(wb.geography || "");
            setArchitecture(wb.architecture || ""); setClothingStyle(wb.clothingStyle || "");
            setTechnology(wb.technologyLevel || ""); setLighting(wb.lighting || ""); setColorPalette(wb.colorPalette || "");
            setAtmosphere(wb.atmosphere || ""); setWeather(wb.weather || ""); setVisualStyle(wb.visualStyle || "");
            setMasterPrompt(wb.masterPrompt || ""); setNegativePrompt(wb.negativePrompt || "");
          }
        }
      }).catch(() => {});
  }, [project.id]);

  const handleSaveWorldBible = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/world-bible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldId: project.worldId, era, location, geography, architecture,
          clothingStyle, technology, lighting, colorPalette, atmosphere, weather,
          visualStyle, masterPrompt, negativePrompt
        })
      });
      const resData = await res.json();
      if (res.ok && resData.success) {
        toast.success("تم تحديث وحفظ ميثاق العالم (World Bible) في قاعدة البيانات بنجاح.");
      } else {
        throw new Error(resData.error || "فشل التخزين.");
      }
    } catch (err: any) {
      toast.error("فشل حفظ ميثاق البيئة في قاعدة البيانات: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-card h-42 flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-background opacity-50" />
        <Globe className="w-20 h-24 text-primary/10 absolute" />
        <div className="relative z-10 text-center space-y-1">
          <h2 className="text-2xl font-black text-white">{world?.nameAr || "محرك العالم السينمائي"}</h2>
          <p className="text-xs font-mono text-white/50 uppercase tracking-widest">{world?.nameEn || "CINEMATIC ENGINE"}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card/40 border-white/5 shadow-xl">
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
              <div className="space-y-1"><label className="text-xs text-white/70">العصر الزمني (Era)</label><Input value={era} onChange={e => setEra(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="العصر الفيكتوري" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">الموقع الجغرافي (Location)</label><Input value={location} onChange={e => setLocation(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="طوكيو السفلية" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">التضاريس (Geography)</label><Input value={geography} onChange={e => setGeography(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="جبال صخرية" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">النمط المعماري (Architecture)</label><Input value={architecture} onChange={e => setArchitecture(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="ناطحات سحاب" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">أسلوب الأزياء (Clothing Style)</label><Input value={clothingStyle} onChange={e => setClothingStyle(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="معاطف داكنة" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">المستوى التكنولوجي (Technology)</label><Input value={technology} onChange={e => setTechnology(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="ذكاء اصطناعي" /></div>
            </CardContent>
          </Card>
          <Card className="bg-card/40 border-white/5 shadow-xl">
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6">
              <div className="space-y-1"><label className="text-xs text-white/70">الإضاءة (Lighting)</label><Input value={lighting} onChange={e => setLighting(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="Volumetric" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">الألوان (Color Palette)</label><Input value={colorPalette} onChange={e => setColorPalette(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="Teal and Amber" /></div>
              <div className="space-y-1"><label className="text-xs text-white/70">الطقس (Weather)</label><Input value={weather} onChange={e => setWeather(e.target.value)} className="bg-background/50 border-white/10 text-white text-sm" placeholder="ضباب كثيف" /></div>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="bg-card/40 border-white/5">
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <label className="text-xs text-white/70">Master Prompt (الـ AI الموجه)</label>
                <Textarea value={masterPrompt} onChange={e => setMasterPrompt(e.target.value)} rows={3} className="bg-background/50 border-white/10 text-xs font-mono text-white" placeholder="Photorealistic..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-white/70">Negative Prompt (المستبعدات)</label>
                <Textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} rows={2} className="bg-background/50 border-white/10 text-xs font-mono text-white" placeholder="blurry..." />
              </div>
              <Button onClick={handleSaveWorldBible} disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-white font-bold gap-2 mt-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ الـ World Bible
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
