import { useState } from "react";
import { useListActors } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2, Users, Sparkles, Star, Film } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";

// Parse "اسم الاستوديو (المرجع الحقيقي)" → { studioName, referenceName }
function parseActorName(name: string): { studioName: string; referenceName: string } {
  const match = name.match(/^(.+?)\s*\((.+)\)$/);
  if (match) {
    return { studioName: match[1].trim(), referenceName: match[2].trim() };
  }
  return { studioName: name, referenceName: "" };
}

// Placeholder portrait based on actor type — returns a unique gradient seed
function getActorGradient(type: string, id: number): string {
  const gradients: Record<string, string[]> = {
    "نساء":      ["from-rose-900/70 to-red-950/90", "from-purple-900/70 to-rose-950/90", "from-pink-900/70 to-red-900/90"],
    "رجال":      ["from-slate-900/80 to-zinc-950/90", "from-stone-900/70 to-neutral-950/90", "from-gray-900/70 to-slate-950/90"],
    "مراهقين":   ["from-sky-900/70 to-indigo-950/90", "from-blue-900/70 to-slate-950/90"],
    "أطفال":     ["from-amber-900/70 to-orange-950/90", "from-yellow-900/60 to-amber-950/90"],
    "كبار سن":   ["from-emerald-900/60 to-teal-950/90", "from-teal-900/60 to-emerald-950/90"],
  };
  const pool = gradients[type] ?? gradients["رجال"];
  return pool[id % pool.length];
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    "نساء": "♀", "رجال": "♂", "مراهقين": "◈", "أطفال": "◉", "كبار سن": "◆",
  };
  return icons[type] ?? "◎";
}

// Placeholder image URL using DiceBear for cinematic silhouettes
function getPlaceholderImage(id: number, type: string): string {
  const seed = `actor-${id}-kayan`;
  return `https://api.dicebear.com/8.x/personas/svg?seed=${seed}&backgroundColor=0a0a0a&radius=0`;
}

export default function Actors() {
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const { data: actors, isLoading } = useListActors(
    activeFilter !== "all" ? { type: activeFilter } : undefined
  );

  const filters = [
    { id: "all",       label: "الجميع",    count: null },
    { id: "نساء",      label: "نساء",      count: null },
    { id: "رجال",      label: "رجال",      count: null },
    { id: "مراهقين",   label: "مراهقين",   count: null },
    { id: "أطفال",     label: "أطفال",     count: null },
    { id: "كبار سن",   label: "كبار السن", count: null },
  ];

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <Film className="w-12 h-12 text-primary/30" />
          <Loader2 className="w-5 h-5 animate-spin text-primary absolute -bottom-1 -right-1" />
        </div>
        <p className="text-muted-foreground animate-pulse">جاري تحميل سجل الممثلين الرقميين الدائمين...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="relative border-b border-white/5 pb-8">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none rounded-xl" />
        <div className="relative space-y-2">
          <div className="flex items-center gap-3 text-xs font-mono text-primary/60 uppercase tracking-[0.3em] mb-4">
            <span className="w-8 h-px bg-primary/40" />
            Kayan AI Productions
            <span className="w-8 h-px bg-primary/40" />
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight flex items-center gap-4">
            <Users className="w-9 h-9 text-primary shrink-0" />
            قسم الشخصيات
            <span className="text-lg font-normal text-muted-foreground">(Casting Department)</span>
          </h1>
          <p className="text-muted-foreground text-lg mt-3 max-w-2xl">
            السجل الرسمي لـ<span className="text-primary font-bold">31 ممثلاً رقمياً دائماً</span> في استوديو كيان. اختر أبطالك وعيّنهم في مشاريعك السينمائية.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
        {filters.map(filter => (
          <Button
            key={filter.id}
            variant="ghost"
            onClick={() => setActiveFilter(filter.id)}
            className={`rounded-full px-6 py-2 shrink-0 font-semibold transition-all border ${
              activeFilter === filter.id
                ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25"
                : "bg-card/40 border-white/8 text-muted-foreground hover:text-foreground hover:border-white/20"
            }`}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {/* Actor Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        <AnimatePresence mode="popLayout">
          {actors?.map((actor, idx) => {
            const { studioName, referenceName } = parseActorName(actor.name);
            const gradient = getActorGradient(actor.type, actor.id);
            const imageUrl = getPlaceholderImage(actor.id, actor.type);

            return (
              <motion.div
                key={actor.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.025, 0.4) }}
              >
                <div className="group relative rounded-xl overflow-hidden border border-white/8 hover:border-primary/50 transition-all duration-400 cursor-default bg-card/20 hover:bg-card/40 hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-0.5">

                  {/* Portrait Area */}
                  <div className={`relative h-44 sm:h-52 bg-gradient-to-b ${gradient} overflow-hidden`}>
                    {/* Placeholder image */}
                    <img
                      src={imageUrl}
                      alt={studioName}
                      className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-55 group-hover:scale-105 transition-all duration-700"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />

                    {/* Cinematic grain overlay */}
                    <div className="absolute inset-0 opacity-30"
                      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.4'/%3E%3C/svg%3E\")", backgroundSize: "128px 128px" }} />

                    {/* Gradient fade to card */}
                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-card/95 via-card/30 to-transparent" />

                    {/* Type badge top-left */}
                    <div className="absolute top-3 right-3">
                      <span className="text-[10px] font-bold bg-black/70 backdrop-blur-sm text-primary/90 px-2 py-0.5 rounded-full border border-primary/30 uppercase tracking-widest">
                        {getTypeIcon(actor.type)} {actor.type}
                      </span>
                    </div>

                    {/* ID badge top-right */}
                    <div className="absolute top-3 left-3">
                      <span className="text-[10px] font-mono text-white/30">#{String(actor.id).padStart(2, "0")}</span>
                    </div>

                    {/* Age indicator bottom */}
                    <div className="absolute bottom-2 left-3">
                      <span className="text-[10px] font-mono text-white/40">{actor.age} سنة</span>
                    </div>
                  </div>

                  {/* Info area */}
                  <div className="p-3 space-y-2">
                    {/* Studio name (Arabic character name) */}
                    <h3 className="font-black text-base text-foreground group-hover:text-primary transition-colors leading-tight">
                      {studioName}
                    </h3>

                    {/* Real-world reference name */}
                    {referenceName && (
                      <p className="text-[11px] text-muted-foreground/70 font-mono leading-tight flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 text-primary/40 shrink-0" />
                        {referenceName}
                      </p>
                    )}

                    {/* Performance style */}
                    <div className="flex items-start gap-1.5 pt-1 border-t border-white/5">
                      <Sparkles className="w-3 h-3 text-primary/60 mt-0.5 shrink-0" />
                      <span className="text-[11px] text-white/60 leading-snug">{actor.style}</span>
                    </div>
                  </div>

                  {/* Hover glow effect */}
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-400 pointer-events-none ring-1 ring-primary/40 shadow-[inset_0_0_20px_rgba(220,38,38,0.08)]" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      {actors?.length === 0 && (
        <div className="py-24 flex flex-col items-center text-muted-foreground border-2 border-dashed border-white/10 rounded-xl bg-card/10">
          <Users className="w-14 h-14 mb-5 opacity-15" />
          <p className="text-xl font-semibold">لا يوجد ممثلون في هذا الفلتر</p>
          <p className="text-sm mt-2 opacity-60">جرّب فلتراً آخر لعرض الممثلين الرقميين</p>
        </div>
      )}
    </div>
  );
}
