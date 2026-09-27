import { useState } from "react";
import {
  Project,
  useListProjectActors,
  useListActors,
  getListProjectActorsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";

export default function CharactersTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState<string>("");
  const [roleName, setRoleName] = useState("");
  const [roleType, setRoleType] = useState("protagonist");

  const { data: projectActors, isLoading: paLoading } = useListProjectActors(project?.id, {
    query: { enabled: !!project?.id, queryKey: getListProjectActorsQueryKey(project?.id) }
  });
  const { data: allActors, isLoading: actorsLoading } = useListActors();
  
  // الـ Mutations الصارمة للتفاعل الفعلي مع جداول العلاقات في قاعدة البيانات
  const assignMutation = useMutation({
    mutationFn: (data: any) => axios.post(`/api/projects/${project.id}/actors`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListProjectActorsQueryKey(project.id) });
      setIsDialogOpen(false);
      setSelectedActorId("");
      setRoleName("");
      setRoleType("protagonist");
      toast.success("تم تعيين الشخصية وحفظ سجل العلاقة الرقمية في قاعدة البيانات.");
    },
    onError: (error: any) => {
      toast.error("فشل تعيين الشخصية: " + (error?.response?.data?.error || error?.message));
    }
  });

  const removeMutation = useMutation({
    mutationFn: (actorId: number) => axios.delete(`/api/projects/${project.id}/actors/${actorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListProjectActorsQueryKey(project.id) });
      toast.success("تمت إزالة الشخصية من طاقم المشروع حقيقياً.");
    },
    onError: () => toast.error("تعذر مسح سجل الشخصية من السيرفر.")
  });

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedActorId || !roleName.trim() || !project?.id) return;
    assignMutation.mutate({ actorId: parseInt(selectedActorId, 10), roleName: roleName.trim(), roleType });
  };

  const availableActors = allActors?.filter(a => !projectActors?.some(pa => pa.actorId === a.id)) || [];

  if (paLoading || actorsLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const roleLabels: Record<string, string> = {
    protagonist: "البطل (Protagonist)",
    antagonist: "الخصم (Antagonist)",
    supporting: "دور مساعد (Supporting)",
    cameo: "ضيف شرف (Cameo)"
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-white">طاقم الممثلين والشخصيات</h3>
          <p className="text-sm text-zinc-400">إدارة الممثلين الرقميين وأدوارهم السينمائية داخل المشروع.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2 bg-red-600 hover:bg-red-700 text-white">
              <Plus className="w-4 h-4" /> إضافة شخصية للمشروع
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
            <DialogHeader><DialogTitle>تعيين ممثل للمشروع</DialogTitle></DialogHeader>
            <form onSubmit={handleAssign} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>اختر الممثل الرقمي</Label>
                <select value={selectedActorId} onChange={e => setSelectedActorId(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white" required>
                  <option value="">اختر ممثلاً من القائمة...</option>
                  {availableActors.map((actor) => (
                    <option key={actor.id} value={actor.id}>{actor.name} ({actor.age} سنة)</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>اسم الشخصية (في السكربت)</Label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="مثال: القائد أحمد" className="bg-zinc-800 border-zinc-700 text-white" required />
              </div>
              <div className="space-y-2">
                <Label>نوع الدور السينمائي</Label>
                <select value={roleType} onChange={e => setRoleType(e.target.value)} className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-white">
                  <option value="protagonist">البطل الرئيسي</option>
                  <option value="antagonist">الخصم / الشرير</option>
                  <option value="supporting">دور مساعد</option>
                  <option value="cameo">ضيف شرف</option>
                </select>
              </div>
              <Button type="submit" disabled={assignMutation.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold mt-2">
                {assignMutation.isPending ? "جاري الحفظ والربط..." : "تأكيد تعيين الشخصية"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {!projectActors || projectActors.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <User className="w-12 h-12 mb-4 stroke-1" />
            <p>لا يوجد ممثلين معينين لهذا المشروع حتى الآن.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projectActors.map((pa) => {
            const actorDetail = allActors?.find(a => a.id === pa.actorId);
            return (
              <Card key={pa.id} className="bg-zinc-900 border-zinc-800 overflow-hidden group">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold overflow-hidden border border-zinc-700">
                      {actorDetail?.imageUrl ? (
                        <img src={actorDetail.imageUrl} alt={actorDetail.name} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium text-white">{actorDetail?.name || "ممثل رقمي"}</h4>
                      <p className="text-xs text-red-400 font-medium">{pa.roleName}</p>
                      <p className="text-[10px] text-zinc-500">{roleLabels[pa.roleType] || pa.roleType}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeMutation.mutate(pa.actorId)} className="text-zinc-500 hover:text-red-400 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
