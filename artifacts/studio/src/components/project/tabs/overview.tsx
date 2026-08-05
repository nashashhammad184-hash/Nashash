import { useState } from "react";
import { Project, useUpdateProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

export default function OverviewTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const updateProject = useUpdateProject();

  const [title, setTitle] = useState(project.title);
  const [synopsis, setSynopsis] = useState(project.synopsis || "");
  const [status, setStatus] = useState(project.status);

  const handleSave = () => {
    updateProject.mutate({ id: project.id, data: { title, synopsis, status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
        toast.success("تم تحديث بيانات المشروع بنجاح");
      },
      onError: () => {
        toast.error("فشل في تحديث بيانات المشروع");
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card className="bg-card/40 border-white/5 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl text-primary">المعلومات الأساسية</CardTitle>
            <CardDescription>البيانات الرئيسية للفيلم</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">عنوان المشروع</label>
              <Input 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                className="bg-background/50 border-white/10 text-lg py-6"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/80">الملخص (اللوجلاين)</label>
              <Textarea 
                value={synopsis} 
                onChange={(e) => setSynopsis(e.target.value)} 
                className="bg-background/50 border-white/10 min-h-[150px] resize-none text-base leading-relaxed"
              />
            </div>
            
            <div className="pt-4 flex justify-end">
              <Button onClick={handleSave} disabled={updateProject.isPending} className="gap-2 px-8">
                {updateProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ التعديلات
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="bg-card/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-lg">حالة الإنتاج</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-background/50 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pre_production">ما قبل الإنتاج</SelectItem>
                <SelectItem value="production">قيد الإنتاج</SelectItem>
                <SelectItem value="post_production">ما بعد الإنتاج</SelectItem>
                <SelectItem value="completed">مكتمل</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              تغيير الحالة سيؤثر على كيفية عرض المشروع في لوحة التحكم الرئيسية والمؤشرات.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/40 border-white/5">
          <CardHeader>
            <CardTitle className="text-lg">معلومات النظام</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>تاريخ الإنشاء:</span>
              <span className="font-mono text-foreground">{new Date(project.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span>معرف المشروع:</span>
              <span className="font-mono text-foreground">PRJ-{project.id.toString().padStart(4, '0')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
