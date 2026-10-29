import type { ImportMapping, StockItem, StockTechnician } from "./stock";

/** Uma tabela lida do arquivo: cabeçalho + linhas (cada aba vira uma tabela). */
export interface SheetTable {
  sheet: string;
  headers: string[];
  rows: string[][];
}

export type Field = keyof ImportMapping;

export const FIELD_LABEL: Record<Field, string> = {
  technician: "Colaborador",
  code: "Código do item",
  name: "Item / descrição",
  qty: "Quantidade (saldo)",
  unit: "Unidade",
  min: "Estoque mínimo",
  max: "Estoque máximo",
};

export const DEFAULT_HEADERS: Required<ImportMapping> = {
  technician: "Colaborador",
  code: "Código",
  name: "Item",
  unit: "Unidade",
  qty: "Quantidade",
  min: "Mínimo",
  max: "Máximo",
};

/** Sem acento, maiúsculo, espaços simples. */
export const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9/.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ordem importa: mínimo/máximo antes de quantidade ("ESTOQUE MINIMO" contém "ESTOQUE")
const HEADER_RULES: [Field, RegExp][] = [
  ["min", /\b(MIN|MINIMO|EST\.? MIN|ESTOQUE MIN)/],
  ["max", /\b(MAX|MAXIMO|EST\.? MAX|ESTOQUE MAX)/],
  ["technician", /\b(COLABORADOR|TECNICO|FUNCIONARIO|RESPONSAVEL|PORTADOR|DEPOSITO|ALMOXARIFADO DO|USUARIO)\b/],
  ["code", /\b(COD|CODIGO|COD\. ?PRODUTO|SKU|REF|REFERENCIA|PATRIMONIO)\b/],
  ["qty", /\b(QTD|QTDE|QUANT|QUANTIDADE|SALDO|ESTOQUE|ESTOQUE ATUAL|DISPONIVEL)\b/],
  ["unit", /^(UN|UND|UNID|UNIDADE|UM|U\.M\.|MEDIDA)\b/],
  ["name", /\b(ITEM|DESCRICAO|PRODUTO|MATERIAL|NOME DO PRODUTO|EQUIPAMENTO)\b/],
];

export function guessField(header: string): Field | null {
  const h = norm(header);
  if (!h) return null;
  for (const [f, re] of HEADER_RULES) if (re.test(h)) return f;
  return null;
}

/** Número em formato brasileiro ou americano: "1.234,5", "1234.5", "12 un". */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  s = s.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- leitura ----------

function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function decode(buf: ArrayBuffer): string {
  const utf = new TextDecoder("utf-8").decode(buf);
  // planilha salva pelo Excel em "CSV (separado por vírgulas)" costuma vir em Windows-1252
  const text = utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
  return text.replace(/^﻿/, "");
}

const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return cellText(o.result);
    return "";
  }
  return String(v);
};

/** Acha a linha de cabeçalho (a primeira com pelo menos 2 colunas reconhecidas) e devolve a tabela. */
function toTable(sheet: string, grid: string[][]): SheetTable | null {
  const clean = grid.map((r) => r.map((c) => String(c ?? "").trim()));
  let headerIdx = clean.findIndex((r, i) => i < 25 && new Set(r.map(guessField).filter(Boolean)).size >= 2);
  if (headerIdx < 0) headerIdx = clean.findIndex((r) => r.filter(Boolean).length >= 2);
  if (headerIdx < 0) return null;
  const width = Math.max(...clean.slice(headerIdx).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => clean[headerIdx][i] || `Coluna ${i + 1}`);
  const rows = clean
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { sheet, headers, rows };
}

