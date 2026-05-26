import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listPagantes, savePagante } from "@/lib/notas.functions";
import { getMe } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated/pagantes")({
  component: PagantesPage,
  head: () => ({ meta: [{ title: "Pagantes — CadasMed" }] }),
});

function PagantesPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMe);
  const listFn = useServerFn(listPagantes);
  const saveFn = useServerFn(savePagante);

  const me = useQuery({ queryKey: ["me"], queryFn: () => meFn(), retry: false });
  const needsSettings = !!me.data && (!me.data.settings.cadastro_sheet_id || !me.data.settings.notas_sheet_id);

  const list = useQuery({ queryKey: ["pagantes"], queryFn: () => listFn(), enabled: !needsSettings });

  const [form, setForm] = useState({
    nome: "", beneficiario: "", cpf: "", cep: "", email: "",
    descricao: "Consulta Psiquiatria", tipo: "Pagante",
  });

  const saveMut = useMutation({
    mutationFn: async () => saveFn({ data: form }),
    onSuccess: () => {
      setForm({ nome: "", beneficiario: "", cpf: "", cep: "", email: "", descricao: "Consulta Psiquiatria", tipo: "Pagante" });
      qc.invalidateQueries({ queryKey: ["pagantes"] });
    },
  });

  if (needsSettings) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Configure as planilhas em <strong>Configurações</strong> antes de continuar.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Pagantes não pacientes</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Cadastre quem paga consultas em nome de outras pessoas (beneficiários).
      </p>

      <div className="mt-6 grid gap-2 rounded-xl border border-border bg-card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            ["nome","Nome do pagante"],
            ["beneficiario","Beneficiário (paciente)"],
            ["cpf","CPF"],
            ["cep","CEP"],
            ["email","Email"],
            ["descricao","Descrição"],
          ] as const).map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs text-muted-foreground">{label}</span>
              <input value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => saveMut.mutate()} disabled={!form.nome.trim() || saveMut.isPending}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saveMut.isPending ? "Salvando…" : "Adicionar pagante"}
          </button>
          {saveMut.error && <span className="text-sm text-destructive">{(saveMut.error as Error).message}</span>}
        </div>
      </div>

      <h2 className="mt-10 text-xl font-semibold">Cadastrados</h2>
      {list.isLoading && <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>}
      {list.error && <p className="mt-2 text-sm text-destructive">{(list.error as Error).message}</p>}
      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Pagante</th>
              <th className="px-3 py-2">Beneficiário</th>
              <th className="px-3 py-2">CPF</th>
              <th className="px-3 py-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((p, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{p.nome}</td>
                <td className="px-3 py-2">{p.beneficiario}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.cpf}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.email}</td>
              </tr>
            ))}
            {list.data && list.data.items.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Nenhum pagante cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
