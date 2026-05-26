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
  const scanFn = useServerFn(scanInterPayments);

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
  const [scanDays, setScanDays] = useState(15);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Record<string, "pending" | "ok" | "skip" | "err">>({});
  const [bulkErr, setBulkErr] = useState<Record<string, string>>({});

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

  const scanMut = useMutation({
    mutationFn: async () => scanFn({ data: { days: scanDays } }),
    onSuccess: () => { setSelectedIds(new Set()); setBulkStatus({}); setBulkErr({}); },
  });

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    const items = scanMut.data?.items ?? [];
    setSelectedIds((prev) => prev.size === items.length ? new Set() : new Set(items.map((i) => i.messageId)));
  }

  function applySuggestion(s: any) {
    const m = s.match;
    if (m.source === "cadastro") {
      setPacienteSel({
        nome: m.nome, cpf: m.cpf, cep: m.cep, email: m.email,
        descricao: m.descricao, valor_consulta: m.valor_consulta,
      });
      setPacienteQ(m.nome);
      setPagSel(null); setPagQ(""); setEmitirEm("paciente");
    } else if (m.source === "pagante") {
      setPagSel({ nome: m.nome, cpf: m.cpf, cep: m.cep, email: m.email });
      setPagQ(m.nome);
      const ben = (m.beneficiarioSugerido ?? "").trim().toLowerCase();
      const benRow = ben ? cad.data?.items.find((p) => p.nome.toLowerCase().includes(ben.split(" ")[0])) : null;
      if (benRow) { setPacienteSel(benRow); setPacienteQ(benRow.nome); }
      setEmitirEm("paciente");
    } else {
      setPagSel({ nome: m.nome, cpf: "", cep: "", email: "" });
      setPagQ(m.nome);
    }
    const v = (s.valor ?? "").replace(/[^\d,.]/g, "");
    if (v) setValorPag(`R$ ${v}`);
    if (s.date) setDataPag(s.date);
    setOkMsg("Sugestão aplicada — confira os campos");
    setTimeout(() => setOkMsg(""), 3000);
  }

  const bulkMut = useMutation({
    mutationFn: async () => {
      const items = (scanMut.data?.items ?? []).filter((i) => selectedIds.has(i.messageId));
      const status: Record<string, "pending" | "ok" | "skip" | "err"> = {};
      const errs: Record<string, string> = {};
      for (const s of items) status[s.messageId] = "pending";
      setBulkStatus({ ...status }); setBulkErr({});

      for (const s of items) {
        try {
          const m: any = s.match;
          if (m.source === "none") { status[s.messageId] = "skip"; errs[s.messageId] = "Sem correspondência"; setBulkStatus({ ...status }); setBulkErr({ ...errs }); continue; }

          let paciente: any = null;
          let pagante: any = null;
          if (m.source === "cadastro") {
            paciente = { nome: m.nome, cpf: m.cpf, cep: m.cep, email: m.email, descricao: m.descricao, valor_consulta: m.valor_consulta };
          } else if (m.source === "pagante") {
            pagante = { nome: m.nome, cpf: m.cpf, cep: m.cep, email: m.email };
            const ben = (m.beneficiarioSugerido ?? "").trim().toLowerCase();
            const benRow = ben ? cad.data?.items.find((p) => p.nome.toLowerCase().includes(ben.split(" ")[0])) : null;
            if (benRow) paciente = benRow;
          }
          if (!paciente) { status[s.messageId] = "skip"; errs[s.messageId] = "Beneficiário não localizado"; setBulkStatus({ ...status }); setBulkErr({ ...errs }); continue; }

          const dataP = s.date || todayBR();
          const mesDest = monthFromBR(dataP);
          if (!mesDest) { status[s.messageId] = "err"; errs[s.messageId] = "Data inválida"; setBulkStatus({ ...status }); setBulkErr({ ...errs }); continue; }
          if (!tabsQ.data?.tabs.includes(mesDest)) {
            await createTab({ data: { month: mesDest } });
            await qc.invalidateQueries({ queryKey: ["tabs"] });
          }
          const v = (s.valor ?? "").replace(/[^\d,.]/g, "");
          const target = pagante ?? paciente;
          const obsFinal = pagante ? `Beneficiário: ${paciente.nome}` : "";

          await lancarFn({
            data: {
              data_pagamento: dataP,
              sheetName: mesDest,
              nome: target.nome,
              cpf: target.cpf ?? "",
              cep: target.cep ?? "",
              email: target.email ?? "",
              descricao: paciente.descricao || "Consulta Psiquiatria",
              valor_consulta: paciente.valor_consulta ?? "",
              valor_pagamento: v ? `R$ ${v}` : "",
              observacao: obsFinal,
            },
          });
          status[s.messageId] = "ok"; setBulkStatus({ ...status });
        } catch (e: any) {
          status[s.messageId] = "err"; errs[s.messageId] = e?.message ?? "Erro"; setBulkStatus({ ...status }); setBulkErr({ ...errs });
        }
      }
      return { done: true };
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

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-sm font-medium">Varrer emails do Banco Inter</p>
            <p className="text-xs text-muted-foreground">Busca "Pagamento Pix recebido" no Gmail e tenta casar com o Cadastro.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Últimos
              <input type="number" min={1} max={180} value={scanDays}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setScanDays(parseInt(e.target.value || "15", 10))}
                className="mx-2 w-16 rounded-md border border-input bg-background px-2 py-1 text-sm" />
              dias
            </label>
            <button onClick={() => scanMut.mutate()} disabled={scanMut.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {scanMut.isPending ? "Buscando…" : "Buscar Pix recebidos"}
            </button>
          </div>
        </div>
        {scanMut.error && <p className="mt-3 text-sm text-destructive">{(scanMut.error as Error).message}</p>}
        {scanMut.data && (
          <div className="mt-4 space-y-2">
            {scanMut.data.items.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum email encontrado no período.</p>
            )}
            {scanMut.data.items.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox"
                    checked={selectedIds.size === scanMut.data.items.length && selectedIds.size > 0}
                    onChange={toggleAll} />
                  <span>Selecionar todos ({selectedIds.size}/{scanMut.data.items.length})</span>
                </label>
                <div className="flex gap-2">
                  {selectedIds.size === 1 && (() => {
                    const one = scanMut.data.items.find((i) => selectedIds.has(i.messageId));
                    return one ? (
                      <button onClick={() => applySuggestion(one)}
                        className="rounded-md border border-border px-3 py-1 hover:bg-muted">
                        Editar selecionado no formulário
                      </button>
                    ) : null;
                  })()}
                  {selectedIds.size >= 1 && (
                    <button onClick={() => bulkMut.mutate()} disabled={bulkMut.isPending}
                      className="rounded-md bg-primary px-3 py-1 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                      {bulkMut.isPending ? "Lançando…" : `Lançar ${selectedIds.size} selecionado${selectedIds.size > 1 ? "s" : ""}`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {scanMut.data.items.map((s) => {
              const st = bulkStatus[s.messageId];
              const checked = selectedIds.has(s.messageId);
              return (
                <div key={s.messageId} className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${checked ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleSelected(s.messageId)} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{s.pagador} <span className="text-muted-foreground font-normal">· {s.valor || "—"} · {s.date}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {s.match.source === "cadastro" && <>✓ Casou com paciente <strong>{s.match.nome}</strong></>}
                      {s.match.source === "pagante" && (
                        <>
                          <span className="font-semibold text-primary">⚑ Pagante ≠ paciente</span>{" · "}
                          <strong>{s.match.nome}</strong>
                          {s.match.beneficiarioSugerido && (
                            <> → <span className="font-semibold text-primary">benef. {s.match.beneficiarioSugerido}</span></>
                          )}
                        </>
                      )}
                      {s.match.source === "none" && <span className="text-amber-700">Não encontrado no Cadastro</span>}
                    </p>
                    {st && (
                      <p className="text-xs mt-1">
                        {st === "pending" && <span className="text-muted-foreground">Lançando…</span>}
                        {st === "ok" && <span className="text-success">✓ Lançado</span>}
                        {st === "skip" && <span className="text-amber-700">Ignorado: {bulkErr[s.messageId]}</span>}
                        {st === "err" && <span className="text-destructive">Erro: {bulkErr[s.messageId]}</span>}
                      </p>
                    )}
                  </div>
                  {s.alreadyInSheet && (
                    <span title="Já consta na planilha de Notas" className="text-success text-base font-bold">✓</span>
                  )}
                  <button onClick={() => applySuggestion(s)}
                    className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted">
                    Usar
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>



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
