import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getMe, updateSettings } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

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
  const [emailTerms, setEmailTerms] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [saved, setSaved] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const pwMut = useMutation({
    mutationFn: async () => {
      if (pw.length < 8) throw new Error("A senha precisa ter ao menos 8 caracteres");
      if (pw !== pw2) throw new Error("As senhas não coincidem");
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPw(""); setPw2("");
      setPwMsg({ type: "ok", text: "Senha alterada com sucesso ✓" });
      setTimeout(() => setPwMsg(null), 3000);
    },
    onError: (e: Error) => setPwMsg({ type: "err", text: e.message }),
  });

  useEffect(() => {
    if (me.data) {
      setCadastro(me.data.settings.cadastro_sheet_id);
      setNotas(me.data.settings.notas_sheet_id);
      setEmailTerms(me.data.settings.email_search_terms);
    }
  }, [me.data]);

  const saveMut = useMutation({
    mutationFn: async () => save({ data: { cadastro_sheet_id: extractSheetId(cadastro), notas_sheet_id: extractSheetId(notas), email_search_terms: emailTerms } }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["me"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function addTerm() {
    const t = emailInput.trim();
    if (!t) return;
    if (emailTerms.includes(t)) return;
    if (t.length > 200) return;
    setEmailTerms((prev) => [...prev, t]);
    setEmailInput("");
  }

  function removeTerm(term: string) {
    setEmailTerms((prev) => prev.filter((x) => x !== term));
  }

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

        <div className="block">
          <span className="text-sm font-medium">Termos de busca nos emails</span>
          <p className="text-xs text-muted-foreground mt-0.5">Assuntos usados para encontrar emails de pagamento no Gmail. Padrão: "Pagamento Pix recebido".</p>
          
          <div className="mt-2 flex gap-2">
            <input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTerm(); } }}
              placeholder="Ex: Pagamento Pix recebido"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={addTerm}
              disabled={!emailInput.trim() || emailInput.trim().length > 200}
              className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Adicionar
            </button>
          </div>

          {emailTerms.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {emailTerms.map((term) => (
                <span key={term} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {term}
                  <button
                    onClick={() => removeTerm(term)}
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] text-primary hover:bg-primary/30"
                    aria-label={`Remover ${term}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saveMut.isPending ? "Salvando…" : "Salvar"}
          </button>
          {saved && <span className="text-sm text-success">Salvo ✓</span>}
          {saveMut.error && <span className="text-sm text-destructive">{(saveMut.error as Error).message}</span>}
        </div>
      </div>

      <div className="mt-8 space-y-5 rounded-xl border border-border bg-card p-6">
        <div>
          <h2 className="text-lg font-semibold">Alterar senha</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Defina uma nova senha de acesso (mínimo 8 caracteres).</p>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Nova senha</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Confirmar nova senha</span>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => pwMut.mutate()} disabled={pwMut.isPending || !pw || !pw2}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pwMut.isPending ? "Alterando…" : "Alterar senha"}
          </button>
          {pwMsg && <span className={`text-sm ${pwMsg.type === "ok" ? "text-success" : "text-destructive"}`}>{pwMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}
