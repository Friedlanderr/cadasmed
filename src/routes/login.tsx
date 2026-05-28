import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearLocalAuthState, getLocalSession, replaceAuthSession } from "@/lib/auth-session";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const session = await getLocalSession();
    if (session) throw redirect({ to: "/" });
  },
  component: LoginPage,
  head: () => ({ meta: [{ title: "Entrar — Notas Fiscais" }] }),
});

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);

    try {
      await clearLocalAuthState();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

      if (error && !data?.session) {
        setErr(error.message);
        return;
      }

      if (!data?.session) {
        setErr("Não foi possível iniciar a sessão.");
        return;
      }

      await replaceAuthSession(data.session);
      nav({ to: "/", replace: true });
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CadasMed - Auxiliando o seu consultório</p>
        <h1 className="mt-2 text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use suas credenciais para acessar.</p>

        <label className="mt-6 block">
          <span className="text-xs text-muted-foreground">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block">
          <span className="text-xs text-muted-foreground">Senha</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>

        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

        <button type="submit" disabled={loading}
          className="mt-5 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {loading ? "Entrando…" : "Entrar"}
        </button>

        <p className="mt-4 text-xs text-muted-foreground text-center">
          Não tem conta? Peça ao administrador para criar uma.
        </p>
      </form>
    </div>
  );
}
