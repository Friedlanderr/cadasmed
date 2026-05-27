import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getMe,
  adminListUsers,
  adminCreateUser,
  adminDeleteUser,
  adminToggleAdmin,
  adminResetPassword,
  adminSetBlocked,
  adminSetExpiration,
  adminGetStats,
  adminListAuditLogs,
} from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  component: AdminPage,
  head: () => ({ meta: [{ title: "Admin — Usuários" }] }),
});

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("pt-BR"); } catch { return s; }
}

function AdminPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMe);
  const listFn = useServerFn(adminListUsers);
  const createFn = useServerFn(adminCreateUser);
  const delFn = useServerFn(adminDeleteUser);
  const toggleFn = useServerFn(adminToggleAdmin);
  const resetFn = useServerFn(adminResetPassword);
  const blockFn = useServerFn(adminSetBlocked);
  const expFn = useServerFn(adminSetExpiration);
  const statsFn = useServerFn(adminGetStats);
  const auditFn = useServerFn(adminListAuditLogs);

  const [pwEdits, setPwEdits] = useState<Record<string, string>>({});
  const [expEdits, setExpEdits] = useState<Record<string, string>>({});
  const [reasonEdits, setReasonEdits] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"dashboard" | "users" | "audit">("dashboard");
  const [auditSeverity, setAuditSeverity] = useState<string>("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => meFn(), retry: false });
  const isAdmin = !!me.data?.isAdmin;
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn(), enabled: me.isSuccess && isAdmin, retry: false });
  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn(), enabled: me.isSuccess && isAdmin, retry: false });
  const audit = useQuery({
    queryKey: ["admin-audit", auditSeverity],
    queryFn: () => auditFn({ data: { limit: 200, severity: auditSeverity || undefined } }),
    enabled: me.isSuccess && isAdmin && tab === "audit",
    retry: false,
  });

  const [form, setForm] = useState({ email: "", password: "", displayName: "", isAdmin: false });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
    qc.invalidateQueries({ queryKey: ["admin-audit"] });
  };

  const createMut = useMutation({
    mutationFn: async () => createFn({ data: form }),
    onSuccess: () => { setForm({ email: "", password: "", displayName: "", isAdmin: false }); invalidateAll(); },
  });
  const delMut = useMutation({ mutationFn: async (userId: string) => delFn({ data: { userId } }), onSuccess: invalidateAll });
  const toggleMut = useMutation({ mutationFn: async (vars: { userId: string; makeAdmin: boolean }) => toggleFn({ data: vars }), onSuccess: invalidateAll });
  const resetMut = useMutation({
    mutationFn: async (vars: { userId: string; password: string }) => resetFn({ data: vars }),
    onSuccess: (_d, vars) => { setPwEdits((p) => ({ ...p, [vars.userId]: "" })); alert("Senha atualizada"); invalidateAll(); },
    onError: (e: Error) => alert(e.message),
  });
  const blockMut = useMutation({
    mutationFn: async (vars: { userId: string; blocked: boolean; reason?: string }) => blockFn({ data: vars }),
    onSuccess: invalidateAll, onError: (e: Error) => alert(e.message),
  });
  const expMut = useMutation({
    mutationFn: async (vars: { userId: string; expiresAt: string | null }) => expFn({ data: vars }),
    onSuccess: invalidateAll, onError: (e: Error) => alert(e.message),
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
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Administração</h1>
      <p className="mt-2 text-sm text-muted-foreground">Gerencie usuários, acompanhe métricas e visualize auditoria.</p>

      <div className="mt-6 flex gap-2 border-b border-border">
        {(["dashboard", "users", "audit"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "dashboard" ? "Dashboard" : t === "users" ? "Usuários" : "Auditoria"}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <section className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Usuários" value={stats.data?.totalUsers ?? 0} />
            <StatCard label="Bloqueados" value={stats.data?.blockedUsers ?? 0} />
            <StatCard label="Admins" value={stats.data?.adminsCount ?? 0} />
            <StatCard label="Notas enviadas" value={stats.data?.totalSent ?? 0} />
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">Média de notas por usuário ao mês</p>
            <p className="mt-1 text-3xl font-semibold">{stats.data?.avgPerUserPerMonth ?? 0}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="text-sm font-semibold">Notas por mês (últimos 12)</h3>
            <div className="mt-4 flex items-end gap-2 h-40">
              {(stats.data?.monthlySeries ?? []).map((m) => {
                const max = Math.max(...(stats.data?.monthlySeries ?? []).map((x) => x.count), 1);
                const h = Math.round((m.count / max) * 100);
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-primary/20 rounded-t" style={{ height: `${h}%` }} title={`${m.count}`} />
                    <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                  </div>
                );
              })}
              {(!stats.data?.monthlySeries || stats.data.monthlySeries.length === 0) && (
                <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "users" && (
        <>
          <section className="mt-6 rounded-xl border border-border bg-card p-6">
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

          <section className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border p-4"><h2 className="text-lg font-semibold">Usuários ({users.data?.length ?? 0})</h2></div>
            {users.isLoading && <p className="p-6 text-muted-foreground">Carregando…</p>}
            <div className="divide-y divide-border">
              {users.data?.map((u) => {
                const uIsAdmin = u.roles.includes("admin");
                const isSelf = u.userId === me.data?.userId;
                const expired = u.expiresAt && new Date(u.expiresAt).getTime() < Date.now();
                return (
                  <div key={u.userId} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {u.displayName || u.email}{isSelf && " (você)"}
                          {u.isBlocked && <span className="ml-2 text-xs rounded-full px-2 py-0.5 bg-destructive/15 text-destructive">bloqueado</span>}
                          {expired && <span className="ml-2 text-xs rounded-full px-2 py-0.5 bg-destructive/15 text-destructive">expirado</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {u.email} · {u.sentCount} notas enviadas · expira: {fmtDate(u.expiresAt)}
                          {u.isBlocked && u.blockedReason ? ` · motivo: ${u.blockedReason}` : ""}
                        </p>
                      </div>
                      <span className={`text-xs rounded-full px-2 py-0.5 ${uIsAdmin ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {uIsAdmin ? "admin" : "user"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <input type="text" placeholder="Nova senha" value={pwEdits[u.userId] ?? ""}
                        onChange={(e) => setPwEdits((p) => ({ ...p, [u.userId]: e.target.value }))}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono w-36" />
                      <button onClick={() => {
                        const pw = pwEdits[u.userId] ?? "";
                        if (pw.length < 8) { alert("Mín. 8 caracteres"); return; }
                        if (confirm(`Redefinir senha de ${u.email}?`)) resetMut.mutate({ userId: u.userId, password: pw });
                      }} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Redefinir</button>

                      <input type="datetime-local" value={expEdits[u.userId] ?? (u.expiresAt ? new Date(u.expiresAt).toISOString().slice(0, 16) : "")}
                        onChange={(e) => setExpEdits((p) => ({ ...p, [u.userId]: e.target.value }))}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" />
                      <button onClick={() => {
                        const val = expEdits[u.userId];
                        expMut.mutate({ userId: u.userId, expiresAt: val ? new Date(val).toISOString() : null });
                      }} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Salvar expira</button>
                      {u.expiresAt && (
                        <button onClick={() => expMut.mutate({ userId: u.userId, expiresAt: null })}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Remover expira</button>
                      )}

                      {u.isBlocked ? (
                        <button onClick={() => blockMut.mutate({ userId: u.userId, blocked: false })}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">Desbloquear</button>
                      ) : (
                        <>
                          <input type="text" placeholder="Motivo (opcional)" value={reasonEdits[u.userId] ?? ""}
                            onChange={(e) => setReasonEdits((p) => ({ ...p, [u.userId]: e.target.value }))}
                            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs w-40" />
                          <button onClick={() => blockMut.mutate({ userId: u.userId, blocked: true, reason: reasonEdits[u.userId] })}
                            disabled={isSelf}
                            className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">Bloquear</button>
                        </>
                      )}

                      <button onClick={() => toggleMut.mutate({ userId: u.userId, makeAdmin: !uIsAdmin })}
                        disabled={isSelf && uIsAdmin}
                        className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                        {uIsAdmin ? "Remover admin" : "Tornar admin"}
                      </button>
                      <button onClick={() => { if (confirm(`Remover ${u.email}?`)) delMut.mutate(u.userId); }}
                        disabled={isSelf}
                        className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50">Excluir</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {tab === "audit" && (
        <section className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border p-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Auditoria ({audit.data?.length ?? 0})</h2>
            <select value={auditSeverity} onChange={(e) => setAuditSeverity(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">
              <option value="">Todas severidades</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>
          {audit.isLoading && <p className="p-6 text-muted-foreground">Carregando…</p>}
          <div className="divide-y divide-border text-sm">
            {audit.data?.map((r) => (
              <div key={r.id} className="p-3 flex flex-wrap items-start gap-3">
                <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 font-mono ${r.severity === "error" ? "bg-destructive/15 text-destructive" : r.severity === "warn" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                  {r.severity}
                </span>
                <span className="font-mono text-xs">{r.action}</span>
                <span className="text-xs text-muted-foreground">{r.actor_email ?? "—"}</span>
                <span className="text-xs text-muted-foreground ml-auto">{fmtDate(r.created_at)}</span>
                {r.details && Object.keys(r.details as object).length > 0 && (
                  <pre className="w-full mt-1 text-[11px] bg-muted rounded p-2 overflow-x-auto">{JSON.stringify(r.details, null, 2)}</pre>
                )}
              </div>
            ))}
            {audit.data && audit.data.length === 0 && <p className="p-6 text-muted-foreground">Sem registros.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
