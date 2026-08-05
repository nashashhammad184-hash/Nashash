import { useState } from "react";
import { useListProjects, useListWorlds, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Film, Search, Clapperboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function Projects() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  // Form State
  const [title, setTitle] = useState("");
  const [worldId, setWorldId] = useState("");
  const [synopsis, setSynopsis] = useState("");

  const { data: projects, isLoading: projectsLoading } = useListProjects({ archived: false });
  const { data: worlds, isLoading: worldsLoading } = useListWorlds();
  
  const createProject = useCreateProject();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !worldId) return;

    createProject.mutate({ data: { title, worldId, synopsis } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey({ archived: false }) });
        setIsDialogOpen(false);
        setTitle("");
        setWorldId("");
        setSynopsis("");
        toast.success("تم إنشاء المشروع بنجاح");
      },
      onError: () => {
        toast.error("حدث خطأ أثناء إنشاء المشروع");
      }
    });
  };

  const filteredProjects = projects?.filter(p => 
    p.title.toLowerCase().includes(search.toLowerCase()) || 
    (p.synopsis && p.synopsis.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  const getWorldName = (wId: string) => {
    return worlds?.find(w => w.id === wId)?.nameAr || wId;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pre_production': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">ما قبل الإنتاج</Badge>;
      case 'production': return <Badge variant="secondary" className="bg-primary/10 text-primary">قيد الإنتاج</Badge>;
      case 'post_production': return <Badge variant="secondary" className="bg-purple-500/10 text-purple-500">ما بعد الإنتاج</Badge>;
      case 'completed': return <Badge variant="secondary" className="bg-green-500/10 text-green-500">مكتمل</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (projectsLoading || worldsLoading) {
    return (
      <div className="w-full h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">إدارة المشاريع</h1>
          <p className="text-muted-foreground mt-1">كل قصصك السينمائية في مكان واحد.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="البحث في المشاريع..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 bg-card/50 border-white/10 focus-visible:ring-primary"
            />
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shrink-0">
                <Plus className="w-4 h-4" />
                مشروع جديد
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] border-white/10 bg-card/95 backdrop-blur-xl">
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold">إنشاء مشروع سينمائي جديد</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">عنوان الفيلم</label>
                  <Input 
                    value={title} 
                    onChange={e => setTitle(e.target.value)} 
                    placeholder="مثال: رحلة إلى المجهول"
                    className="bg-background/50 border-white/10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">العالم السينمائي</label>
                  <Select value={worldId} onValueChange={setWorldId} required>
                    <SelectTrigger className="bg-background/50 border-white/10">
                      <SelectValue placeholder="اختر عالم القصة" />
                    </SelectTrigger>
                    <SelectContent>
                      {worlds?.map(w => (
                        <SelectItem key={w.id} value={w.id}>{w.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">الملخص (اختياري)</label>
                  <Textarea 
                    value={synopsis} 
                    onChange={e => setSynopsis(e.target.value)} 
                    placeholder="اكتب ملخصاً قصيراً للقصة..."
                    className="bg-background/50 border-white/10 min-h-[100px] resize-none"
                  />
                </div>
                <DialogFooter className="mt-6">
                  <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                  <Button type="submit" disabled={createProject.isPending} className="gap-2">
                    {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
                    بدء الإنتاج
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <Card className="bg-card/20 border-dashed border-white/10 h-64 flex flex-col items-center justify-center">
          <Film className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-lg">لم يتم العثور على مشاريع.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project, idx) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/projects/${project.id}`}>
                <Card className="h-full bg-card/40 border-white/5 hover:bg-card/80 hover:border-primary/50 transition-all duration-300 group cursor-pointer overflow-hidden flex flex-col">
                  <div className="h-2 bg-gradient-to-r from-primary/50 to-primary/10 w-0 group-hover:w-full transition-all duration-500 ease-out" />
                  <CardHeader>
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-1">
                        <CardTitle className="text-xl font-bold group-hover:text-primary transition-colors">{project.title}</CardTitle>
                        <CardDescription className="text-xs font-medium text-white/50">
                          عالم: {getWorldName(project.worldId)}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-between">
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-6">
                      {project.synopsis || "لا توجد قصة موجزة. ادخل لكتابة السيناريو وبناء العالم."}
                    </p>
                    <div className="flex items-center justify-between mt-auto">
                      {getStatusBadge(project.status)}
                      <span className="text-xs text-muted-foreground/50 font-mono">
                        {new Date(project.createdAt).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
