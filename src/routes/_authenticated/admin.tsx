import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getMe, adminListUsers, adminCreateUser, adminDeleteUser, adminToggleAdmin, adminResetPassword } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin — Usuários" }] }),
});

function AdminPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMe);
  const listFn = useServerFn(adminListUsers);
  const createFn = useServerFn(adminCreateUser);
  const delFn = useServerFn(adminDeleteUser);
  const toggleFn = useServerFn(adminToggleAdmin);
  const resetFn = useServerFn(adminResetPassword);
  const [pwEdits, setPwEdits] = useState<Record<string, string>>({});

  const me = useQuery({ queryKey: ["me"], queryFn: () => meFn(), retry: false });
  const isAdmin = !!me.data?.isAdmin;
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn(), enabled: me.isSuccess && isAdmin, retry: false });

  const [form, setForm] = useState({ email: "", password: "", displayName: "", isAdmin: false });

  const createMut = useMutation({
    mutationFn: async () => createFn({ data: form }),
    onSuccess: () => {
      setForm({ email: "", password: "", displayName: "", isAdmin: false });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const delMut = useMutation({
    mutationFn: async (userId: string) => delFn({ data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const toggleMut = useMutation({
    mutationFn: async (vars: { userId: string; makeAdmin: boolean }) => toggleFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const resetMut = useMutation({
    mutationFn: async (vars: { userId: string; password: string }) => resetFn({ data: vars }),
    onSuccess: (_d, vars) => {
      setPwEdits((p) => ({ ...p, [vars.userId]: "" }));
      alert("Senha atualizada com sucesso");
    },
    onError: (e: Error) => alert(e.message),
  });

  if (me.isLoading) return <p className="p-6 text-muted-foreground">Carregando…</p>;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="text-2xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">Apenas administradores podem ver esta página.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Administração de usuários</h1>
      <p className="mt-2 text-sm text-muted-foreground">Crie contas e gerencie permissões. Cada usuário tem suas próprias planilhas.</p>

      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Criar usuário</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">Nome</span>
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Email</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Senha (mín. 8)</span>
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" />
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
            <span className="text-sm">Tornar administrador</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !form.email || form.password.length < 8}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {createMut.isPending ? "Criando…" : "Criar usuário"}
          </button>
          {createMut.error && <span className="text-sm text-destructive">{(createMut.error as Error).message}</span>}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border p-4"><h2 className="text-lg font-semibold">Usuários ({users.data?.length ?? 0})</h2></div>
        {users.isLoading && <p className="p-6 text-muted-foreground">Carregando…</p>}
        <div className="divide-y divide-border">
          {users.data?.map((u) => {
            const uIsAdmin = u.roles.includes("admin");
            const isSelf = u.userId === me.data?.userId;
            return (
              <div key={u.userId} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.displayName || u.email}{isSelf && " (você)"}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className={`text-xs rounded-full px-2 py-0.5 ${uIsAdmin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {uIsAdmin ? "admin" : "user"}
                </span>
                <button onClick={() => toggleMut.mutate({ userId: u.userId, makeAdmin: !uIsAdmin })}
                  disabled={toggleMut.isPending || (isSelf && uIsAdmin)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                  {uIsAdmin ? "Remover admin" : "Tornar admin"}
                </button>
                <button onClick={() => { if (confirm(`Remover ${u.email}?`)) delMut.mutate(u.userId); }}
                  disabled={delMut.isPending || isSelf}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">
                  Excluir
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
