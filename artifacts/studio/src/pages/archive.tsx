import { useListProjects } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Archive as ArchiveIcon, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

export default function Archive() {
  const { data: projects, isLoading } = useListProjects({ archived: true });

  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <ArchiveIcon className="w-8 h-8 text-primary" />
          الأرشيف
        </h1>
        <p className="text-muted-foreground mt-2">المشاريع المؤرشفة يمكن عرضها واستعادتها في أي وقت.</p>
      </div>

      {projects?.length === 0 ? (
        <Card className="bg-card/20 border-dashed border-white/10 h-64 flex flex-col items-center justify-center">
          <ArchiveIcon className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-lg">الأرشيف فارغ.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.map((project, idx) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/projects/${project.id}`}>
                <Card className="h-full bg-card/10 border-white/5 hover:bg-card/30 hover:border-primary/30 transition-all duration-300 cursor-pointer overflow-hidden group">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <CardTitle className="text-xl font-bold opacity-80 group-hover:opacity-100 group-hover:text-primary transition-colors flex items-center gap-2">
                          {project.title}
                          <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </CardTitle>
                        <CardDescription className="text-xs">
                          تمت الأرشفة
                        </CardDescription>
                      </div>
                      <Badge variant="destructive" className="opacity-80">مؤرشف</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {project.synopsis || "لا يوجد ملخص"}
                    </p>
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
