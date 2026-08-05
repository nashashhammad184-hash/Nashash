import { useGetStudioStats, useListProjects, useListWorlds } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Film, Users, Clapperboard, FileText, ArrowLeft, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStudioStats();
  const { data: projects, isLoading: projectsLoading } = useListProjects({ archived: false });
  const { data: worlds } = useListWorlds();

  if (statsLoading || projectsLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p>جاري تحميل بيانات الاستوديو...</p>
      </div>
    );
  }

  const statCards = [
    { title: "المشاريع النشطة", value: stats?.activeProjects || 0, icon: Film, link: "/projects" },
    { title: "الممثلين المتاحين", value: stats?.totalActors || 0, icon: Users, link: "/actors" },
    { title: "السيناريوهات", value: stats?.totalScripts || 0, icon: FileText, link: "/projects" },
    { title: "اللقطات المخططة", value: stats?.totalShots || 0, icon: Clapperboard, link: "/projects" },
  ];

  const recentProjects = projects?.slice(0, 4) || [];

  const getWorldName = (worldId: string) => {
    return worlds?.find(w => w.id === worldId)?.nameAr || worldId;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pre_production': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20">ما قبل الإنتاج</Badge>;
      case 'production': return <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">قيد الإنتاج</Badge>;
      case 'post_production': return <Badge variant="secondary" className="bg-purple-500/10 text-purple-500 hover:bg-purple-500/20">ما بعد الإنتاج</Badge>;
      case 'completed': return <Badge variant="secondary" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">مكتمل</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl md:text-4xl font-black text-foreground tracking-tight">نظرة عامة على الاستوديو</h1>
        <p className="text-muted-foreground text-lg">مرحباً بك أيها المخرج. إليك حالة الإنتاج اليوم.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="bg-card/50 backdrop-blur-sm border-white/5 hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-black text-foreground">{stat.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">أحدث المشاريع</h2>
          <Link href="/projects">
            <Button variant="ghost" className="gap-2 text-primary hover:text-primary hover:bg-primary/10">
              عرض الكل
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {recentProjects.length === 0 ? (
          <Card className="bg-card/30 border-dashed border-white/10">
            <CardContent className="flex flex-col items-center justify-center h-48 gap-4">
              <Film className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">لا توجد مشاريع نشطة حالياً.</p>
              <Link href="/projects">
                <Button>إنشاء مشروع جديد</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {recentProjects.map((project, idx) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + idx * 0.1 }}
              >
                <Link href={`/projects/${project.id}`} className="block h-full">
                  <Card className="h-full bg-card/40 border-white/5 hover:bg-card/60 hover:border-primary/40 transition-all duration-300 group cursor-pointer overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1.5">
                          <CardTitle className="text-xl font-bold group-hover:text-primary transition-colors line-clamp-1">{project.title}</CardTitle>
                          <CardDescription className="flex items-center gap-2 text-xs">
                            <span className="bg-white/10 px-2 py-0.5 rounded text-white/70 font-medium">
                              {getWorldName(project.worldId)}
                            </span>
                          </CardDescription>
                        </div>
                        {getStatusBadge(project.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {project.synopsis || "لا توجد قصة موجزة بعد."}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
