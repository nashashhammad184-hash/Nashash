import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Film, Clapperboard, Users, Archive, LayoutDashboard, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function StudioLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "لوحة التحكم", href: "/", icon: LayoutDashboard },
    { name: "إدارة المشاريع", href: "/projects", icon: Film },
    { name: "قسم الشخصيات", href: "/actors", icon: Users },
    { name: "الأرشيف", href: "/archive", icon: Archive },
    { name: "محرك العوالم", href: "/worlds", icon: Globe },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden" dir="rtl">
      {/* الشريط الجانبي الثابت لبيئة أجهزة سطح المكتب */}
      <aside className="hidden md:flex w-64 flex-col border-l border-border bg-sidebar z-10 shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border shrink-0">
          <Link href="/" className="flex items-center gap-3 text-sidebar-foreground hover:text-primary transition-colors cursor-pointer w-full">
            <div className="bg-primary/10 p-2 rounded-md">
              <Clapperboard className="w-5 h-5 text-primary" />
            </div>
            <span className="font-bold text-lg tracking-wide">ستوديو الذكاء الاصطناعي</span>
          </Link>
        </div>
        <ScrollArea className="flex-1 py-4">
          <nav className="flex flex-col gap-2 px-3">
            <div className="text-xs font-semibold text-sidebar-foreground/50 mb-2 px-3 uppercase tracking-wider">
              الاستوديو
            </div>
            {navigation.map((item) => {
              // التحقق الصارم من النشاط لضمان عدم حدوث stale highlights
              const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
              return (
                <Link key={item.name} href={item.href}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={cn(
                      "w-full justify-start gap-3 h-11 px-3 font-medium transition-all duration-200 cursor-pointer",
                      isActive
                        ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                        : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    )}
                  >
                    <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-sidebar-foreground/50")} />
                    {item.name}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent border border-sidebar-border flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-sidebar-foreground">م.</span>
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-semibold text-sidebar-foreground truncate">المخرج</span>
              <span className="text-xs text-sidebar-foreground/50 truncate">متصل الآن</span>
            </div>
          </div>
        </div>
      </aside>

      {/* منطقة العرض الرئيسية والمحتوى الديناميكي الحركي */}
      <main className="flex-1 flex flex-col relative h-full overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[30vh] bg-gradient-to-b from-primary/5 to-transparent pointer-events-none -z-10" />
        <ScrollArea className="flex-1 h-full">
          <div className="p-4 md:p-8 w-full max-w-[1400px] mx-auto min-h-full min-w-0">
            {/* واجهة الهواتف المحمولة التلقائية التموضع */}
            <div className="md:hidden flex items-center justify-between mb-5 pb-3 border-b border-border">
              <Link href="/projects" className="flex items-center gap-2 text-sidebar-foreground cursor-pointer">
                <div className="bg-primary/10 p-1.5 rounded-md">
                  <Clapperboard className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-bold">Kayan AI Productions</span>
              </Link>
              <span className="text-[10px] font-mono text-muted-foreground/60">MOBILE STUDIO</span>
            </div>
            {children}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
