import { useState } from "react";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Film, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [worldId, setWorldId] = useState("drama");
  const [projectType, setProjectType] = useState("film");
  const [style, setStyle] = useState("drama");

  const { data: projects, isLoading } = useListProjects({ archived: false });
  const createProject = useCreateProject();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("خطأ في التحقق: يرجى إدخال اسم المشروع أولاً.");
      return;
    }

    createProject.mutate({
      data: {
        title: title.trim(),
        synopsis: synopsis.trim() || undefined,
        worldId, projectType, style
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey({ archived: false }) });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setIsDialogOpen(false);
        setTitle("");
        setSynopsis("");
        toast.success("تم إنشاء المشروع السينمائي وتحديث كاش القائمة بنجاح حقيقي.");
      },
      onError: (error: any) => {
        const errMsg = error?.response?.data?.error || error?.message || "فشلت عملية تهيئة خط الإنتاج.";
        toast.error(`خطأ إنتاج: ${errMsg}`);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto text-white">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">استوديو الإنتاج السينمائي</h1>
          <p className="text-zinc-400 mt-1">إدارة وإنتاج مشاريع شركة Kayan AI Productions المعتمدة.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700 text-white gap-2"><Plus className="w-4 h-4" /> مشروع جديد</Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
            <DialogHeader><DialogTitle>إنشاء مشروع إنتاج جديد</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="title">اسم المشروع السينمائي</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: رحلة إلى المستقبل" className="bg-zinc-800 border-zinc-700 text-white" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="synopsis">وصف وتفاصيل العمل</Label>
                <Input id="synopsis" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} placeholder="وصف مختصر لقصة أو إنتاج المشروع..." className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="worldId">المحرك السينمائي</Label>
                  <select id="worldId" value={worldId} onChange={(e) => setWorldId(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white">
                    <option value="drama">عالم الدراما الاجتماعية</option>
                    <option value="history">العالم التاريخي والقديم</option>
                    <option value="noir">عالم الغموض والتحقيق</option>
                    <option value="scifi">العالم المستقبلي</option>
                    <option value="fantasy">عالم الفانتازيا والأساطير</option>
                    <option value="stories">عالم القصص والروايات</option>
                    <option value="children">عالم الأطفال</option>
                    <option value="cartoon">عالم الشخصيات الكرتونية</option>
                    <option value="advertising">عالم الدعاية والإعلان</option>
                    <option value="contemporary">العالم المعاصر</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="projectType">النوع</Label>
                  <select id="projectType" value={projectType} onChange={(e) => setProjectType(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm text-white">
                    <option value="film">فيلم سينمائي (Film)</option>
                    <option value="series">مسلسل رقمي (Series)</option>
                    <option value="commercial">إعلان تجاري (Ad)</option>
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={createProject.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white mt-4 font-bold">
                {createProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "بدء الإنتاج الحقيقي"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      
      {!projects || projects.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800 border-dashed py-12">
          <CardContent className="flex flex-col items-center justify-center text-zinc-500">
            <Film className="w-12 h-12 mb-4 stroke-1 text-zinc-600" />
            <h3 className="text-lg font-medium text-zinc-400 mb-1">لا توجد مشاريع حية</h3>
            <p className="text-sm text-zinc-500">اضغط على زر "مشروع جديد" لبدء خط الإنتاج السينمائي الأول.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.id} onClick={() => window.location.href = `/projects/${project.id}`} className="bg-zinc-900 border-zinc-800 hover:border-red-600/50 transition-all duration-300 group cursor-pointer h-full flex flex-col justify-between rounded-lg border p-6 shadow-md">
              <div className="space-y-1">
                <div className="flex justify-between items-start">
                  <h2 className="text-xl font-bold group-hover:text-red-500 transition-colors text-white line-clamp-1">{project.title}</h2>
                  <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-700 font-mono">ID: {project.id}</span>
                </div>
                <p className="text-sm text-zinc-400 line-clamp-2 mt-2">{project.synopsis || "لا يوجد وصف متوفر لهذا المشروع السينمائي."}</p>
                <div className="mt-3"><span className="text-[11px] bg-red-950/40 text-red-400 border border-red-900/40 px-2 py-0.5 rounded uppercase font-bold tracking-wider">{project.worldId}</span></div>
              </div>
              <div className="pt-4 flex items-center gap-2 text-xs text-zinc-500 mt-4 border-t border-zinc-800/50 font-mono"><Calendar className="w-3.5 h-3.5 text-zinc-600" /><span>خط إنتاج حقيقي نشط</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
