/**
 * KAYAN-TASK-81: auth gate.
 *
 * - On mount, calls /api/auth/session.
 * - If unauthenticated → renders LoginModal.
 * - If authenticated → renders children + exposes logout in a small badge.
 *
 * The session is NOT cached in browser storage; a page reload re-checks.
 */
import { useEffect, useState, type ReactNode } from "react";
import { LoginModal } from "./login-modal";
import { fetchSession, logout, type SessionState } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await fetchSession();
      setState(s);
    })();
  }, []);

  if (state === null) {
    // Loading state — avoid flashing the login modal before we know.
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground" dir="rtl">
        <p className="text-sm text-muted-foreground">جاري التحقق من الجلسة...</p>
      </div>
    );
  }

  if (!state.authenticated) {
    return <LoginModal onSuccess={(s) => setState(s)} />;
  }

  return (
    <>
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span>متصل</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px] text-zinc-400 hover:text-white"
          onClick={async () => {
            await logout();
            setState({ authenticated: false, source: null, expiresAt: null });
          }}
        >
          <LogOut className="h-3 w-3" />
          خروج
        </Button>
      </div>
      {children}
    </>
  );
}
