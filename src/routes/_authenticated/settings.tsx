import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getMe, updateSettings } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Configurações — Notas" }] }),
});

function extractSheetId(input: string) {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}

function SettingsPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMe);
  const save = useServerFn(updateSettings);
  const me = useQuery({ queryKey: ["me"], queryFn: () => meFn(), retry: false });

  const [cadastro, setCadastro] = useState("");
  const [notas, setNotas] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data) {
      setCadastro(me.data.settings.cadastro_sheet_id);
      setNotas(me.data.settings.notas_sheet_id);
    }
  }, [me.data]);

  const saveMut = useMutation({
    mutationFn: async () => save({ data: { cadastro_sheet_id: extractSheetId(cadastro), notas_sheet_id: extractSheetId(notas) } }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["me"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Configurações</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Defina as planilhas usadas para seu fluxo. Você pode colar o link inteiro do Google Sheets ou apenas o ID.
      </p>

      <div className="mt-8 space-y-5 rounded-xl border border-border bg-card p-6">
        <label className="block">
          <span className="text-sm font-medium">Planilha de Cadastro</span>
          <p className="text-xs text-muted-foreground mt-0.5">Onde ficam os dados dos pacientes (abas "Cadastro" e "Dados pagantes não pacientes").</p>
          <input value={cadastro} onChange={(e) => setCadastro(e.target.value)}
            placeholder="Link ou ID da planilha"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Planilha de Controle de Notas</span>
          <p className="text-xs text-muted-foreground mt-0.5">Onde as notas processadas são gravadas, com uma aba por mês.</p>
          <input value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="Link ou ID da planilha"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" />
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saveMut.isPending ? "Salvando…" : "Salvar"}
          </button>
          {saved && <span className="text-sm text-success">Salvo ✓</span>}
          {saveMut.error && <span className="text-sm text-destructive">{(saveMut.error as Error).message}</span>}
        </div>
      </div>
    </div>
  );
}
