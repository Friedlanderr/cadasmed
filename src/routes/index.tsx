import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import {
  listInvoices, processInvoice, confirmSend, listSheetTabs,
  parsePatientText, savePatient, createMonthTab,
} from "@/lib/notas.functions";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Notas Fiscais — Consultório Dra. Ingrid Melo" },
      { name: "description", content: "Processamento automático de notas fiscais e cadastro de pacientes." },
    ],
  }),
});

type Invoice = { id: string; name: string; modifiedTime: string; size?: string };
type Preview = Awaited<ReturnType<typeof processInvoice>>;
type MonthConfig = { month: string; folderId: string };

const LS_KEY = "notas.monthFolders.v1";
const LS_ACTIVE = "notas.activeMonth.v1";

function extractFolderId(input: string) {
  const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : input.trim();
}
function fmtKB(s?: string) {
  if (!s) return "";
  return `${Math.round(Number(s) / 1024)} KB`;
}

function Index() {
  const fonts = (
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" />
  );

  const list = useServerFn(listInvoices);
  const process = useServerFn(processInvoice);
  const confirm = useServerFn(confirmSend);
  const tabs = useServerFn(listSheetTabs);
  const createTab = useServerFn(createMonthTab);
  const parseTxt = useServerFn(parsePatientText);
  const savePat = useServerFn(savePatient);
  const qc = useQueryClient();

  // Month/folder config (persisted)
  const [configs, setConfigs] = useState<MonthConfig[]>([]);
  const [activeMonth, setActiveMonth] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed: MonthConfig[] = raw ? JSON.parse(raw) : [];
      if (parsed.length === 0) {
        const seed = [{ month: "Maio", folderId: "1dxcGfLTlOHAClmM0zDowtGY7aT7cHous" }];
        setConfigs(seed);
        localStorage.setItem(LS_KEY, JSON.stringify(seed));
      } else setConfigs(parsed);
      const act = localStorage.getItem(LS_ACTIVE);
      setActiveMonth(act || (parsed[0]?.month ?? "Maio"));
    } catch {}
  }, []);

  function persist(next: MonthConfig[]) {
    setConfigs(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }
  function setActive(m: string) {
    setActiveMonth(m);
    localStorage.setItem(LS_ACTIVE, m);
  }

  const activeCfg = useMemo(() => configs.find((c) => c.month === activeMonth), [configs, activeMonth]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["invoices", activeCfg?.folderId],
    queryFn: () => list({ data: { folderId: activeCfg!.folderId } }),
    enabled: !!activeCfg?.folderId,
  });

  const tabsQ = useQuery({ queryKey: ["tabs"], queryFn: () => tabs(), enabled: showSettings });

  const [newMonth, setNewMonth] = useState<string>("");
  const createTabMut = useMutation({
    mutationFn: async (month: string) => createTab({ data: { month } }),
    onSuccess: (_res, month) => {
      if (!configs.find((c) => c.month === month)) {
        persist([...configs, { month, folderId: "" }]);
      }
      setNewMonth("");
      qc.invalidateQueries({ queryKey: ["tabs"] });
    },
  });

  const [active, setActive2] = useState<Invoice | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editEmail, setEditEmail] = useState({ to: "", subject: "", body: "" });
  const [editRow, setEditRow] = useState<string[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const procMut = useMutation({
    mutationFn: async (inv: Invoice) => process({ data: { fileId: inv.id, fileName: inv.name } }),
    onSuccess: (p) => { setPreview(p); setEditEmail(p.email); setEditRow(p.sheetRow); },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Sem preview");
      if (!activeMonth) throw new Error("Selecione o mês");
      return confirm({
        data: {
          sheetRow: editRow, sheetName: activeMonth, email: editEmail,
          pdfBase64: preview.pdfBase64, fileName: preview.fileName,
        },
      });
    },
    onSuccess: () => {
      if (active) setSent((s) => new Set(s).add(active.id));
      setActive2(null); setPreview(null);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  // ===== Patient registration =====
  const [showPatient, setShowPatient] = useState(false);
  const [patientText, setPatientText] = useState("");
  const [patientForm, setPatientForm] = useState({
    nome: "", cpf: "", cep: "", email: "", descricao: "Consulta Psiquiatria", valor_consulta: "",
  });
  const parseMut = useMutation({
    mutationFn: async () => parseTxt({ data: { text: patientText } }),
    onSuccess: (p) => setPatientForm(p),
  });
  const saveMut = useMutation({
    mutationFn: async () => savePat({ data: patientForm }),
    onSuccess: () => {
      setShowPatient(false);
      setPatientText("");
      setPatientForm({ nome: "", cpf: "", cep: "", email: "", descricao: "Consulta Psiquiatria", valor_consulta: "" });
    },
  });

  const COLS = ["Data","Nome","CPF","CEP","Email","Descrição","Valor Consulta","Valor Pagamento","Observação"];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {fonts}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Consultório Dra. Ingrid Melo</p>
          <h1 className="mt-2 text-4xl font-semibold">Processamento de Notas Fiscais</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Selecione o mês, processe as notas da pasta correspondente e envie por email com revisão prévia.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Month selector */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <label className="text-sm font-medium">Mês ativo:</label>
          <select
            value={activeMonth}
            onChange={(e) => setActive(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {configs.map((c) => (
              <option key={c.month} value={c.month}>{c.month}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {activeCfg ? `Pasta: ${activeCfg.folderId.slice(0, 12)}…` : "—"}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setShowSettings(true)} className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
              Gerenciar meses
            </button>
            <button onClick={() => setShowPatient(true)} className="rounded-md bg-secondary px-3 py-2 text-sm font-medium hover:opacity-90">
              + Cadastrar paciente
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Notas em {activeMonth || "—"}</h2>
          <button
            onClick={() => refetch()}
            disabled={isFetching || !activeCfg}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {isFetching ? "Atualizando…" : "Atualizar"}
          </button>
        </div>

        {!activeCfg && (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
            Nenhum mês configurado. Clique em "Gerenciar meses" para adicionar.
          </p>
        )}
        {isLoading && <p className="text-muted-foreground">Carregando…</p>}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}

        <div className="grid gap-3">
          {data?.files.map((f) => {
            const isSent = sent.has(f.id);
            return (
              <div key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(f.modifiedTime).toLocaleString("pt-BR")} · {fmtKB(f.size)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isSent && <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">Enviado ✓</span>}
                  <button
                    onClick={() => { setActive2(f); setPreview(null); procMut.mutate(f); }}
                    disabled={procMut.isPending && active?.id === f.id}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {procMut.isPending && active?.id === f.id ? "Processando…" : "Processar"}
                  </button>
                </div>
              </div>
            );
          })}
          {data && data.files.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
              Nenhum PDF na pasta.
            </p>
          )}
        </div>
      </main>

      {/* ===== Settings modal ===== */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4" onClick={() => setShowSettings(false)}>
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-6 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Meses e pastas</h3>
              <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <p className="text-xs text-muted-foreground">
                Cada mês aponta para uma pasta no Drive (cole o link ou o ID) e grava na aba de mesmo nome na planilha de notas.
                {tabsQ.data && <> Abas detectadas: {tabsQ.data.tabs.join(", ") || "nenhuma"}.</>}
              </p>
              {configs.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <select
                    value={c.month}
                    onChange={(e) => {
                      const next = [...configs]; next[i] = { ...c, month: e.target.value }; persist(next);
                    }}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Link ou ID da pasta no Drive"
                    value={c.folderId}
                    onChange={(e) => {
                      const next = [...configs]; next[i] = { ...c, folderId: extractFolderId(e.target.value) }; persist(next);
                    }}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={() => persist(configs.filter((_, j) => j !== i))}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                  >Remover</button>
                </div>
              ))}
              <button
                onClick={() => persist([...configs, { month: "Junho", folderId: "" }])}
                className="rounded-md border border-dashed border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >+ Adicionar mês</button>
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-muted/30 p-4">
              <button onClick={() => setShowSettings(false)} className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Pronto</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Patient registration modal ===== */}
      {showPatient && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4" onClick={() => !saveMut.isPending && setShowPatient(false)}>
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-6 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Cadastrar paciente</h3>
              <button onClick={() => setShowPatient(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 p-6">
              <label className="block">
                <span className="text-xs text-muted-foreground">Cole o texto enviado pelo paciente</span>
                <textarea
                  rows={6}
                  value={patientText}
                  onChange={(e) => setPatientText(e.target.value)}
                  placeholder="Ex: Meu nome é João Silva, CPF 123.456.789-00, CEP 01310-100, email joao@gmail.com…"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <button
                onClick={() => parseMut.mutate()}
                disabled={!patientText.trim() || parseMut.isPending}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {parseMut.isPending ? "Extraindo…" : "Extrair dados com IA"}
              </button>
              {parseMut.error && <p className="text-sm text-destructive">{(parseMut.error as Error).message}</p>}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-2 border-t border-border">
                {([
                  ["nome","Nome"],["cpf","CPF"],["cep","CEP"],["email","Email"],
                  ["descricao","Descrição"],["valor_consulta","Valor por consulta"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="block">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <input
                      value={patientForm[k]}
                      onChange={(e) => setPatientForm({ ...patientForm, [k]: e.target.value })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </label>
                ))}
              </div>
              {saveMut.error && <p className="text-sm text-destructive">{(saveMut.error as Error).message}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border bg-muted/30 p-4">
              <button onClick={() => setShowPatient(false)} disabled={saveMut.isPending} className="rounded-md border border-border bg-card px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">Cancelar</button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={!patientForm.nome.trim() || saveMut.isPending}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saveMut.isPending ? "Salvando…" : "Salvar na planilha Cadastro"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Review modal ===== */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4" onClick={() => !sendMut.isPending && setActive2(null)}>
          <div className="my-8 w-full max-w-4xl rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">Revisão</h3>
                  <p className="mt-1 text-sm text-muted-foreground truncate">{active.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Será gravado na aba: <strong>{activeMonth}</strong></p>
                </div>
                <button onClick={() => !sendMut.isPending && setActive2(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
            </div>

            <div className="space-y-6 p-6">
              {procMut.isPending && <p className="text-muted-foreground">Lendo PDF e cruzando com o cadastro…</p>}
              {procMut.error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {(procMut.error as Error).message}
                </div>
              )}

              {preview && (
                <>
                  <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Extraído da NF</p>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                      <div><span className="text-muted-foreground">Tomador:</span> <span className="font-medium">{preview.extracted.tomador}</span></div>
                      <div><span className="text-muted-foreground">Competência:</span> <span className="font-medium">{preview.extracted.competencia}</span></div>
                      <div><span className="text-muted-foreground">Valor líquido:</span> <span className="font-medium">{preview.extracted.valor_liquido}</span></div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Match: {preview.patient.source === "none" ? "❌ paciente não encontrado no cadastro" : `${preview.patient.source} (${Math.round(preview.matchScore * 100)}%)`}
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold">Linha que será adicionada</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {COLS.map((c, i) => (
                        <label key={c} className="block">
                          <span className="text-xs text-muted-foreground">{c}</span>
                          <input
                            value={editRow[i] ?? ""}
                            onChange={(e) => { const r = [...editRow]; r[i] = e.target.value; setEditRow(r); }}
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Coluna J (NF Emitida) fica em branco — os contadores preenchem. Coluna K (NF Enviada) é marcada com "X" ao enviar.
                    </p>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold">Email para o paciente</p>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Para</span>
                      <input value={editEmail.to} onChange={(e) => setEditEmail({ ...editEmail, to: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    </label>
                    <label className="mt-3 block">
                      <span className="text-xs text-muted-foreground">Assunto</span>
                      <input value={editEmail.subject} onChange={(e) => setEditEmail({ ...editEmail, subject: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                    </label>
                    <label className="mt-3 block">
                      <span className="text-xs text-muted-foreground">Mensagem</span>
                      <textarea rows={7} value={editEmail.body} onChange={(e) => setEditEmail({ ...editEmail, body: e.target.value })} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" />
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">📎 PDF da nota será anexado automaticamente.</p>
                  </div>

                  {sendMut.error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      {(sendMut.error as Error).message}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
              <button onClick={() => setActive2(null)} disabled={sendMut.isPending} className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancelar</button>
              <button
                onClick={() => sendMut.mutate()}
                disabled={!preview || sendMut.isPending}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {sendMut.isPending ? "Enviando…" : "Confirmar e enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
