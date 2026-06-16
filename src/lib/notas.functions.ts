import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const SHEETS = "https://connector-gateway.lovable.dev/google_sheets/v4";
const GMAIL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const MONTHS_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function gw() {
  const lk = process.env.LOVABLE_API_KEY;
  const dk = process.env.GOOGLE_DRIVE_API_KEY;
  const sk = process.env.GOOGLE_SHEETS_API_KEY;
  const mk = process.env.GOOGLE_MAIL_API_KEY;
  if (!lk || !dk || !sk || !mk) throw new Error("Chaves de conector ausentes");
  return { lk, dk, sk, mk };
}

async function getUserSheetIds(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_settings")
    .select("cadastro_sheet_id,notas_sheet_id,email_search_terms")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const cad = (data?.cadastro_sheet_id ?? "").trim();
  const not = (data?.notas_sheet_id ?? "").trim();
  if (!cad || !not) {
    throw new Error("Configure as planilhas Cadastro e Notas em 'Configurações' antes de continuar.");
  }
  const rawTerms = data?.email_search_terms;
  const terms = Array.isArray(rawTerms) && rawTerms.length > 0
    ? rawTerms.map((t: string) => t.trim()).filter((t: string) => t.length > 0)
    : ["Pagamento Pix recebido"];
  return { CADASTRO_ID: cad, NOTAS_ID: not, EMAIL_TERMS: terms };
}

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function nameSimilarity(a: string, b: string) {
  const A = new Set(normalize(a).split(" ").filter((w) => w.length > 1));
  const B = new Set(normalize(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

async function driveDownload(fileId: string) {
  const { lk, dk } = gw();
  const res = await fetch(`${DRIVE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk },
  });
  if (!res.ok) throw new Error(`Drive download falhou ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

async function sheetValues(spreadsheetId: string, range: string) {
  const { lk, sk } = gw();
  const res = await fetch(`${SHEETS}/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
  });
  if (!res.ok) throw new Error(`Sheets read falhou ${res.status}: ${await res.text()}`);
  return (await res.json()) as { values?: string[][] };
}

async function sheetAppend(spreadsheetId: string, range: string, values: any[][]) {
  const { lk, sk } = gw();
  const res = await fetch(
    `${SHEETS}/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
      body: JSON.stringify({ values }),
    },
  );
  if (!res.ok) throw new Error(`Sheets append falhou ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetUpdate(spreadsheetId: string, range: string, values: any[][]) {
  const { lk, sk } = gw();
  const res = await fetch(
    `${SHEETS}/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
      body: JSON.stringify({ values }),
    },
  );
  if (!res.ok) throw new Error(`Sheets update falhou ${res.status}: ${await res.text()}`);
  return res.json();
}

async function findRowInMonth(NOTAS_ID: string, sheetName: string, nome: string, competencia: string) {
  const data = await sheetValues(NOTAS_ID, `${sheetName}!A2:K1000`);
  const rows = data.values ?? [];
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r[1]) continue;
    const nameScore = nameSimilarity(nome, r[1] ?? "");
    const dateMatch = (r[0] ?? "").trim() === competencia.trim();
    const score = nameScore + (dateMatch ? 0.5 : 0);
    if (score > bestScore && nameScore >= 0.5) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx === -1 ? null : { rowNumber: bestIdx + 2, currentRow: rows[bestIdx] };
}

async function fetchSheetMeta(NOTAS_ID: string) {
  const { lk, sk } = gw();
  const url = `${SHEETS}/spreadsheets/${NOTAS_ID}?fields=sheets(properties(sheetId,title,index))`;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
      });
      if (res.ok) {
        return (await res.json()) as { sheets: Array<{ properties: { sheetId: number; title: string; index: number } }> };
      }
      lastErr = `${res.status}: ${await res.text()}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`Sheets meta falhou ${lastErr}`);
}

export const listSheetTabs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { NOTAS_ID } = await getUserSheetIds(context);
    const data = await fetchSheetMeta(NOTAS_ID);
    const tabs = (data.sheets ?? []).map((s) => s.properties.title).filter((t) => MONTHS_PT.includes(t));
    return { tabs };
  });

export const createMonthTab = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { month: string } | undefined) => {
    if (!d?.month || !MONTHS_PT.includes(d.month)) throw new Error("Mês inválido");
    return d;
  })
  .handler(async ({ context, data }) => {
    const { NOTAS_ID } = await getUserSheetIds(context);
    const { lk, sk } = gw();
    const meta = await fetchSheetMeta(NOTAS_ID);
    const existing = meta.sheets.map((s) => s.properties.title);
    if (existing.includes(data.month)) {
      return { success: true, alreadyExisted: true, copiedFrom: null as string | null };
    }

    const targetIdx = MONTHS_PT.indexOf(data.month);
    const monthTabs = meta.sheets.map((s) => s.properties.title).filter((t) => MONTHS_PT.includes(t));
    let source: string | null = null;
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (monthTabs.includes(MONTHS_PT[i])) { source = MONTHS_PT[i]; break; }
    }
    if (!source) {
      const sorted = monthTabs.map((t) => ({ t, i: MONTHS_PT.indexOf(t) })).sort((a, b) => b.i - a.i);
      source = sorted[0]?.t ?? null;
    }

    const addRes = await fetch(`${SHEETS}/spreadsheets/${NOTAS_ID}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: data.month } } }] }),
    });
    if (!addRes.ok) throw new Error(`Criar aba falhou ${addRes.status}: ${await addRes.text()}`);
    const addJson = (await addRes.json()) as { replies: Array<{ addSheet?: { properties: { sheetId: number } } }> };
    const newSheetId = addJson.replies?.[0]?.addSheet?.properties.sheetId;

    if (source && newSheetId != null) {
      const sourceSheetId = meta.sheets.find((s) => s.properties.title === source)?.properties.sheetId;
      if (sourceSheetId != null) {
        const copyRes = await fetch(`${SHEETS}/spreadsheets/${NOTAS_ID}:batchUpdate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": sk },
          body: JSON.stringify({
            requests: [{
              copyPaste: {
                source: { sheetId: sourceSheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 11 },
                destination: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 11 },
                pasteType: "PASTE_NORMAL", pasteOrientation: "NORMAL",
              },
            }],
          }),
        });
        if (!copyRes.ok) throw new Error(`Cabeçalho falhou ${copyRes.status}: ${await copyRes.text()}`);
      }
    }
    return { success: true, alreadyExisted: false, copiedFrom: source };
  });

export const listInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { folderId: string } | undefined) => {
    if (!d?.folderId) throw new Error("folderId obrigatório");
    return d;
  })
  .handler(async ({ data }) => {
    const { lk, dk } = gw();
    const q = encodeURIComponent(`'${data.folderId}' in parents and mimeType='application/pdf' and trashed=false`);
    const res = await fetch(
      `${DRIVE}/files?q=${q}&fields=files(id,name,size,modifiedTime)&pageSize=100&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk } },
    );
    if (!res.ok) throw new Error(`Drive list falhou ${res.status}: ${await res.text()}`);
    const data2 = (await res.json()) as { files: Array<{ id: string; name: string; size?: string; modifiedTime: string }> };
    return { files: data2.files ?? [] };
  });

