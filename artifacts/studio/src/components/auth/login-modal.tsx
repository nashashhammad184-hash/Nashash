/**
 * KAYAN-TASK-81: login modal.
 *
 * SECURITY:
 *   - The token is kept only in React state (component memory).
 *   - It is cleared immediately after submit.
 *   - Never persisted to localStorage/sessionStorage/cookies.
 */
import { useState } from "react";
import { loginWithToken, fetchSession, type SessionState } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

export function LoginModal({ onSuccess }: { onSuccess: (s: SessionState) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await loginWithToken(token);
    // Clear the token from memory immediately after the call.
    setToken("");
    if (r.ok === false) {
      setError(r.error || "فشل تسجيل الدخول");
      setBusy(false);
      return;
    }
    const s = await fetchSession();
    if (!s.authenticated) {
      setError("لم يتم تأكيد الجلسة");
      setBusy(false);
      return;
    }
    setBusy(false);
    onSuccess(s);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">تسجيل الدخول</h1>
            <p className="text-xs text-zinc-400">أدخل رمز الوصول الإداري للمتابعة</p>
          </div>
        </div>

        <label className="mb-2 block text-sm font-medium text-zinc-300">رمز الوصول</label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="mb-4 bg-zinc-800 border-zinc-700 text-white"
          disabled={busy}
        />

        {error && (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={busy || token.length === 0}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-bold"
        >
          {busy ? "جاري التحقق..." : "دخول"}
        </Button>

        <p className="mt-4 text-center text-[10px] text-zinc-500">
          يتم التحقق عبر HTTPS، ولا يُخزّن الرمز في المتصفح.
        </p>
      </form>
    </div>
  );
}
