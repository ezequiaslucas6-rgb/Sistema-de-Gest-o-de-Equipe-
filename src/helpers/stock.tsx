import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toast } from "./toast";

export type StockSector = "suporte" | "infraestrutura" | "ambos";
export type CountStatus = "rascunho" | "finalizada";
export type BalanceSource = "importacao" | "conferencia" | "manual";

export interface StockItem {
  id: number;
  code: string | null;
  name: string;
  unit: string;
  category: string | null;
  sector: StockSector;
  kitQty: number;
  minQty: number;
  maxQty: number | null;
  active: boolean;
}

export interface StockBalance {
  technicianId: number;
  itemId: number;
  qty: number;
  source: BalanceSource;
  updatedAt: string;
}

export interface StockLine {
  id?: number;
  itemId: number;
  expected: number;
  counted: number | null;
  note: string | null;
  minQty?: number | null;
  maxQty?: number | null;
}

export interface StockCount {
  id: number;
  teamId: number | null;
  technicianId: number | null;
  date: string;
  checker: string;
  status: CountStatus;
  notes: string | null;
  createdAt: string;
  finishedAt: string | null;
  lines: StockLine[];
}

export interface StockTeam {
  id: number;
  code: string;
  name: string;
  sector: "suporte" | "infraestrutura";
  vehicle: string | null;
}

export interface StockTechnician {
  id: number;
  name: string;
  teamId: number | null;
}

/** Colunas da planilha do outro sistema (nome do cabeçalho original de cada campo). */
export interface ImportMapping {
  technician?: string;
  code?: string;
  name?: string;
  qty?: string;
  unit?: string;
  category?: string;
  min?: string;
  max?: string;
  /** dono do estoque reconhecido em importações anteriores (ex.: "Almoxarifado 373" → id do técnico) */
  owners?: Record<string, number>;
}

export interface StockImport {
  id: number;
  fileName: string | null;
  importedAt: string;
  importedBy: string | null;
  technicians: number;
  rows: number;
  mapping: ImportMapping | null;
}

export interface StockData {
  teams: StockTeam[];
  technicians: StockTechnician[];
  items: StockItem[];
  balances: StockBalance[];
  counts: StockCount[];
  imports: StockImport[];
}

export const STOCK_QUERY_KEY = ["stock"] as const;
const STOCK_TABLES = ["escala_stock_items", "escala_stock_counts", "escala_stock_count_lines", "escala_stock_balances", "escala_stock_imports"];

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** Diferença de uma linha: contado − esperado (null enquanto não foi contado). */
export const lineDiff = (l: Pick<StockLine, "expected" | "counted">) => (l.counted == null ? null : Number(l.counted) - Number(l.expected));

export const itemFitsSector = (item: StockItem, sector: "suporte" | "infraestrutura") => item.sector === "ambos" || item.sector === sector;

export type Level = "abaixo" | "acima" | "ok";

/** Situação de uma quantidade frente ao mínimo e máximo do item. */
export function stockLevel(qty: number, min: number | null | undefined, max: number | null | undefined): Level {
  if (min != null && min > 0 && qty < min) return "abaixo";
  if (max != null && qty > max) return "acima";
  return "ok";
}

/** Quanto mandar (positivo) ou recolher (negativo) para o colaborador ficar entre o mínimo e o máximo. */
export function restock(qty: number, min: number | null | undefined, max: number | null | undefined): number {
  const level = stockLevel(qty, min, max);
  if (level === "abaixo") return (max != null && max > 0 ? max : (min ?? 0)) - qty;
  if (level === "acima") return (max ?? qty) - qty;
  return 0;
}