export const processInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fileId: string; fileName: string }) => d)
  .handler(async ({ context, data }) => {
    const { CADASTRO_ID } = await getUserSheetIds(context);
    const { lk } = gw();
    const pdfBase64 = await driveDownload(data.fileId);

    const prompt = `Esta é uma NFS-e brasileira. Extraia em JSON apenas com chaves: "tomador" (nome da pessoa Tomador do Serviço, exatamente como aparece), "valor_liquido" (string como "R$ 400,00"), "competencia" (data DD/MM/AAAA da competência da NFS-e, sem hora). Retorne APENAS o JSON.`;
    const aiRes = await fetch(AI, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        }],
      }),
    });
    if (!aiRes.ok) throw new Error(`IA falhou ${aiRes.status}: ${await aiRes.text()}`);
    const aiJson = (await aiRes.json()) as any;
    const raw: string = aiJson.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`IA não retornou JSON: ${raw}`);
    const extracted = JSON.parse(match[0]) as { tomador: string; valor_liquido: string; competencia: string };

    const cad = await sheetValues(CADASTRO_ID, "Cadastro!A2:H1000");
    const rows = cad.values ?? [];
    let best: { score: number; row: string[] | null } = { score: 0, row: null };
    for (const r of rows) {
      if (!r[0]) continue;
      const score = nameSimilarity(extracted.tomador, r[0]);
      if (score > best.score) best = { score, row: r };
    }

    let pagante: { row: string[]; score: number } | null = null;
    try {
      const pag = await sheetValues(CADASTRO_ID, "'Dados pagantes não pacientes'!A2:H1000");
      for (const r of pag.values ?? []) {
        if (!r[1]) continue;
        const score = nameSimilarity(extracted.tomador, r[1]);
        if (score > (pagante?.score ?? 0)) pagante = { row: r, score };
      }
    } catch {}

    const matchedFromCadastro = best.score >= 0.5 && best.row;
    const matchedFromPagante = pagante && pagante.score >= 0.5;

    let patient: {
      nome: string; cpf: string; cep: string; email: string;
      descricao: string; valor_consulta: string; observacao: string;
      source: "cadastro" | "pagante" | "none";
    };

    if (matchedFromCadastro && (!matchedFromPagante || best.score >= (pagante?.score ?? 0))) {
      const r = best.row!;
      patient = {
        nome: r[0] ?? "", cpf: r[1] ?? "", cep: r[2] ?? "", email: r[3] ?? "",
        descricao: r[4] ?? "Consulta Psiquiatria",
        valor_consulta: r[5] ?? extracted.valor_liquido,
        observacao: r[7] ?? "", source: "cadastro",
      };
    } else if (matchedFromPagante) {
      const r = pagante!.row;
      const benef = r[2] ?? "";
      let benefRow: string[] | null = null;
      for (const cr of rows) {
        if (!cr[0]) continue;
        if (nameSimilarity(benef, cr[0]) > 0.6) { benefRow = cr; break; }
      }
      patient = {
        nome: benefRow?.[0] ?? benef,
        cpf: benefRow?.[1] ?? r[3] ?? "",
        cep: benefRow?.[2] ?? r[4] ?? "",
        email: r[5] ?? benefRow?.[3] ?? "",
        descricao: r[6] ?? benefRow?.[4] ?? "Consulta Psiquiatria",
        valor_consulta: benefRow?.[5] ?? extracted.valor_liquido,
        observacao: `Pagante: ${r[1]}, CPF ${r[3] ?? ""} | ${r[5] ?? ""}`,
        source: "pagante",
      };
    } else {
      patient = {
        nome: extracted.tomador, cpf: "", cep: "", email: "",
        descricao: "Consulta Psiquiatria",
        valor_consulta: extracted.valor_liquido,
        observacao: "", source: "none",
      };
    }

    const parts = extracted.competencia.split("/");
    let monthName = "";
    if (parts.length === 3) {
      const mi = parseInt(parts[1], 10) - 1;
      if (mi >= 0 && mi < 12) monthName = MONTHS_PT[mi];
    }
    const firstName = patient.nome.split(/\s+/)[0] || "";
    const subject = `Nota Fiscal Consulta - ${monthName}`;
    const body = `Olá, ${firstName}!\n\nSegue em anexo a nota fiscal do pagamento da sua última consulta.\n\nAtenciosamente,\nConsultório Dra. Ingrid Melo - Psiquiatria & Psicoterapia\nCRM 52053 | RQE 45561`;

    const sheetRow = [
      extracted.competencia,
      patient.nome, patient.cpf, patient.cep, patient.email,
      patient.descricao, patient.valor_consulta, extracted.valor_liquido, patient.observacao,
    ];

    return {
      extracted, patient,
      matchScore: Math.max(best.score, pagante?.score ?? 0),
      sheetRow,
      email: { to: patient.email, subject, body },
      pdfBase64, fileName: data.fileName,
    };
  });

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

