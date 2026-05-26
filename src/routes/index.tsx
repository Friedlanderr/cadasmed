import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listInvoices, processInvoice, confirmSend } from "@/lib/notas.functions";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Notas Fiscais — Consultório Dra. Ingrid Melo" },
      { name: "description", content: "Processamento automático de notas fiscais a partir do Google Drive, com cadastro de pacientes e envio por email." },
    ],
  }),
});

type Invoice = { id: string; name: string; modifiedTime: string; size?: string };
type Preview = Awaited<ReturnType<typeof processInvoice>>;

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
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => list(),
  });

  const [active, setActive] = useState<Invoice | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editEmail, setEditEmail] = useState({ to: "", subject: "", body: "" });
  const [editRow, setEditRow] = useState<string[]>([]);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const procMut = useMutation({
    mutationFn: async (inv: Invoice) => process({ data: { fileId: inv.id, fileName: inv.name } }),
    onSuccess: (p) => {
      setPreview(p);
      setEditEmail(p.email);
      setEditRow(p.sheetRow);
    },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("Sem preview");
      return confirm({
        data: {
          sheetRow: editRow,
          email: editEmail,
          pdfBase64: preview.pdfBase64,
          fileName: preview.fileName,
        },
      });
    },
    onSuccess: () => {
      if (active) setSent((s) => new Set(s).add(active.id));
      setActive(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const COLS = ["Data","Nome","CPF","CEP","Email","Descrição","Valor Consulta","Valor Pagamento","Observação","NF Emitida","NF Enviada"];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {fonts}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Consultório Dra. Ingrid Melo</p>
          <h1 className="mt-2 text-4xl font-semibold">Processamento de Notas Fiscais</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Lê NFS-e da pasta do Drive, cruza com o cadastro de pacientes, abre uma revisão e envia a nota por email com anexo.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Notas na pasta</h2>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {isFetching ? "Atualizando…" : "Atualizar"}
          </button>
        </div>

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
                  {isSent && (
                    <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-medium text-success">Enviado ✓</span>
                  )}
                  <button
                    onClick={() => { setActive(f); setPreview(null); procMut.mutate(f); }}
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

      {active && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4" onClick={() => !sendMut.isPending && setActive(null)}>
          <div className="my-8 w-full max-w-4xl rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">Revisão</h3>
                  <p className="mt-1 text-sm text-muted-foreground truncate">{active.name}</p>
                </div>
                <button onClick={() => !sendMut.isPending && setActive(null)} className="text-muted-foreground hover:text-foreground">✕</button>
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
                    <p className="mb-2 text-sm font-semibold">Linha que será adicionada na planilha (Maio)</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {COLS.slice(0, 9).map((c, i) => (
                        <label key={c} className="block">
                          <span className="text-xs text-muted-foreground">{c}</span>
                          <input
                            value={editRow[i] ?? ""}
                            onChange={(e) => {
                              const r = [...editRow];
                              r[i] = e.target.value;
                              setEditRow(r);
                            }}
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Colunas J e K serão marcadas como "X" (NF emitida e enviada).</p>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold">Email para o paciente</p>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Para</span>
                      <input
                        value={editEmail.to}
                        onChange={(e) => setEditEmail({ ...editEmail, to: e.target.value })}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="mt-3 block">
                      <span className="text-xs text-muted-foreground">Assunto</span>
                      <input
                        value={editEmail.subject}
                        onChange={(e) => setEditEmail({ ...editEmail, subject: e.target.value })}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <label className="mt-3 block">
                      <span className="text-xs text-muted-foreground">Mensagem</span>
                      <textarea
                        rows={7}
                        value={editEmail.body}
                        onChange={(e) => setEditEmail({ ...editEmail, body: e.target.value })}
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                      />
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
              <button
                onClick={() => setActive(null)}
                disabled={sendMut.isPending}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
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
