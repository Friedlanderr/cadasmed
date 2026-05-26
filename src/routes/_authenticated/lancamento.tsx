import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { listCadastro, listPagantes, listSheetTabs, lancarPagamento, createMonthTab, scanInterPayments } from "@/lib/notas.functions";
import { getMe } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated/lancamento")({
  component: LancamentoPage,
  head: () => ({ meta: [{ title: "Lançar Pagamento — CadasMed" }] }),
});

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function todayBR() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function monthFromBR(s: string) {
  const parts = s.split("/");
  if (parts.length !== 3) return "";
  const mi = parseInt(parts[1], 10) - 1;
  return mi >= 0 && mi < 12 ? MONTHS_PT[mi] : "";
}

function LancamentoPage() {
  const qc = useQueryClient();
  const meFn = useServerFn(getMe);
  const cadFn = useServerFn(listCadastro);
  const pagFn = useServerFn(listPagantes);
  const tabsFn = useServerFn(listSheetTabs);
  const lancarFn = useServerFn(lancarPagamento);
  const createTab = useServerFn(createMonthTab);

  const me = useQuery({ queryKey: ["me"], queryFn: () => meFn(), retry: false });
  const needsSettings = !!me.data && (!me.data.settings.cadastro_sheet_id || !me.data.settings.notas_sheet_id);

  const cad = useQuery({ queryKey: ["cadastro"], queryFn: () => cadFn(), enabled: !needsSettings });
  const pag = useQuery({ queryKey: ["pagantes"], queryFn: () => pagFn(), enabled: !needsSettings });
  const tabsQ = useQuery({ queryKey: ["tabs"], queryFn: () => tabsFn(), enabled: !needsSettings });

  const [dataPag, setDataPag] = useState(todayBR());
  const [pacienteQ, setPacienteQ] = useState("");
  const [pacienteSel, setPacienteSel] = useState<any | null>(null);
  const [pagQ, setPagQ] = useState("");
  const [pagSel, setPagSel] = useState<any | null>(null);
  const [valorPag, setValorPag] = useState("");
  const [obs, setObs] = useState("");
  const [emitirEm, setEmitirEm] = useState<"paciente" | "pagante">("paciente");
  const [mes, setMes] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    const m = monthFromBR(dataPag);
    if (m && !mes) setMes(m);
  }, [dataPag, mes]);

  const pacientesFiltered = useMemo(() => {
    if (!cad.data?.items) return [];
    const q = pacienteQ.toLowerCase().trim();
    if (!q) return cad.data.items.slice(0, 8);
    return cad.data.items.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [cad.data, pacienteQ]);

  const pagantesFiltered = useMemo(() => {
    if (!pag.data?.items) return [];
    const q = pagQ.toLowerCase().trim();
    if (!q) return pag.data.items.slice(0, 8);
    return pag.data.items.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [pag.data, pagQ]);

  const createTabMut = useMutation({
    mutationFn: async (m: string) => createTab({ data: { month: m } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tabs"] }),
  });

  const lancarMut = useMutation({
    mutationFn: async () => {
      const usePagante = emitirEm === "pagante" && pagSel;
      const target = usePagante ? pagSel : pacienteSel;
      if (!target) throw new Error("Selecione um paciente (e pagante, se for o caso)");
      if (!valorPag.trim()) throw new Error("Informe o valor pago");
      if (!mes) throw new Error("Selecione o mês de destino");

      const observacaoFinal = [
        obs.trim(),
        pagSel && emitirEm === "paciente" ? `Pago por: ${pagSel.nome}` : "",
        usePagante ? `Beneficiário: ${pacienteSel?.nome ?? ""}` : "",
      ].filter(Boolean).join(" | ");

      return lancarFn({
        data: {
          data_pagamento: dataPag,
          sheetName: mes,
          nome: target.nome,
          cpf: target.cpf ?? "",
          cep: target.cep ?? "",
          email: target.email ?? "",
          descricao: target.descricao || "Consulta Psiquiatria",
          valor_consulta: pacienteSel?.valor_consulta ?? "",
          valor_pagamento: valorPag,
          observacao: observacaoFinal,
        },
      });
    },
    onSuccess: () => {
      setOkMsg("Lançado na planilha de Notas ✓");
      setPacienteSel(null); setPagSel(null); setPacienteQ(""); setPagQ("");
      setValorPag(""); setObs(""); setEmitirEm("paciente");
      setTimeout(() => setOkMsg(""), 4000);
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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Lançar pagamento recebido</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Grava uma linha na planilha de Notas (com NF Emitida e NF Enviada em branco) para o contador emitir a nota.
      </p>

      <div className="mt-8 space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Data do pagamento</span>
            <input value={dataPag} onChange={(e) => setDataPag(e.target.value)} placeholder="DD/MM/AAAA"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Mês de destino (aba)</span>
            <div className="flex gap-2">
              <select value={mes} onChange={(e) => setMes(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {MONTHS_PT.map((m) => (
                  <option key={m} value={m}>{m}{tabsQ.data?.tabs.includes(m) ? "" : " (criar)"}</option>
                ))}
              </select>
              {mes && !tabsQ.data?.tabs.includes(mes) && (
                <button onClick={() => createTabMut.mutate(mes)} disabled={createTabMut.isPending}
                  className="mt-1 rounded-md border border-border px-3 text-xs hover:bg-muted">
                  {createTabMut.isPending ? "…" : "Criar"}
                </button>
              )}
            </div>
          </label>
        </div>

        <div>
          <span className="text-sm font-medium">Paciente</span>
          {pacienteSel ? (
            <div className="mt-1 flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{pacienteSel.nome}</p>
                <p className="text-xs text-muted-foreground">{pacienteSel.cpf} · {pacienteSel.email} · {pacienteSel.valor_consulta}</p>
              </div>
              <button onClick={() => { setPacienteSel(null); setPacienteQ(""); }} className="text-xs text-muted-foreground hover:underline">Trocar</button>
            </div>
          ) : (
            <>
              <input value={pacienteQ} onChange={(e) => setPacienteQ(e.target.value)} placeholder="Buscar pelo nome…"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              {(pacienteQ || pacientesFiltered.length > 0) && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                  {pacientesFiltered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado</p>}
                  {pacientesFiltered.map((p, i) => (
                    <button key={i} onClick={() => { setPacienteSel(p); setPacienteQ(p.nome); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{p.nome}</span>{" "}
                      <span className="text-xs text-muted-foreground">· {p.cpf || "—"} · {p.valor_consulta || "—"}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <span className="text-sm font-medium">Pagante (se diferente do paciente)</span>
          {pagSel ? (
            <div className="mt-1 flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{pagSel.nome}</p>
                <p className="text-xs text-muted-foreground">{pagSel.cpf} · {pagSel.email}</p>
              </div>
              <button onClick={() => { setPagSel(null); setPagQ(""); setEmitirEm("paciente"); }} className="text-xs text-muted-foreground hover:underline">Remover</button>
            </div>
          ) : (
            <>
              <input value={pagQ} onChange={(e) => setPagQ(e.target.value)} placeholder="Buscar pagante (opcional)…"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              {pagQ && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background">
                  {pagantesFiltered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado. Cadastre em "Pagantes".</p>}
                  {pagantesFiltered.map((p, i) => (
                    <button key={i} onClick={() => { setPagSel(p); setPagQ(p.nome); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{p.nome}</span>{" "}
                      <span className="text-xs text-muted-foreground">· benef: {p.beneficiario || "—"}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {pagSel && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium mb-2">Emitir NF em nome de:</p>
            <div className="flex gap-2">
              <button onClick={() => setEmitirEm("paciente")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${emitirEm === "paciente" ? "border-primary bg-primary/10 font-medium" : "border-border"}`}>
                Paciente ({pacienteSel?.nome || "—"})
              </button>
              <button onClick={() => setEmitirEm("pagante")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${emitirEm === "pagante" ? "border-primary bg-primary/10 font-medium" : "border-border"}`}>
                Pagante ({pagSel.nome})
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">Valor pago</span>
            <input value={valorPag} onChange={(e) => setValorPag(e.target.value)} placeholder="R$ 400,00"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Observação / período</span>
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder='Ex: "Consultas de 03/04 e 17/04"'
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => lancarMut.mutate()} disabled={lancarMut.isPending || !pacienteSel}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {lancarMut.isPending ? "Gravando…" : "Gravar na planilha de Notas"}
          </button>
          {okMsg && <span className="text-sm text-success">{okMsg}</span>}
          {lancarMut.error && <span className="text-sm text-destructive">{(lancarMut.error as Error).message}</span>}
        </div>
      </div>
    </main>
  );
}
