import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as SonnerToaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { useEffect } from 'react';
import { StudioLayout } from '@/components/layout';
import Dashboard from '@/pages/dashboard';
import Projects from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import Actors from '@/pages/actors';
import Archive from '@/pages/archive';
import WorldsPage from '@/pages/worlds';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    }
  }
});

function Router() {
  return (
    <StudioLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/actors" component={Actors} />
        <Route path="/archive" component={Archive} />
        <Route path="/worlds" component={WorldsPage} />
        <Route component={NotFound} />
      </Switch>
    </StudioLayout>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={window.location.pathname.startsWith('/mockup') ? '/mockup' : ''}>
          <Router />
        </WouterRouter>
        <Toaster />
        <SonnerToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
