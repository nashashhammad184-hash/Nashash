import { useState } from "react";
import { 
  Project, useListProjectClips, useCreateClip, useDeleteClip,
  getListProjectClipsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Film, Scissors, GripVertical, Trash2, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function EditingTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("5");

  const { data: clips, isLoading } = useListProjectClips(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectClipsQueryKey(project.id) }
  });
  
  const createClip = useCreateClip();
  const deleteClip = useDeleteClip();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const nextOrder = (clips?.length || 0) + 1;

    createClip.mutate({ 
      data: { 
        projectId: project.id, 
        title,
        durationSeconds: parseInt(duration, 10),
        clipOrder: nextOrder
      } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
        setTitle("");
        toast.success("تم إضافة المقطع للتايم لاين");
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteClip.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectClipsQueryKey(project.id) });
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const sortedClips = clips ? [...clips].sort((a, b) => a.clipOrder - b.clipOrder) : [];
  const totalDuration = sortedClips.reduce((acc, clip) => acc + (clip.durationSeconds || 0), 0);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card/20 p-6 rounded-xl border border-white/5">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Scissors className="w-6 h-6 text-primary" /> 
            غرفة المونتاج (Timeline)
          </h2>
          <p className="text-muted-foreground mt-1">ترتيب المقاطع المصورة لإنشاء الفيلم النهائي.</p>
        </div>
        <div className="text-center px-4 py-2 bg-black/40 rounded-lg border border-white/10">
          <div className="text-xs text-muted-foreground mb-1">المدة الإجمالية</div>
          <div className="text-xl font-mono font-bold text-primary">{formatTime(totalDuration)}</div>
        </div>
      </div>

      <Card className="bg-card/40 border-white/5">
        <CardContent className="p-0">
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3 p-4 border-b border-white/10 bg-black/20">
            <Input 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="اسم المقطع..." 
              className="flex-1 bg-background/50 border-white/10"
              required
            />
            <div className="relative w-full md:w-32">
              <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                type="number" 
                min="1"
                value={duration} 
                onChange={e => setDuration(e.target.value)} 
                className="pr-9 bg-background/50 border-white/10"
                required
              />
            </div>
            <Button type="submit" disabled={createClip.isPending} className="shrink-0 gap-2">
              {createClip.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              إضافة مقطع
            </Button>
          </form>

          <div className="p-6">
            {sortedClips.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-muted-foreground border-2 border-dashed border-white/10 rounded-xl">
                <Film className="w-12 h-12 mb-4 opacity-20" />
                <p>التايم لاين فارغ. أضف مقاطع لترتيبها هنا.</p>
              </div>
            ) : (
              <div className="flex overflow-x-auto pb-4 gap-2 snap-x">
                {sortedClips.map((clip, idx) => (
                  <motion.div
                    key={clip.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05 }}
                    className="shrink-0 snap-center"
                  >
                    <div className="w-48 h-32 bg-background border border-white/10 rounded-lg overflow-hidden flex flex-col group relative">
                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="h-6 w-6 rounded"
                          onClick={() => handleDelete(clip.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="h-4 bg-white/5 w-full flex space-x-1 p-1">
                        {/* Film strip holes pattern */}
                        {[...Array(6)].map((_, i) => <div key={i} className="flex-1 bg-background rounded-sm" />)}
                      </div>
                      <div className="flex-1 p-3 flex flex-col justify-center items-center text-center bg-gradient-to-b from-transparent to-primary/5 cursor-grab active:cursor-grabbing">
                        <GripVertical className="w-4 h-4 text-white/20 mb-2" />
                        <span className="font-medium text-white/90 line-clamp-2 text-sm">{clip.title}</span>
                      </div>
                      <div className="h-6 bg-black/60 flex items-center justify-between px-2 text-[10px] font-mono text-muted-foreground border-t border-white/10">
                        <span>#{clip.clipOrder}</span>
                        <span className="flex items-center gap-1 text-primary"><Clock className="w-3 h-3" /> {formatTime(clip.durationSeconds || 0)}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