const PAGE = 1000;
/** Lê a tabela inteira (o PostgREST devolve no máximo 1000 linhas por vez). */
async function selectAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await supabase.from(table).select("*").order("id").range(from, from + PAGE - 1)) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadStock(): Promise<StockData> {
  const [teams, techs, items, counts, lines, balances, imports] = await Promise.all([
    supabase.from("escala_teams").select("id, code, name, sector, vehicle").order("code"),
    supabase.from("escala_technicians").select("id, name, team_id").order("name"),
    supabase.from("escala_stock_items").select("*").order("name"),
    supabase.from("escala_stock_counts").select("*").order("date", { ascending: false }).order("id", { ascending: false }),
    selectAll("escala_stock_count_lines"),
    selectAll("escala_stock_balances"),
    supabase.from("escala_stock_imports").select("*").order("imported_at", { ascending: false }).limit(50),
  ]);
  const byCount = new Map<number, StockLine[]>();
  for (const l of lines) {
    const arr = byCount.get(num(l.count_id)) ?? [];
    arr.push({
      id: num(l.id),
      itemId: num(l.item_id),
      expected: num(l.expected),
      counted: numOrNull(l.counted),
      note: (l.note as string) ?? null,
      minQty: numOrNull(l.min_qty),
      maxQty: numOrNull(l.max_qty),
    });
    byCount.set(num(l.count_id), arr);
  }
  return {
    teams: (must(teams) as Record<string, unknown>[]).map((t) => ({
      id: num(t.id),
      code: String(t.code),
      name: String(t.name),
      sector: t.sector as StockTeam["sector"],
      vehicle: (t.vehicle as string) ?? null,
    })),
    technicians: (must(techs) as Record<string, unknown>[]).map((t) => ({ id: num(t.id), name: String(t.name), teamId: t.team_id == null ? null : num(t.team_id) })),
    items: (must(items) as Record<string, unknown>[]).map((i) => ({
      id: num(i.id),
      code: (i.code as string) || null,
      name: String(i.name),
      unit: String(i.unit ?? "un"),
      category: (i.category as string) ?? null,
      sector: (i.sector as StockSector) ?? "ambos",
      kitQty: num(i.kit_qty),
      minQty: num(i.min_qty),
      maxQty: numOrNull(i.max_qty),
      active: i.active !== false,
    })),
    balances: balances.map((b) => ({
      technicianId: num(b.technician_id),
      itemId: num(b.item_id),
      qty: num(b.qty),
      source: (b.source as BalanceSource) ?? "importacao",
      updatedAt: String(b.updated_at ?? ""),
    })),
    counts: (must(counts) as Record<string, unknown>[]).map((c) => ({
      id: num(c.id),
      teamId: c.team_id == null ? null : num(c.team_id),
      technicianId: c.technician_id == null ? null : num(c.technician_id),
      date: String(c.date),
      checker: String(c.checker ?? ""),
      status: (c.status as CountStatus) ?? "rascunho",
      notes: (c.notes as string) ?? null,
      createdAt: String(c.created_at ?? ""),
      finishedAt: (c.finished_at as string) ?? null,
      lines: byCount.get(num(c.id)) ?? [],
    })),
    imports: (must(imports) as Record<string, unknown>[]).map((i) => ({
      id: num(i.id),
      fileName: (i.file_name as string) ?? null,
      importedAt: String(i.imported_at ?? ""),
      importedBy: (i.imported_by as string) ?? null,
      technicians: num(i.technicians),
      rows: num(i.rows),
      mapping: (i.mapping as ImportMapping) ?? null,
    })),
  };
}

export function useStockData() {
  const qc = useQueryClient();
  // outro computador gravou: recarrega
  useEffect(() => {
    let timer: number | undefined;
    const channel = supabase.channel("escala-estoque");
    for (const table of STOCK_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => qc.invalidateQueries({ queryKey: STOCK_QUERY_KEY }), 400);
      });
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc]);
  return useQuery({ queryKey: STOCK_QUERY_KEY, queryFn: loadStock, placeholderData: (prev) => prev });
}

async function currentEmail() {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

async function upsertBalances(rows: { technicianId: number; itemId: number; qty: number }[], source: BalanceSource) {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ technician_id: r.technicianId, item_id: r.itemId, qty: r.qty, source, updated_at: now }));
    must(await supabase.from("escala_stock_balances").upsert(chunk, { onConflict: "technician_id,item_id" }).select("id"));
  }
}

export interface SaveCountInput {
  id?: number;
  technicianId: number;
  teamId: number | null;
  date: string;
  checker: string;
  status: CountStatus;
  notes: string | null;
  lines: StockLine[];
  /** ao finalizar, o saldo do colaborador passa a ser o que foi contado */
  updateBalances?: boolean;
}

async function saveCount(input: SaveCountInput): Promise<number> {
  if (!input.checker.trim()) throw new Error("Informe quem fez a conferência.");
  if (input.status === "finalizada" && input.lines.some((l) => l.counted == null)) {
    throw new Error("Para finalizar, preencha a quantidade contada de todos os itens.");
  }
  const row = {
    team_id: input.teamId,
    technician_id: input.technicianId,
    date: input.date,
    checker: input.checker.trim(),
    status: input.status,
    notes: input.notes?.trim() || null,
    finished_at: input.status === "finalizada" ? new Date().toISOString() : null,
  };
  let id = input.id;
  if (id) {
    must(await supabase.from("escala_stock_counts").update(row).eq("id", id).select("id"));
  } else {
    const created = must(await supabase.from("escala_stock_counts").insert({ ...row, created_by: await currentEmail() }).select("id").single()) as { id: number };
    id = created.id;
  }
  const lines = input.lines.map((l) => ({
    count_id: id,
    item_id: l.itemId,
    expected: l.expected,
    counted: l.counted,
    note: l.note?.trim() || null,
    min_qty: l.minQty ?? null,
    max_qty: l.maxQty ?? null,
  }));
  if (lines.length) must(await supabase.from("escala_stock_count_lines").upsert(lines, { onConflict: "count_id,item_id" }).select("id"));
  // itens tirados da conferência
  const keep = input.lines.map((l) => l.itemId);
  let del = supabase.from("escala_stock_count_lines").delete().eq("count_id", id);
  if (keep.length) del = del.not("item_id", "in", `(${keep.join(",")})`);
  must(await del.select("id"));
  if (input.status === "finalizada" && input.updateBalances) {
    await upsertBalances(
      input.lines.map((l) => ({ technicianId: input.technicianId, itemId: l.itemId, qty: Number(l.counted) })),
      "conferencia",
    );
  }
  return id!;
}

