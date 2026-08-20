import { useMemo, useState } from "react";
import { useListActors } from "@workspace/api-client-react";
import { Search, Users, Loader2, ImageOff, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

function placeholder(id: number) {
  const colors = [
    ["#171717", "#3f3f46"],
    ["#111827", "#374151"],
    ["#1e1b4b", "#4338ca"],
    ["#18181b", "#52525b"],
  ];
  const c = colors[id % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/>
  </linearGradient></defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <circle cx="400" cy="350" r="140" fill="#a1a1aa" opacity=".25"/>
  <path d="M150 900c30-230 130-330 250-330s220 100 250 330"
  fill="#a1a1aa" opacity=".18"/>
  <text x="400" y="850" text-anchor="middle" fill="white"
  opacity=".7" font-family="Arial" font-size="32">KAYAN AI</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function ActorsPage() {
  const { data: actors, isLoading, isError, refetch } = useListActors();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("الكل"); const [type, setType] = useState("الكل");

  const categories = ["الكل", "عرب", "عالميون"];
  const types = useMemo(
    () => ["الكل", ...Array.from(new Set((actors ?? []).map(a => a.type)))],
    [actors]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (actors ?? []).filter(a =>
      ((category === "الكل") || (category === "عرب" && a.category === "arab") || (category === "عالميون" && a.category === "global")) && (type === "الكل" || a.type === type) &&
      (!q ||
        a.name.toLowerCase().includes(q) ||
        a.style.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q))
    );
  }, [actors, search, type]);

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">

        <div className="mb-8 rounded-2xl border border-white/10 bg-card/40 p-6 shadow-xl backdrop-blur-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-xs font-medium tracking-widest text-primary">
                    KAYAN AI PRODUCTIONS
                  </p>
                  <h1 className="text-3xl font-bold">
                    الممثلون الرقميون
                  </h1>
                </div>
              </div>

              <p className="text-sm leading-7 text-muted-foreground">
                مكتبة الممثلين الرقمية الخاصة بالاستوديو.
                اختر الشخصية المناسبة لمشروعك واستكشف بياناتها وأسلوب أدائها.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-background/40 px-5 py-4">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">
                  {actors?.length ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  ممثل رقمي
                </div>
              </div>
            </div>
          </div>
        </div>

        {!isLoading && !isError && (
          <div className="mb-6 space-y-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث باسم الممثل أو النوع أو أسلوب الأداء..."
                className="h-12 border-white/10 bg-card/50 pr-10 text-right"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={
                    "shrink-0 rounded-full border px-4 py-2 text-sm transition-all " +
                    (category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/10 bg-card/40 text-muted-foreground hover:border-primary/40")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {types.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={
                    "shrink-0 rounded-full border px-4 py-2 text-sm transition-all " +
                    (type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/10 bg-card/40 text-muted-foreground hover:border-primary/40")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex min-h-[400px] items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p>جاري تحميل مكتبة الممثلين...</p>
            </div>
          </div>
        )}

        {isError && (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="flex min-h-[250px] flex-col items-center justify-center gap-4 text-center">
              <ImageOff className="h-12 w-12 text-red-400" />
              <h2 className="font-semibold">
                تعذر تحميل الممثلين
              </h2>
              <p className="text-sm text-muted-foreground">
                تأكد من تشغيل API Server ثم حاول مرة أخرى.
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
              >
                إعادة المحاولة
              </button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <Card className="border-dashed border-white/10 bg-card/20">
            <CardContent className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <Search className="mb-4 h-10 w-10 text-muted-foreground/40" />
              <h2 className="text-lg font-semibold">لا توجد نتائج</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                جرّب تغيير كلمة البحث أو الفئة.
              </p>
            </CardContent>
          </Card>
        )}


        {!isLoading && !isError && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((actor, index) => {
              const hasImage = !!actor.imageUrl?.trim();
              const image = hasImage
                ? actor.imageUrl!.trim()
                : placeholder(actor.id);

              return (
                <motion.div
                  key={actor.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: Math.min(index * 0.03, 0.5),
                  }}
                >
                  <Card className="group h-full overflow-hidden border-white/10 bg-card/40 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/10">
                    <div className="relative aspect-[4/5] overflow-hidden bg-muted">
                      <img
                        src={image}
                        alt={actor.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        onError={e => {
                          const img = e.currentTarget;
                          if (!img.dataset.fallback) {
                            img.dataset.fallback = "true";
                            img.src = placeholder(actor.id);
                          }
                        }}
                      />

                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

                      <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white backdrop-blur-md">
                        {actor.type}
                      </div>

                      {!hasImage && (
                        <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-white/70">
                          <ImageOff className="h-3 w-3" />
                          صورة مؤقتة
                        </div>
                      )}

                      <div className="absolute bottom-0 right-0 left-0 p-5">
                        <h2 className="text-xl font-bold text-white">
                          {actor.name}
                        </h2>

                        <p className="mt-2 text-sm text-white/70">
                          العمر: {actor.age} سنة
                        {actor.characterPrompt && (
                          <p className="mt-1 text-[11px] text-white/50 truncate" dir="ltr">
                            Prompt: {actor.characterPrompt}
                          </p>
                        )}
                        </p>
                      </div>
                    </div>

                    <CardContent className="p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        أسلوب الأداء
                      </div>

                      <p className="min-h-[48px] text-sm leading-6 text-muted-foreground">
                        {actor.style}
                      </p>

                      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                        <span className="text-xs text-muted-foreground">
                          Actor ID
                        </span>

                        <span className="rounded-md bg-background/60 px-2 py-1 font-mono text-xs">
                          #{actor.id}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