export async function readSpreadsheet(file: File): Promise<SheetTable[]> {
  const buf = await file.arrayBuffer();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xls") throw new Error("Arquivo .xls (Excel antigo): abra no Excel e salve como .xlsx ou .csv.");
  if (ext === "xlsx" || ext === "xlsm") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const tables: SheetTable[] = [];
    wb.eachSheet((ws) => {
      const grid: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const vals = (row.values as unknown[]).slice(1).map(cellText);
        grid[n - 1] = vals;
      });
      const t = toTable(ws.name, Array.from(grid, (r) => r ?? []));
      if (t && t.rows.length) tables.push(t);
    });
    return tables;
  }
  const t = toTable(file.name, parseCsv(decode(buf)));
  return t && t.rows.length ? [t] : [];
}

export function guessMapping(headers: string[], previous?: ImportMapping | null): ImportMapping {
  const m: ImportMapping = {};
  // o mesmo layout da última importação vence a adivinhação
  if (previous) {
    for (const f of Object.keys(previous) as Field[]) {
      const h = previous[f];
      if (h && headers.includes(h)) m[f] = h;
    }
  }
  for (const h of headers) {
    const f = guessField(h);
    if (f && !m[f] && !Object.values(m).includes(h)) m[f] = h;
  }
  return m;
}

// ---------- correspondência ----------

/** Encontra o técnico pelo nome (sem acento; aceita nome parcial ou primeiro + último nome). */
export function matchTechnician(raw: string, technicians: StockTechnician[]): StockTechnician | null {
  const n = norm(raw);
  if (!n) return null;
  const exact = technicians.find((t) => norm(t.name) === n);
  if (exact) return exact;
  const tokens = n.split(" ").filter((t) => t.length > 1 && !["DE", "DA", "DO", "DOS", "DAS", "E"].includes(t));
  const scored = technicians
    .map((t) => {
      const tt = norm(t.name).split(" ");
      const hits = tokens.filter((x) => tt.includes(x)).length;
      const firstOk = tt[0] === tokens[0];
      return { t, hits, firstOk, all: hits === Math.min(tokens.length, tt.length) };
    })
    .filter((s) => s.firstOk && (s.all || s.hits >= 2))
    .sort((a, b) => b.hits - a.hits);
  if (scored.length === 1 || (scored.length > 1 && scored[0].hits > scored[1].hits)) return scored[0].t;
  return null;
}

export function matchItem(code: string, name: string, items: StockItem[]): StockItem | null {
  const c = norm(code);
  if (c) {
    const byCode = items.find((i) => i.code && norm(i.code) === c);
    if (byCode) return byCode;
  }
  const n = norm(name);
  if (!n) return null;
  return items.find((i) => norm(i.name) === n) ?? null;
}

// ---------- exportação ----------

export interface ExportRow {
  technician: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  min: number | null;
  max: number | null;
  extra?: Record<string, string | number>;
}

/** Monta a planilha no mesmo layout de colunas usado na importação (para alimentar o outro sistema). */
export async function downloadSpreadsheet(fileBase: string, rows: ExportRow[], mapping: ImportMapping | null, format: "xlsx" | "csv") {
  const h = { ...DEFAULT_HEADERS, ...(mapping ?? {}) };
  const extraCols = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))];
  const headers = [h.technician, h.code, h.name, h.unit, h.qty, h.min, h.max, ...extraCols];
  const body = rows.map((r) => [r.technician, r.code, r.name, r.unit, r.qty, r.min ?? "", r.max ?? "", ...extraCols.map((c) => r.extra?.[c] ?? "")]);
  let blob: Blob;
  if (format === "csv") {
    const esc = (v: string | number) => {
      const s = typeof v === "number" ? String(v).replace(".", ",") : v;
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    blob = new Blob(["﻿" + [headers, ...body].map((r) => r.map(esc).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  } else {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Estoque");
    ws.addRow(headers).font = { bold: true };
    for (const r of body) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      col.width = Math.min(45, Math.max(10, ...[headers[i], ...body.map((r) => r[i])].map((v) => String(v ?? "").length + 2)));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileBase}.${format}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
