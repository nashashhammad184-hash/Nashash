import { useState } from "react";
import { 
  Project, useListProjectTasks, useCreateTask, useUpdateTask, useDeleteTask, useListProjectActors,
  getListProjectTasksQueryKey, getListProjectActorsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, CheckCircle2, Circle, Trash2, Calendar, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ProductionTab({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [assignedActorId, setAssignedActorId] = useState("unassigned");

  const { data: tasks, isLoading } = useListProjectTasks(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectTasksQueryKey(project.id) }
  });
  
  const { data: projectActors } = useListProjectActors(project.id, {
    query: { enabled: !!project.id, queryKey: getListProjectActorsQueryKey(project.id) }
  });

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createTask.mutate({ 
      data: { 
        projectId: project.id, 
        title,
        status: "pending",
        assignedActorId: assignedActorId !== "unassigned" ? parseInt(assignedActorId, 10) : undefined
      } 
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) });
        setTitle("");
        setAssignedActorId("unassigned");
        toast.success("تمت إضافة المهمة");
      }
    });
  };

  const toggleStatus = (taskId: number, currentStatus: string) => {
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    updateTask.mutate({ id: taskId, data: { status: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteTask.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectTasksQueryKey(project.id) });
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const getActorName = (id: number) => {
    return projectActors?.find(pa => pa.actorId === id)?.actor?.name || "غير معروف";
  };

  const completedCount = tasks?.filter(t => t.status === "completed").length || 0;
  const totalCount = tasks?.length || 0;
  const progress = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="bg-card/20 p-6 rounded-xl border border-white/5 space-y-4">
        <div className="flex justify-between items-end mb-2">
          <div>
            <h2 className="text-2xl font-bold">مهام الإنتاج</h2>
            <p className="text-muted-foreground mt-1">قائمة المراجعة لضمان جاهزية كل شيء.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-primary">{progress}%</div>
            <div className="text-xs text-muted-foreground">مكتمل</div>
          </div>
        </div>
        
        <div className="w-full h-2 bg-background rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      <Card className="bg-card/40 border-white/5 overflow-hidden">
        <CardContent className="p-0">
          <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3 p-4 border-b border-white/10 bg-black/20">
            <Input 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              placeholder="إضافة مهمة جديدة..." 
              className="flex-1 bg-background/50 border-white/10 h-12"
            />
            <Select value={assignedActorId} onValueChange={setAssignedActorId}>
              <SelectTrigger className="w-full md:w-[200px] h-12 bg-background/50 border-white/10">
                <SelectValue placeholder="الممثل المكلف" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">غير مكلف بممثل</SelectItem>
                {projectActors?.map(pa => (
                  <SelectItem key={pa.actorId} value={pa.actorId.toString()}>
                    {pa.actor?.name} ({pa.roleName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createTask.isPending || !title.trim()} className="h-12 px-6">
              {createTask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-5 h-5" />}
            </Button>
          </form>

          <div className="flex flex-col">
            {tasks?.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                لا توجد مهام حالياً. ابدأ بإضافة مهام للإنتاج.
              </div>
            ) : (
              tasks?.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 border-b border-white/5 hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-4 flex-1">
                    <button onClick={() => toggleStatus(task.id, task.status)} className="shrink-0 transition-transform hover:scale-110">
                      {task.status === "completed" ? (
                        <CheckCircle2 className="w-6 h-6 text-primary" />
                      ) : (
                        <Circle className="w-6 h-6 text-muted-foreground" />
                      )}
                    </button>
                    <div className={`flex-1 transition-all ${task.status === "completed" ? "opacity-50 line-through" : ""}`}>
                      <p className="text-lg font-medium text-white/90">{task.title}</p>
                      {task.assignedActorId && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <User className="w-3 h-3" /> المكلف: {getActorName(task.assignedActorId)}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {task.dueDate && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1 bg-white/5 px-2 py-1 rounded">
                        <Calendar className="w-3 h-3" /> {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={() => handleDelete(task.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
