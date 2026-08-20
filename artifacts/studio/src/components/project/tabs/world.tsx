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

  // World Bible Specifications
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
    // Fetch existing world bible context if it exists
    fetch(`/api/projects/${project.id}/world-bible`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.worldBible) {
          const wb = data.worldBible;
          setEra(wb.era || ""); setLocation(wb.location || ""); setGeography(wb.geography || "");
          setArchitecture(wb.architecture || ""); setClothingStyle(wb.clothingStyle || "");
          setTechnology(wb.technology || ""); setLighting(wb.lighting || ""); setColorPalette(wb.colorPalette || "");
          setAtmosphere(wb.atmosphere || ""); setWeather(wb.weather || ""); setVisualStyle(wb.visualStyle || "");
          setMasterPrompt(wb.masterPrompt || ""); setNegativePrompt(wb.negativePrompt || "");
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
      if (res.ok) {
        toast.success("تم تحديث وحفظ ميثاق العالم (World Bible) بنجاح");
      }
    } catch {
      toast.error("فشل حفظ بيانات العالم");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-card h-48 flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-background opacity-50" />
        <Globe className="w-24 h-24 text-primary/10 absolute" />
        <div className="relative z-10 text-center space-y-2">
          <h2 className="text-3xl font-black text-white">{world?.nameAr || "محرك العالم"}</h2>
          <p className="text-sm font-mono text-white/60 uppercase tracking-widest">{world?.nameEn}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card/40 border-white/5 shadow-xl">
            <CardHeader>
              <CardTitle className="text-xl text-primary flex items-center gap-2">
                <Sparkles className="w-5 h-5" /> مواصفات البيئة والإنتاج (World Bible)
              </CardTitle>
              <CardDescription>صياغة القواعد الجغرافية والزمنية للمحرك الإبداعي</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">العصر الزمني (Era)</label><Input value={era} onChange={e => setEra(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: العصر الفيكتوري، عام 2050" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">الموقع الجغرافي (Location)</label><Input value={location} onChange={e => setLocation(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: لندن الضبابية، طوكيو السفلية" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">التضاريس (Geography)</label><Input value={geography} onChange={e => setGeography(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: شوارع ضيقة، جبال صخرية" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">النمط المعماري (Architecture)</label><Input value={architecture} onChange={e => setArchitecture(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: قوطي قديم، ناطحات سحاب زجاجية" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">أسلوب الأزياء (Clothing Style)</label><Input value={clothingStyle} onChange={e => setClothingStyle(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: معاطف طويلة داكنة، دروع حديدية" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">المستوى التكنولوجي (Technology)</label><Input value={technology} onChange={e => setTechnology(e.target.value)} className="bg-background/50 border-white/10" placeholder="مثال: بخاري بدائي، ذكاء اصطناعي فائق" /></div>
            </CardContent>
          </Card>

          <Card className="bg-card/40 border-white/5 shadow-xl">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CloudSun className="w-5 h-5 text-primary" /> الغلاف البصري والإضاءة</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">نمط الإضاءة (Lighting)</label><Input value={lighting} onChange={e => setLighting(e.target.value)} className="bg-background/50 border-white/10" placeholder="Low-key, Volumetric" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">لوحة الألوان (Color Palette)</label><Input value={colorPalette} onChange={e => setColorPalette(e.target.value)} className="bg-background/50 border-white/10" placeholder="Amber, Desaturated teal" /></div>
              <div className="space-y-1.5"><label className="text-xs font-medium text-white/70">الطقس الحركي (Weather)</label><Input value={weather} onChange={e => setWeather(e.target.value)} className="bg-background/50 border-white/10" placeholder="عاصفة ممطرة، ضباب كثيف" /></div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card/40 border-white/5">
            <CardHeader><CardTitle className="text-lg">التحكم المركزي في التوليد</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/70">Master Prompt (الـ AI الموجه)</label>
                <Textarea value={masterPrompt} onChange={e => setMasterPrompt(e.target.value)} rows={4} className="bg-background/50 border-white/10 text-xs font-mono" placeholder="Photorealistic, 8k resolution, volumetric smoke..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/70">Negative Prompt (المستبعدات)</label>
                <Textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} rows={3} className="bg-background/50 border-white/10 text-xs font-mono" placeholder="blurry, low quality, custom signatures..." />
              </div>
              <Button onClick={handleSaveWorldBible} disabled={loading} className="w-full gap-2 mt-2">
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
