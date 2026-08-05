import { Project, useArchiveProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Archive, Loader2, RefreshCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function ArchiveTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const archiveProject = useArchiveProject();

  const handleToggleArchive = () => {
    const isArchived = !project.isArchived;
    
    archiveProject.mutate({ 
      id: project.id, 
      data: { isArchived } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
        toast.success(isArchived ? "تم أرشفة المشروع" : "تم استعادة المشروع من الأرشيف");
        if (isArchived) {
          setLocation("/projects"); // Redirect to projects list if archived
        }
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <Card className={`border-white/10 ${project.isArchived ? 'bg-card/40' : 'bg-destructive/5'}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {project.isArchived ? <RefreshCcw className="w-5 h-5 text-primary" /> : <Archive className="w-5 h-5 text-destructive" />}
            {project.isArchived ? "استعادة المشروع" : "أرشفة المشروع"}
          </CardTitle>
          <CardDescription>
            {project.isArchived 
              ? "استعادة المشروع ستجعله نشطاً وتسمح بالتعديل عليه مجدداً." 
              : "أرشفة المشروع ستخفيه من قائمة المشاريع النشطة ولوحة التحكم."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-background/50 rounded-lg border border-white/5 mb-6 text-sm text-muted-foreground leading-relaxed">
            ملاحظة: الأرشفة لا تقوم بحذف بيانات المشروع، بل فقط تقوم بإخفائه عن مساحة العمل النشطة. يمكنك دائماً استعادته من صفحة الأرشيف.
          </div>
          
          <Button 
            variant={project.isArchived ? "default" : "destructive"} 
            className="w-full h-12 text-lg font-bold gap-2"
            onClick={handleToggleArchive}
            disabled={archiveProject.isPending}
          >
            {archiveProject.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : project.isArchived ? (
              <><RefreshCcw className="w-5 h-5" /> استعادة إلى مساحة العمل</>
            ) : (
              <><Archive className="w-5 h-5" /> نقل إلى الأرشيف</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
