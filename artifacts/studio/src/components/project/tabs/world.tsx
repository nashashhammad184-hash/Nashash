import { useListWorlds, Project } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Loader2 } from "lucide-react";

export default function WorldTab({ project }: { project: Project }) {
  const { data: worlds, isLoading } = useListWorlds();

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const world = worlds?.find(w => w.id === project.worldId);

  if (!world) {
    return (
      <Card className="bg-card/40 border-white/5">
        <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground">
          <Globe className="w-12 h-12 mb-4 opacity-20" />
          <p>لم يتم العثور على بيانات هذا العالم.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative rounded-xl overflow-hidden border border-white/10 bg-card h-64 md:h-80 flex items-center justify-center">
        {/* Placeholder for world image/concept art */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-background opacity-50" />
        <Globe className="w-32 h-32 text-primary/20 absolute" />
        <div className="relative z-10 text-center space-y-4 max-w-2xl px-6">
          <h2 className="text-4xl md:text-5xl font-black text-white drop-shadow-lg">{world.nameAr}</h2>
          <p className="text-xl font-mono text-white/70 uppercase tracking-widest">{world.nameEn}</p>
        </div>
      </div>

      <Card className="bg-card/40 border-white/5 shadow-xl">
        <CardHeader>
          <CardTitle className="text-2xl text-primary">قواعد العالم وقوانينه</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-invert max-w-none text-muted-foreground leading-loose text-lg font-medium">
            <p className="whitespace-pre-wrap">{world.description}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
