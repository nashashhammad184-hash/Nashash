import { useState } from "react";
import { useRoute } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Settings, Globe, Users, PenTool, Clapperboard, CheckSquare, Film, Archive as ArchiveIcon } from "lucide-react";
import { motion } from "framer-motion";

// Sub-components for tabs
import OverviewTab from "@/components/project/tabs/overview";
import WorldTab from "@/components/project/tabs/world";
import CharactersTab from "@/components/project/tabs/characters";
import WritingTab from "@/components/project/tabs/writing";
import DirectingTab from "@/components/project/tabs/directing";
import ProductionTab from "@/components/project/tabs/production";
import EditingTab from "@/components/project/tabs/editing";
import ArchiveTab from "@/components/project/tabs/archive";

export default function ProjectDetail() {
  const [match, params] = useRoute("/projects/:id");
  const projectId = params?.id ? parseInt(params.id, 10) : 0;
  
  const { data: project, isLoading, error } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });

  const [activeTab, setActiveTab] = useState("overview");

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">جاري تحضير الاستوديو...</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center text-destructive">
        <p>حدث خطأ أثناء تحميل المشروع، أو أنه غير موجود.</p>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "إدارة المشروع", icon: Settings },
    { id: "world", label: "محرك العالم", icon: Globe },
    { id: "characters", label: "قسم الشخصيات", icon: Users },
    { id: "writing", label: "غرفة الكتابة", icon: PenTool },
    { id: "directing", label: "غرفة الإخراج", icon: Clapperboard },
    { id: "production", label: "غرفة الإنتاج", icon: CheckSquare },
    { id: "editing", label: "غرفة المونتاج", icon: Film },
    { id: "archive", label: "الأرشيف", icon: ArchiveIcon },
  ];

  return (
    <div className="space-y-6 pb-12 max-w-6xl mx-auto">
      <div className="flex flex-col gap-2 border-b border-white/5 pb-6">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-primary/50 text-primary uppercase tracking-widest text-[10px]">
            {project.status.replace("_", " ")}
          </Badge>
          {project.isArchived && <Badge variant="destructive">مؤرشف</Badge>}
        </div>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight">{project.title}</h1>
        <p className="text-muted-foreground text-lg">{project.synopsis || "مشروع سينمائي قيد التطوير"}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" dir="rtl">
        <TabsList className="w-full h-auto flex flex-wrap justify-start gap-2 bg-transparent p-0">
          {tabs.map((tab) => (
            <TabsTrigger 
              key={tab.id} 
              value={tab.id}
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary border border-transparent bg-card/50 hover:bg-card/80 transition-all rounded-md px-4 py-2.5 gap-2 h-auto"
            >
              <tab.icon className="w-4 h-4" />
              <span className="font-semibold">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-8 relative">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TabsContent value="overview" className="mt-0 outline-none">
              <OverviewTab project={project} />
            </TabsContent>
            <TabsContent value="world" className="mt-0 outline-none">
              <WorldTab project={project} />
            </TabsContent>
            <TabsContent value="characters" className="mt-0 outline-none">
              <CharactersTab project={project} />
            </TabsContent>
            <TabsContent value="writing" className="mt-0 outline-none">
              <WritingTab project={project} />
            </TabsContent>
            <TabsContent value="directing" className="mt-0 outline-none">
              <DirectingTab project={project} />
            </TabsContent>
            <TabsContent value="production" className="mt-0 outline-none">
              <ProductionTab project={project} />
            </TabsContent>
            <TabsContent value="editing" className="mt-0 outline-none">
              <EditingTab project={project} />
            </TabsContent>
            <TabsContent value="archive" className="mt-0 outline-none">
              <ArchiveTab project={project} />
            </TabsContent>
          </motion.div>
        </div>
      </Tabs>
    </div>
  );
}

// Temporary inline Badge component to avoid missing import
function Badge({ children, variant = "default", className }: { children: React.ReactNode, variant?: string, className?: string }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  const variants: Record<string, string> = {
    default: "bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground border border-input hover:bg-accent hover:text-accent-foreground",
  };
  return <div className={`${base} ${variants[variant] || variants.default} ${className || ""}`}>{children}</div>;
}
