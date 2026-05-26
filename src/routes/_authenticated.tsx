import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: AuthLayout,
});

function AuthLayout() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [authReady, setAuthReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const meFn = useServerFn(getMe);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => meFn(),
    enabled: authReady && hasSession,
    retry: false,
  });

  useEffect(() => {
    if (!me.error) return;
    if (!(me.error instanceof Error)) return;
    if (!me.error.message.includes("Unauthorized")) return;

    qc.cancelQueries();
    qc.clear();
    nav({ to: "/login", replace: true });
  }, [me.error, qc, nav]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setHasSession(!!data.session);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
      setAuthReady(true);

      if (!session) {
        qc.cancelQueries();
        qc.clear();
        nav({ to: "/login", replace: true });
        return;
      }

      qc.invalidateQueries();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [qc, nav]);

  async function logout() {
    await supabase.auth.signOut();
  }

  if (!authReady || !hasSession) {
    return null;
  }

  return (
    <div>
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-4 text-sm">
          <Link to="/" className="font-medium hover:underline">Notas</Link>
          <Link to="/lancamento" className="hover:underline">Lançar pagamento</Link>
          <Link to="/pagantes" className="hover:underline">Pagantes</Link>
          <Link to="/settings" className="hover:underline">Configurações</Link>
          {me.data?.isAdmin && <Link to="/admin" className="hover:underline">Admin</Link>}
          <span className="ml-auto text-muted-foreground">
            {me.data?.displayName || me.data?.email}{me.data?.isAdmin ? " · admin" : ""}
          </span>
          <button onClick={logout} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Sair</button>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
