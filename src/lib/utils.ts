import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Converte string de dinheiro brasileiro ("R$ 400,00", "400,00", "400") em número. */
export function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v)
    .replace(/^\s*R\$\s*/i, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Formata número como "R$ 400,00" para exibição. */
export function formatMoney(n: number | string | undefined | null): string {
  const num = typeof n === "number" ? n : parseMoney(n);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

/** Recebe dígitos crus (ex: "40000") e devolve "R$ 400,00". */
export function maskMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  const reais = cents / 100;
  return formatMoney(reais);
}

