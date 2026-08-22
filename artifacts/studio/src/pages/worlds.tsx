import { useListWorlds } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Globe, Plus, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function WorldsPage() {
  const { data: worlds, isLoading, isError, refetch } = useListWorlds();

  return (
    <div dir="rtl" className="space-y-8 pb-12">
      <div className="rounded-2xl border border-white/10 bg-card/40 p-6 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Globe className="w-8 h-8 text-primary" />
            محرك العوالم السينمائية
          </h1>
          <p className="text-muted-foreground mt-2">استكشف العوالم الخمسة الأساسية والخيارات الإعلانية المتاحة لقصصك.</p>
        </div>
        <Button onClick={() => toast.info("ميزة إضافة عالم سينمائي جديد جاهزة للربط بالـ API قريباً")} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> إضافة عالم جديد
        </Button>
      </div>

      {isLoading && (
        <div className="w-full h-[40vh] flex flex-col items-center justify-center gap-4 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p>جاري تحميل العوالم من الـ API...</p>
        </div>
      )}

      {isError && (
        <div className="text-center p-12 space-y-4">
          <p className="text-destructive font-bold">فشل الاتصال بـ API العوالم</p>
          <Button onClick={() => refetch()}>إعادة المحاولة</Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {worlds?.map((world, idx) => (
            <motion.div
              key={world.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <Card className="h-full bg-card/40 border-white/5 hover:bg-card/60 hover:border-primary/40 transition-all duration-300 overflow-hidden flex flex-col relative group">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full pointer-events-none transition-all group-hover:bg-primary/10" />
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-primary font-bold uppercase tracking-widest">{world.nameEn}</div>
                    <CardTitle className="text-2xl font-black text-white mt-1">{world.nameAr}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-between pt-2">
                  <p className="text-sm text-muted-foreground leading-relaxed font-medium mb-6">{world.description}</p>
                  <div className="flex items-center justify-between border-t border-white/5 pt-4 text-[11px] font-mono text-muted-foreground/60">
                    <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-primary/40" /> ID: {world.id}</span>
                    <span className="bg-white/5 px-2 py-0.5 rounded text-white/50 text-[10px]">جاهز للربط</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