export const confirmSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    sheetRow: string[]; sheetName: string;
    email: { to: string; subject: string; body: string };
    fileId: string; fileName: string;
  }) => {
    if (!d || typeof d !== "object") throw new Error("Payload inválido");
    if (!Array.isArray(d.sheetRow) || d.sheetRow.length > 16) throw new Error("sheetRow inválido");
    for (const v of d.sheetRow) {
      if (typeof v !== "string" || v.length > 500) throw new Error("Conteúdo da linha inválido");
    }
    if (!MONTHS_PT.includes(d.sheetName)) throw new Error("Mês de destino inválido");
    if (!d.email || typeof d.email !== "object") throw new Error("Email inválido");
    const to = String(d.email.to ?? "").trim();
    if (!EMAIL_RE.test(to)) throw new Error("Email do paciente ausente ou inválido");
    const subject = String(d.email.subject ?? "");
    const body = String(d.email.body ?? "");
    if (subject.length > 300 || body.length > 5000) throw new Error("Conteúdo do email excede o limite");
    if (!DRIVE_ID_RE.test(String(d.fileId ?? ""))) throw new Error("fileId inválido");
    const fileName = String(d.fileName ?? "arquivo.pdf");
    if (fileName.length > 200) throw new Error("Nome do arquivo muito longo");
    return {
      sheetRow: d.sheetRow,
      sheetName: d.sheetName,
      email: { to, subject, body },
      fileId: d.fileId,
      fileName,
    };
  })
  .handler(async ({ context, data }) => {
    const { NOTAS_ID } = await getUserSheetIds(context);

    // Re-download do PDF a partir do Drive (servidor); não confia em base64 do cliente.
    const pdfBase64 = await driveDownload(data.fileId);

    const { lk, mk } = gw();
    const boundary = `b_${Math.random().toString(36).slice(2)}`;
    // Sanitiza para evitar header injection (CRLF) e quebra do MIME
    const safeName = data.fileName.replace(/[\r\n"\\]/g, "_");
    const safeTo = data.email.to.replace(/[\r\n,<>]/g, "");
    const safeSubject = data.email.subject.replace(/[\r\n]/g, " ");
    const safeBody = data.email.body.replace(/\r/g, "");
    const mime = [
      `To: ${safeTo}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      safeBody,
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      pdfBase64,
      `--${boundary}--`,
    ].join("\r\n");

    const raw = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const gRes = await fetch(`${GMAIL}/users/me/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": mk },
      body: JSON.stringify({ raw }),
    });
    if (!gRes.ok) {
      const txt = await gRes.text();
      console.error("Gmail send failed", gRes.status, txt);
      throw new Error(`Falha ao enviar email (${gRes.status})`);
    }

    const nome = data.sheetRow[1] ?? "";
    const competencia = data.sheetRow[0] ?? "";
    const found = await findRowInMonth(NOTAS_ID, data.sheetName, nome, competencia);

    // Persiste estado de "enviada" no banco (idempotente)
    await context.supabase
      .from("sent_invoices")
      .upsert(
        { user_id: context.userId, file_id: data.fileId, file_name: data.fileName, sheet_name: data.sheetName },
        { onConflict: "user_id,file_id" },
      );

    if (found) {
      const jVal = (found.currentRow[9] ?? "").trim() || "X";
      await sheetUpdate(NOTAS_ID, `${data.sheetName}!J${found.rowNumber}:K${found.rowNumber}`, [[jVal, "X"]]);
      return { success: true, updated: true, rowNumber: found.rowNumber };
    }
    const finalRow = [...data.sheetRow.slice(0, 9), "X", "X"];
    await sheetAppend(NOTAS_ID, `${data.sheetName}!A:K`, [finalRow]);
    return { success: true, updated: false };
  });

export const listSentInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sent_invoices")
      .select("file_id")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { fileIds: (data ?? []).map((r: { file_id: string }) => r.file_id) };
  });