async function deleteCount(id: number) {
  must(await supabase.from("escala_stock_counts").delete().eq("id", id).select("id"));
}

export interface SaveItemInput {
  id?: number;
  code: string | null;
  name: string;
  unit: string;
  category: string | null;
  sector: StockSector;
  kitQty: number;
  minQty: number;
  maxQty: number | null;
  active: boolean;
}

const itemRow = (input: Omit<SaveItemInput, "id">) => ({
  code: input.code?.trim() || null,
  name: input.name.trim(),
  unit: input.unit.trim() || "un",
  category: input.category?.trim() || null,
  sector: input.sector,
  kit_qty: input.kitQty,
  min_qty: input.minQty,
  max_qty: input.maxQty,
  active: input.active,
});

async function saveItem(input: SaveItemInput) {
  if (!input.name.trim()) throw new Error("Informe o nome do item.");
  if (input.maxQty != null && input.maxQty < input.minQty) throw new Error("O máximo não pode ser menor que o mínimo.");
  const res = input.id
    ? await supabase.from("escala_stock_items").update(itemRow(input)).eq("id", input.id).select("id")
    : await supabase.from("escala_stock_items").insert(itemRow(input)).select("id");
  if (res.error && /duplicate|unique/i.test(res.error.message)) throw new Error("Já existe um item com esse código.");
  must(res);
}

export interface ImportInput {
  fileName: string;
  mapping: ImportMapping;
  /** itens que ainda não existem no cadastro; `key` liga às linhas */
  newItems: { key: string; code: string | null; name: string; unit: string; category: string | null; sector: StockSector; minQty: number; maxQty: number | null }[];
  /** mínimo/máximo vindos da planilha para itens já cadastrados */
  itemLimits: { itemId: number; minQty: number | null; maxQty: number | null }[];
  rows: { technicianId: number; itemId?: number; newItemKey?: string; qty: number }[];
  /** zera os itens que o colaborador tinha e não vieram no arquivo */
  replace: boolean;
}

async function importBalances(input: ImportInput): Promise<{ technicians: number; rows: number; created: number }> {
  const keyToId = new Map<string, number>();
  for (const it of input.newItems) {
    const created = must(
      await supabase
        .from("escala_stock_items")
        .insert(itemRow({ ...it, kitQty: 0, active: true }))
        .select("id")
        .single(),
    ) as { id: number };
    keyToId.set(it.key, created.id);
  }
  for (const l of input.itemLimits) {
    const patch: Record<string, number | null> = {};
    if (l.minQty != null) patch.min_qty = l.minQty;
    if (l.maxQty != null) patch.max_qty = l.maxQty;
    if (Object.keys(patch).length) must(await supabase.from("escala_stock_items").update(patch).eq("id", l.itemId).select("id"));
  }
  // a mesma linha repetida no arquivo soma
  const merged = new Map<string, { technicianId: number; itemId: number; qty: number }>();
  for (const r of input.rows) {
    const itemId = r.itemId ?? (r.newItemKey ? keyToId.get(r.newItemKey) : undefined);
    if (!itemId) continue;
    const k = `${r.technicianId}|${itemId}`;
    const cur = merged.get(k);
    if (cur) cur.qty += r.qty;
    else merged.set(k, { technicianId: r.technicianId, itemId, qty: r.qty });
  }
  const rows = [...merged.values()];
  const techs = [...new Set(rows.map((r) => r.technicianId))];
  if (input.replace) {
    for (const t of techs) {
      const keep = rows.filter((r) => r.technicianId === t).map((r) => r.itemId);
      let q = supabase.from("escala_stock_balances").update({ qty: 0, source: "importacao", updated_at: new Date().toISOString() }).eq("technician_id", t);
      if (keep.length) q = q.not("item_id", "in", `(${keep.join(",")})`);
      must(await q.select("id"));
    }
  }
  await upsertBalances(rows, "importacao");
  must(
    await supabase
      .from("escala_stock_imports")
      .insert({ file_name: input.fileName, imported_by: await currentEmail(), technicians: techs.length, rows: rows.length, mapping: input.mapping })
      .select("id"),
  );
  return { technicians: techs.length, rows: rows.length, created: input.newItems.length };
}

export function useStockMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
  const fail = (err: Error) => toast.error(err.message);
  return {
    saveCount: useMutation({ mutationFn: saveCount, onSuccess: done, onError: fail }),
    deleteCount: useMutation({ mutationFn: deleteCount, onSuccess: done, onError: fail }),
    saveItem: useMutation({ mutationFn: saveItem, onSuccess: done, onError: fail }),
    importBalances: useMutation({ mutationFn: importBalances, onSuccess: done, onError: fail }),
  };
}
