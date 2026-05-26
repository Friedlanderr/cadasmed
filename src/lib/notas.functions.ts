import { createServerFn } from "@tanstack/react-start";

const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const SHEETS = "https://connector-gateway.lovable.dev/google_sheets/v4";
const GMAIL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";
const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

const FOLDER_ID = "1dxcGfLTlOHAClmM0zDowtGY7aT7cHous";
const CADASTRO_ID = "172pPFDBnOl2JYng7eupQKCImVj3y_-lT6P7PEqQUMm0";
const NOTAS_ID = "1wPIjvtVUHinI9ijKr2cKMXa2LHmjrifZAAA8LfHkCd0";

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

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lk}`,
        "X-Connection-Api-Key": sk,
      },
      body: JSON.stringify({ values }),
    },
  );
  if (!res.ok) throw new Error(`Sheets append falhou ${res.status}: ${await res.text()}`);
  return res.json();
}

export const listInvoices = createServerFn({ method: "GET" }).handler(async () => {
  const { lk, dk } = gw();
  const q = encodeURIComponent(
    `'${FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`,
  );
  const res = await fetch(
    `${DRIVE}/files?q=${q}&fields=files(id,name,size,modifiedTime)&pageSize=100&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk } },
  );
  if (!res.ok) throw new Error(`Drive list falhou ${res.status}`);
  const data = (await res.json()) as {
    files: Array<{ id: string; name: string; size?: string; modifiedTime: string }>;
  };
  return { files: data.files ?? [] };
});

export const processInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: { fileId: string; fileName: string }) => d)
  .handler(async ({ data }) => {
    const { lk } = gw();
    const pdfBase64 = await driveDownload(data.fileId);

    // Extract fields with AI vision (PDF inline)
    const prompt = `Esta é uma NFS-e brasileira. Extraia em JSON apenas com chaves: "tomador" (nome da pessoa Tomador do Serviço, exatamente como aparece), "valor_liquido" (string como "R$ 400,00"), "competencia" (data DD/MM/AAAA da competência da NFS-e, sem hora). Retorne APENAS o JSON.`;
    const aiRes = await fetch(AI, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lk}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
              },
            ],
          },
        ],
      }),
    });
    if (!aiRes.ok) {
      throw new Error(`IA falhou ${aiRes.status}: ${await aiRes.text()}`);
    }
    const aiJson = (await aiRes.json()) as any;
    const raw: string = aiJson.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`IA não retornou JSON: ${raw}`);
    const extracted = JSON.parse(match[0]) as {
      tomador: string;
      valor_liquido: string;
      competencia: string;
    };

    // Match against Cadastro
    const cad = await sheetValues(CADASTRO_ID, "Cadastro!A2:H1000");
    const rows = cad.values ?? [];
    let best: { score: number; row: string[] | null } = { score: 0, row: null };
    for (const r of rows) {
      if (!r[0]) continue;
      const score = nameSimilarity(extracted.tomador, r[0]);
      if (score > best.score) best = { score, row: r };
    }

    // Also check "Dados pagantes não pacientes" (pagante → beneficiado)
    let pagante: { row: string[]; score: number } | null = null;
    try {
      const pag = await sheetValues(
        CADASTRO_ID,
        "'Dados pagantes não pacientes'!A2:H1000",
      );
      for (const r of pag.values ?? []) {
        // structure: A=empty, B=Nome pagante, C=Beneficiado, D=CPF pagante, E=CEP, F=Email, G=Descrição
        if (!r[1]) continue;
        const score = nameSimilarity(extracted.tomador, r[1]);
        if (score > (pagante?.score ?? 0)) pagante = { row: r, score };
      }
    } catch {
      // ignore
    }

    const matchedFromCadastro = best.score >= 0.5 && best.row;
    const matchedFromPagante = pagante && pagante.score >= 0.5;

    let patient: {
      nome: string;
      cpf: string;
      cep: string;
      email: string;
      descricao: string;
      valor_consulta: string;
      observacao: string;
      source: "cadastro" | "pagante" | "none";
    };

    if (matchedFromCadastro && (!matchedFromPagante || best.score >= (pagante?.score ?? 0))) {
      const r = best.row!;
      patient = {
        nome: r[0] ?? "",
        cpf: r[1] ?? "",
        cep: r[2] ?? "",
        email: r[3] ?? "",
        descricao: r[4] ?? "Consulta Psiquiatria",
        valor_consulta: r[5] ?? extracted.valor_liquido,
        observacao: r[7] ?? "",
        source: "cadastro",
      };
    } else if (matchedFromPagante) {
      const r = pagante!.row;
      // Find beneficiado in cadastro to get patient email
      const benef = r[2] ?? "";
      let benefRow: string[] | null = null;
      for (const cr of rows) {
        if (!cr[0]) continue;
        if (nameSimilarity(benef, cr[0]) > 0.6) {
          benefRow = cr;
          break;
        }
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
        nome: extracted.tomador,
        cpf: "",
        cep: "",
        email: "",
        descricao: "Consulta Psiquiatria",
        valor_consulta: extracted.valor_liquido,
        observacao: "",
        source: "none",
      };
    }

    // Build email
    const parts = extracted.competencia.split("/");
    let monthName = "";
    if (parts.length === 3) {
      const mi = parseInt(parts[1], 10) - 1;
      if (mi >= 0 && mi < 12) monthName = MONTHS_PT[mi];
    }
    const firstName = patient.nome.split(/\s+/)[0] || "";
    const subject = `Nota Fiscal Consulta - ${monthName}`;
    const body = `Olá, ${firstName}!\n\nSegue em anexo a nota fiscal do pagamento da sua última consulta.\n\nAtenciosamente,\nConsultório Dra. Ingrid Melo\nPsiquiatra – CRM 52053 | RQE 45561`;

    const sheetRow = [
      extracted.competencia,
      patient.nome,
      patient.cpf,
      patient.cep,
      patient.email,
      patient.descricao,
      patient.valor_consulta,
      extracted.valor_liquido,
      patient.observacao,
      "X", // NF Emitida
      "", // NF Enviada — preenchido após envio
    ];

    return {
      extracted,
      patient,
      matchScore: Math.max(best.score, pagante?.score ?? 0),
      sheetRow,
      email: { to: patient.email, subject, body },
      pdfBase64,
      fileName: data.fileName,
    };
  });

export const confirmSend = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      sheetRow: string[];
      email: { to: string; subject: string; body: string };
      pdfBase64: string;
      fileName: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    if (!data.email.to || !data.email.to.includes("@")) {
      throw new Error("Email do paciente ausente ou inválido");
    }

    // 1. Send Gmail with attachment
    const { lk, mk } = gw();
    const boundary = `b_${Math.random().toString(36).slice(2)}`;
    const safeName = data.fileName.replace(/[\r\n"]/g, "_");
    const mime = [
      `To: ${data.email.to}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(data.email.subject)))}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      data.email.body,
      "",
      `--${boundary}`,
      `Content-Type: application/pdf; name="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      data.pdfBase64,
      `--${boundary}--`,
    ].join("\r\n");

    const raw = btoa(unescape(encodeURIComponent(mime)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gRes = await fetch(`${GMAIL}/users/me/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lk}`,
        "X-Connection-Api-Key": mk,
      },
      body: JSON.stringify({ raw }),
    });
    if (!gRes.ok) {
      throw new Error(`Gmail falhou ${gRes.status}: ${await gRes.text()}`);
    }

    // 2. Append to Notas Maio (mark NF Enviada with X now that email was sent)
    const finalRow = [...data.sheetRow];
    finalRow[10] = "X";
    await sheetAppend(NOTAS_ID, "Maio!A:K", [finalRow]);

    return { success: true };
  });
