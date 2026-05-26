## O que muda

### 1. Nova página "Lançar Pagamento" (`/lancamento`)
Formulário usado quando o pagamento cai no Inter, ANTES do contador emitir a NF.

Campos:
- **Data do pagamento** (default: hoje)
- **Paciente** — busca/autocomplete na aba `Cadastro` (puxa CPF, CEP, email, descrição, valor consulta)
- **Pagante** — opcional, busca na aba `Dados pagantes não pacientes` (se vazio = pagante é o próprio paciente)
- **Valor pago** (R$) — pode cobrir várias consultas
- **Período / observação** (texto livre, ex. "Consultas de 03/04 e 17/04")
- **Toggle: "Emitir NF em nome de"** → Paciente | Pagante
- **Mês de destino** (aba) — sugerido pelo mês da data, com opção de criar a aba

Botão **"Gravar na planilha de Notas"** → grava linha com:
- coluna data, nome+CPF+CEP+email do escolhido no toggle, descrição, valor consulta, valor pago, observação
- **NF Emitida** vazio, **NF Enviada** vazio

### 2. Gestão de Pagantes (aba existente "Dados pagantes não pacientes")
Nova seção em `/cadastro` (ou aba na página atual de cadastro) para:
- listar pagantes
- adicionar pagante: tipo, nome, CPF, beneficiário(s), CEP, email, descrição
- vincular um ou mais beneficiários (autocomplete contra `Cadastro`)

Usa append no mesmo intervalo já lido em `processInvoice`.

### 3. Fluxo de envio (`confirmSend`) — UPDATE ao invés de APPEND
Quando processo o PDF da NF emitida e clico "Enviar":
- localizar a linha na aba do mês pelo nome + competência (ou nome + valor)
- atualizar **apenas a coluna "NF Enviada" = "X"** (e "NF Emitida" = "X" se ainda vazio)
- não criar linha duplicada

Se não achar linha correspondente, mostrar aviso e dar opção de criar nova (comportamento atual).

## Detalhes técnicos

**Novos server functions em `src/lib/notas.functions.ts`:**
- `listCadastro` → retorna pacientes da aba Cadastro (para autocomplete)
- `listPagantes` → retorna linhas da aba "Dados pagantes não pacientes"
- `savePagante` → append na aba "Dados pagantes não pacientes"
- `lancarPagamento` → grava linha pré-nota no mês escolhido (NF Emitida/Enviada em branco). Garante que a aba do mês existe (reusa `createMonthTab`).
- `marcarNfEnviada` → procura linha por (nome, competência) na aba do mês, atualiza colunas J ("NF Emitida") e K ("NF Enviada") via `values.update`. Retorna `{ found: bool, rowIndex }`.

**Modificar `confirmSend`:** chama `marcarNfEnviada` primeiro; se `found=false`, faz o append atual como fallback.

**Novos arquivos de UI:**
- `src/routes/_authenticated/lancamento.tsx` — formulário descrito acima
- Atualizar página de cadastro existente para incluir seção "Pagantes" (ou criar `src/routes/_authenticated/pagantes.tsx`)
- Adicionar link no menu de navegação

**Sem mudanças de banco** — toda a persistência continua nas planilhas Google.

## O que NÃO muda
- estrutura das planilhas (mesmas colunas)
- processInvoice / OCR da NF emitida
- autenticação e Supabase