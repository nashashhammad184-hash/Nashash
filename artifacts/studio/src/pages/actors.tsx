import { useState } from "react";
import { useListActors } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export default function Actors() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  
  const { data: actors, isLoading } = useListActors(
    activeFilter !== "all" ? { type: activeFilter } : undefined
  );

  const filters = [
    { id: "all", label: "الجميع" },
    { id: "men", label: "رجال" },
    { id: "women", label: "نساء" },
    { id: "teens", label: "مراهقين" },
    { id: "kids", label: "أطفال" },
    { id: "seniors", label: "كبار سن" },
  ];

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">جاري تحميل سجل الممثلين الرقميين...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            قسم الشخصيات (Casting)
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">استعرض الممثلين الرقميين المتوفرين في الاستوديو لتعيينهم في مشاريعك.</p>
        </div>
      </div>

      <div className="flex overflow-x-auto pb-4 hide-scrollbar">
        <div className="flex gap-2">
          {filters.map(filter => (
            <Button
              key={filter.id}
              variant={activeFilter === filter.id ? "default" : "outline"}
              className={`rounded-full px-6 transition-all shrink-0 ${activeFilter === filter.id ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30' : 'bg-card/40 border-white/10 text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
        <AnimatePresence mode="popLayout">
          {actors?.map((actor, idx) => (
            <motion.div
              key={actor.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2, delay: idx * 0.02 }}
            >
              <Card className="h-full bg-card/40 border-white/5 hover:border-primary/40 hover:bg-card/60 transition-all duration-300 group overflow-hidden relative cursor-default">
                <div className="absolute inset-0 bg-gradient-to-t from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="h-32 md:h-40 bg-black/40 flex items-center justify-center relative overflow-hidden border-b border-white/5">
                  {/* Subtle noise texture or placeholder for actor portrait */}
                  <Users className="w-12 h-12 text-white/5 group-hover:scale-110 transition-transform duration-700" />
                  <div className="absolute bottom-2 right-2">
                    <Badge variant="outline" className="bg-background/80 backdrop-blur text-[10px] border-white/10 text-muted-foreground uppercase tracking-widest">
                      {actor.type}
                    </Badge>
                  </div>
                </div>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors mb-1">{actor.name}</h3>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3 font-mono">
                    العمر: <span className="text-white/80">{actor.age}</span>
                  </div>
                  <div className="mt-auto w-full px-2 py-1.5 rounded bg-white/5 border border-white/5 flex items-center justify-center gap-1.5 text-xs text-white/70">
                    <Sparkles className="w-3 h-3 text-primary/70" />
                    {actor.style}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      
      {actors?.length === 0 && (
        <div className="py-20 flex flex-col items-center text-muted-foreground border-2 border-dashed border-white/10 rounded-xl bg-card/20">
          <Users className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-lg">لا يوجد ممثلين يطابقون الفلتر المختار.</p>
        </div>
      )}
    </div>
  );
}
