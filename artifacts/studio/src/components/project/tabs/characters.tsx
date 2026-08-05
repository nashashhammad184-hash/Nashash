import { useState } from "react";
import { 
  Project, useListProjectActors, useListActors, useAssignActorToProject, useRemoveActorFromProject,
  getListProjectActorsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, UserMinus, User, Sparkles, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function CharactersTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedActorId, setSelectedActorId] = useState<string>("");
  const [roleName, setRoleName] = useState("");
  const [roleType, setRoleType] = useState("protagonist");

  const { data: projectActors, isLoading: paLoading } = useListProjectActors(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectActorsQueryKey(project.id) }
  });
  
  const { data: allActors, isLoading: actorsLoading } = useListActors();
  
  const assignActor = useAssignActorToProject();
  const removeActor = useRemoveActorFromProject();

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedActorId || !roleName) return;

    assignActor.mutate({ 
      id: project.id, 
      data: { actorId: parseInt(selectedActorId, 10), roleName, roleType } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectActorsQueryKey(project.id) });
        setIsDialogOpen(false);
        setSelectedActorId("");
        setRoleName("");
        setRoleType("protagonist");
        toast.success("تم تعيين الممثل بنجاح");
      }
    });
  };

  const handleRemove = (actorId: number) => {
    if (!confirm("هل أنت متأكد من إزالة هذا الممثل من المشروع؟")) return;
    removeActor.mutate({ id: project.id, actorId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectActorsQueryKey(project.id) });
        toast.success("تمت الإزالة بنجاح");
      }
    });
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
      <div className="flex justify-between items-center bg-card/20 p-6 rounded-xl border border-white/5">
        <div>
          <h2 className="text-2xl font-bold">طاقم التمثيل</h2>
          <p className="text-muted-foreground mt-1">الممثلون الرقميون المعينون لهذا المشروع.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              تعيين ممثل
            </Button>
          </DialogTrigger>
          <DialogContent className="border-white/10 bg-card/95 backdrop-blur-xl sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>تعيين ممثل للدور</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAssign} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">الممثل (من قائمة الاستوديو)</label>
                <Select value={selectedActorId} onValueChange={setSelectedActorId} required>
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue placeholder="اختر الممثل" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableActors.map(a => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        {a.name} - {a.age} سنة - {a.style}
                      </SelectItem>
                    ))}
                    {availableActors.length === 0 && (
                      <div className="p-2 text-sm text-muted-foreground text-center">لا يوجد ممثلين متاحين</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">اسم الشخصية في القصة</label>
                <Input 
                  value={roleName} 
                  onChange={e => setRoleName(e.target.value)} 
                  placeholder="مثال: القائد طارق"
                  className="bg-background/50 border-white/10"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">نوع الدور</label>
                <Select value={roleType} onValueChange={setRoleType}>
                  <SelectTrigger className="bg-background/50 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="protagonist">{roleLabels["protagonist"]}</SelectItem>
                    <SelectItem value="antagonist">{roleLabels["antagonist"]}</SelectItem>
                    <SelectItem value="supporting">{roleLabels["supporting"]}</SelectItem>
                    <SelectItem value="cameo">{roleLabels["cameo"]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={assignActor.isPending}>
                  {assignActor.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "تعيين للدور"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {projectActors?.length === 0 ? (
        <Card className="bg-card/20 border-dashed border-white/10 h-64 flex flex-col items-center justify-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-lg">لم يتم تعيين أي ممثلين بعد.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projectActors?.map((pa, idx) => (
            <motion.div
              key={pa.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className="h-full bg-card/40 border-white/5 hover:border-primary/30 transition-colors overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="h-8 w-8 rounded-full shadow-lg"
                    onClick={() => handleRemove(pa.actorId)}
                    disabled={removeActor.isPending}
                  >
                    <UserMinus className="w-4 h-4" />
                  </Button>
                </div>
                
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <CardTitle className="text-xl font-bold text-primary">{pa.roleName}</CardTitle>
                      <CardDescription className="text-white/60">
                        {roleLabels[pa.roleType || "supporting"]}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mt-4 p-4 rounded-lg bg-background/50 border border-white/5 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground">{pa.actor?.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {pa.actor?.style} • {pa.actor?.age} سنة
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