export const toggleSentInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fileId: string; fileName?: string; sent: boolean }) => {
    if (!DRIVE_ID_RE.test(String(d?.fileId ?? ""))) throw new Error("fileId inválido");
    return { fileId: d.fileId, fileName: (d.fileName ?? "").slice(0, 200), sent: !!d.sent };
  })
  .handler(async ({ context, data }) => {
    if (data.sent) {
      const { error } = await context.supabase
        .from("sent_invoices")
        .upsert(
          { user_id: context.userId, file_id: data.fileId, file_name: data.fileName },
          { onConflict: "user_id,file_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("sent_invoices")
        .delete()
        .eq("user_id", context.userId)
        .eq("file_id", data.fileId);
      if (error) throw new Error(error.message);
    }
    return { success: true };
  });

export const parsePatientText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string }) => d)
  .handler(async ({ data }) => {
    const { lk } = gw();
    const prompt = `Extraia dados de cadastro de paciente do texto abaixo. Retorne APENAS JSON com as chaves: "nome" (nome completo), "cpf" (apenas dígitos com pontuação padrão XXX.XXX.XXX-XX, ou vazio), "cep" (formato XXXXX-XXX, ou vazio), "email" (vazio se não houver), "descricao" (padrão "Consulta Psiquiatria" se não especificado), "valor_consulta" (formato "R$ 000,00", vazio se não houver). Texto:\n\n${data.text}`;
    const res = await fetch(AI, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`IA falhou ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as any;
    const raw: string = j.choices?.[0]?.message?.content ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`IA não retornou JSON: ${raw}`);
    const p = JSON.parse(m[0]) as Record<string, string>;
    return {
      nome: p.nome ?? "", cpf: p.cpf ?? "", cep: p.cep ?? "", email: p.email ?? "",
      descricao: p.descricao || "Consulta Psiquiatria", valor_consulta: p.valor_consulta ?? "",
    };
  });

export const savePatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    nome: string; cpf: string; cep: string; email: string;
    descricao: string; valor_consulta: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { CADASTRO_ID } = await getUserSheetIds(context);
    if (!data.nome.trim()) throw new Error("Nome é obrigatório");
    await sheetAppend(CADASTRO_ID, "Cadastro!A:F", [[
      data.nome, data.cpf, data.cep, data.email, data.descricao, data.valor_consulta,
    ]]);
    return { success: true };
  });

export const listCadastro = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { CADASTRO_ID } = await getUserSheetIds(context);
    const res = await sheetValues(CADASTRO_ID, "Cadastro!A2:H1000");
    const rows = (res.values ?? []).filter((r) => r[0]);
    return {
      items: rows.map((r) => ({
        nome: r[0] ?? "", cpf: r[1] ?? "", cep: r[2] ?? "", email: r[3] ?? "",
        descricao: r[4] ?? "Consulta Psiquiatria",
        valor_consulta: r[5] ?? "", observacao: r[7] ?? "",
      })),
    };
  });

export const listPagantes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { CADASTRO_ID } = await getUserSheetIds(context);
    try {
      const res = await sheetValues(CADASTRO_ID, "'Dados pagantes não pacientes'!A2:H1000");
      const rows = (res.values ?? []).filter((r) => r[1]);
      return {
        items: rows.map((r) => ({
          tipo: r[0] ?? "", nome: r[1] ?? "", beneficiario: r[2] ?? "",
          cpf: r[3] ?? "", cep: r[4] ?? "", email: r[5] ?? "",
          descricao: r[6] ?? "Consulta Psiquiatria",
        })),
      };
    } catch {
      return { items: [] };
    }
  });

export const savePagante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    tipo?: string; nome: string; beneficiario: string; cpf: string;
    cep: string; email: string; descricao: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { CADASTRO_ID } = await getUserSheetIds(context);
    if (!data.nome.trim()) throw new Error("Nome do pagante é obrigatório");
    await sheetAppend(CADASTRO_ID, "'Dados pagantes não pacientes'!A:G", [[
      data.tipo ?? "Pagante", data.nome, data.beneficiario,
      data.cpf, data.cep, data.email, data.descricao,
    ]]);
    return { success: true };
  });

export const lancarPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    data_pagamento: string; sheetName: string;
    nome: string; cpf: string; cep: string; email: string;
    descricao: string; valor_consulta: string; valor_pagamento: string;
    observacao: string;
  }) => {
    if (!d || typeof d !== "object") throw new Error("Payload inválido");
    if (!MONTHS_PT.includes(d.sheetName)) throw new Error("Mês de destino inválido");
    const fields: Array<keyof typeof d> = [
      "data_pagamento","nome","cpf","cep","email",
      "descricao","valor_consulta","valor_pagamento","observacao",
    ];
    for (const f of fields) {
      const v = (d as any)[f];
      if (typeof v !== "string" || v.length > 500) throw new Error(`Campo ${f} inválido`);
    }
    if (!d.nome.trim()) throw new Error("Nome obrigatório");
    return d;
  })
  .handler(async ({ context, data }) => {
    const { NOTAS_ID } = await getUserSheetIds(context);
    const row = [
      data.data_pagamento, data.nome, data.cpf, data.cep, data.email,
      data.descricao, data.valor_consulta, data.valor_pagamento, data.observacao,
      "", "",
    ];
    await sheetAppend(NOTAS_ID, `${data.sheetName}!A:K`, [row]);
    return { success: true };
  });

// ---------------- Varredura de Pix recebido no Gmail (Banco Inter) ----------------

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function extractText(payload: any): string {
  if (!payload) return "";
  const parts: string[] = [];
  const walk = (p: any) => {
    if (!p) return;
    const mt = p.mimeType ?? "";
    if (p.body?.data && (mt.startsWith("text/") || mt === "")) {
      parts.push(b64urlDecode(p.body.data));
    }
    if (Array.isArray(p.parts)) p.parts.forEach(walk);
  };
  walk(payload);
  // strip HTML tags
  return parts.join("\n").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function gmailDateToBR(internalDateMs: string | number): string {
  const d = new Date(Number(internalDateMs));
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export const scanInterPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number; dateFrom?: string; dateTo?: string } | undefined) => {
    const days = d?.days ?? 15;
    const dateFrom = (d?.dateFrom ?? "").trim();
    const dateTo = (d?.dateTo ?? "").trim();
    if (dateFrom && dateTo) {
      const fromParts = dateFrom.split("/");
      const toParts = dateTo.split("/");
      if (fromParts.length !== 3 || toParts.length !== 3) throw new Error("Formato de data inválido. Use DD/MM/AAAA");
      return { days, dateFrom, dateTo };
    }
    return { days, dateFrom: "", dateTo: "" };
  })
  .handler(async ({ context, data }) => {
    const { CADASTRO_ID, NOTAS_ID, EMAIL_TERMS } = await getUserSheetIds(context);
    const { lk, mk } = gw();
    const monthCache = new Map<string, string[][]>();
    async function getMonthRows(month: string): Promise<string[][]> {
      if (monthCache.has(month)) return monthCache.get(month)!;
      try {
        const d = await sheetValues(NOTAS_ID, `${month}!A2:K1000`);
        const rows = d.values ?? [];
        monthCache.set(month, rows);
        return rows;
      } catch { monthCache.set(month, []); return []; }
    }

    function buildSubjectQuery(terms: string[]) {
      if (terms.length === 1) return `subject:"${terms[0]}"`;
      return "(" + terms.map((t) => `subject:"${t}"`).join(" OR ") + ")";
    }

    let query = "";
    const subjectPart = buildSubjectQuery(EMAIL_TERMS);
    if (data.dateFrom && data.dateTo) {
      const fromParts = data.dateFrom.split("/");
      const toParts = data.dateTo.split("/");
      const gmailFrom = `${fromParts[2]}/${fromParts[1]}/${fromParts[0]}`;
      const gmailTo = `${toParts[2]}/${toParts[1]}/${toParts[0]}`;
      query = encodeURIComponent(`${subjectPart} after:${gmailFrom} before:${gmailTo}`);
    } else {
      query = encodeURIComponent(`${subjectPart} newer_than:${data.days}d`);
    }
    const listRes = await fetch(`${GMAIL}/users/me/messages?maxResults=50&q=${query}`, {
      headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": mk },
    });
    if (!listRes.ok) throw new Error(`Gmail busca falhou ${listRes.status}: ${await listRes.text()}`);
    const list = (await listRes.json()) as { messages?: Array<{ id: string }> };
    const ids = (list.messages ?? []).map((m) => m.id);

    // Load Cadastro + Pagantes once
    const cad = await sheetValues(CADASTRO_ID, "Cadastro!A2:H1000");
    const cadRows = (cad.values ?? []).filter((r) => r[0]);
    let pagRows: string[][] = [];
    try {
      const pag = await sheetValues(CADASTRO_ID, "'Dados pagantes não pacientes'!A2:H1000");
      pagRows = (pag.values ?? []).filter((r) => r[1]);
    } catch {}

    const results: Array<{
      messageId: string;
      date: string;
      pagador: string;
      valor: string;
      alreadyInSheet: boolean;
      match: {
        source: "cadastro" | "pagante" | "none";
        score: number;
        nome: string; cpf: string; cep: string; email: string;
        descricao: string; valor_consulta: string;
        beneficiarioSugerido?: string;
      };
    }> = [];

    for (const id of ids) {
      const mRes = await fetch(`${GMAIL}/users/me/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": mk },
      });
      if (!mRes.ok) continue;
      const msg = (await mRes.json()) as any;
      const text = extractText(msg.payload).slice(0, 4000);
      if (!text) continue;

      // AI extract
      const aiRes = await fetch(AI, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{
            role: "user",
            content: `Este é o corpo de um email do Banco Inter sobre um Pix recebido. Extraia em JSON com chaves exatas: "pagador" (nome completo de quem enviou o Pix), "valor" (string como "R$ 400,00"). Se não conseguir, retorne {"pagador":"","valor":""}. Retorne APENAS o JSON.\n\nEMAIL:\n${text}`,
          }],
        }),
      });
      if (!aiRes.ok) continue;
      const aiJson = (await aiRes.json()) as any;
      const raw: string = aiJson.choices?.[0]?.message?.content ?? "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) continue;
      let parsed: { pagador: string; valor: string };
      try { parsed = JSON.parse(m[0]); } catch { continue; }
      if (!parsed.pagador?.trim()) continue;

      // Match ONLY against Pagantes cadastrados — não inferir paciente a partir do nome do pagador
      let bestPag: { score: number; row: string[] | null } = { score: 0, row: null };
      for (const r of pagRows) {
        const score = nameSimilarity(parsed.pagador, r[1] ?? "");
        if (score > bestPag.score) bestPag = { score, row: r };
      }

      const date = gmailDateToBR(msg.internalDate);
      let match: any;
      if (bestPag.score >= 0.5) {
        const r = bestPag.row!;
        match = {
          source: "pagante", score: bestPag.score,
          nome: r[1] ?? "", cpf: r[3] ?? "", cep: r[4] ?? "", email: r[5] ?? "",
          descricao: r[6] ?? "Consulta Psiquiatria",
          valor_consulta: "",
          beneficiarioSugerido: r[2] ?? "",
        };
      } else {
        match = {
          source: "none", score: 0,
          nome: parsed.pagador, cpf: "", cep: "", email: "",
          descricao: "Consulta Psiquiatria", valor_consulta: "",
        };
      }

      // Detect if already lançado on destination month sheet
      const mIdx = parseInt((date.split("/")[1] ?? ""), 10) - 1;
      const destMonth = mIdx >= 0 && mIdx < 12 ? MONTHS_PT[mIdx] : "";
      const checkName = match.source === "pagante" ? (match.nome) : match.nome;
      let alreadyInSheet = false;
      if (destMonth && checkName) {
        const rows = await getMonthRows(destMonth);
        for (const r of rows) {
          if (!r[1]) continue;
          if (nameSimilarity(checkName, r[1]) >= 0.7) { alreadyInSheet = true; break; }
        }
      }

      results.push({
        messageId: id, date,
        pagador: parsed.pagador, valor: parsed.valor,
        alreadyInSheet,
        match,
      });
    }

    return { items: results };
  });

