import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toast } from "./toast";

export type StockSector = "suporte" | "infraestrutura" | "ambos";
export type CountStatus = "rascunho" | "finalizada";

export interface StockItem {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  sector: StockSector;
  kitQty: number;
  active: boolean;
}

export interface StockLine {
  id?: number;
  itemId: number;
  expected: number;
  counted: number | null;
  note: string | null;
}

export interface StockCount {
  id: number;
  teamId: number;
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

export interface StockData {
  teams: StockTeam[];
  technicians: { id: number; name: string; teamId: number | null }[];
  items: StockItem[];
  counts: StockCount[];
}

export const STOCK_QUERY_KEY = ["stock"] as const;
const STOCK_TABLES = ["escala_stock_items", "escala_stock_counts", "escala_stock_count_lines"];

const num = (v: unknown) => (v == null ? 0 : Number(v));
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** Diferença de uma linha: contado − esperado (null enquanto não foi contado). */
export const lineDiff = (l: Pick<StockLine, "expected" | "counted">) => (l.counted == null ? null : Number(l.counted) - Number(l.expected));

export const itemFitsSector = (item: StockItem, sector: "suporte" | "infraestrutura") => item.sector === "ambos" || item.sector === sector;

export async function loadStock(): Promise<StockData> {
  const [teams, techs, items, counts, lines] = await Promise.all([
    supabase.from("escala_teams").select("id, code, name, sector, vehicle").order("code"),
    supabase.from("escala_technicians").select("id, name, team_id").order("name"),
    supabase.from("escala_stock_items").select("*").order("name"),
    supabase.from("escala_stock_counts").select("*").order("date", { ascending: false }).order("id", { ascending: false }),
    supabase.from("escala_stock_count_lines").select("*"),
  ]);
  const byCount = new Map<number, StockLine[]>();
  for (const l of must(lines) as Record<string, unknown>[]) {
    const arr = byCount.get(num(l.count_id)) ?? [];
    arr.push({ id: num(l.id), itemId: num(l.item_id), expected: num(l.expected), counted: l.counted == null ? null : num(l.counted), note: (l.note as string) ?? null });
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
      name: String(i.name),
      unit: String(i.unit ?? "un"),
      category: (i.category as string) ?? null,
      sector: (i.sector as StockSector) ?? "ambos",
      kitQty: num(i.kit_qty),
      active: i.active !== false,
    })),
    counts: (must(counts) as Record<string, unknown>[]).map((c) => ({
      id: num(c.id),
      teamId: num(c.team_id),
      date: String(c.date),
      checker: String(c.checker ?? ""),
      status: (c.status as CountStatus) ?? "rascunho",
      notes: (c.notes as string) ?? null,
      createdAt: String(c.created_at ?? ""),
      finishedAt: (c.finished_at as string) ?? null,
      lines: byCount.get(num(c.id)) ?? [],
    })),
  };
}

export function useStockData() {
  const qc = useQueryClient();
  // outro computador gravou uma conferência: recarrega
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

export interface SaveCountInput {
  id?: number;
  teamId: number;
  date: string;
  checker: string;
  status: CountStatus;
  notes: string | null;
  lines: StockLine[];
}

async function saveCount(input: SaveCountInput): Promise<number> {
  if (!input.checker.trim()) throw new Error("Informe quem fez a conferência.");
  if (input.status === "finalizada" && input.lines.some((l) => l.counted == null)) {
    throw new Error("Para finalizar, preencha a quantidade contada de todos os itens.");
  }
  const { data: user } = await supabase.auth.getUser();
  const row = {
    team_id: input.teamId,
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
    const created = must(await supabase.from("escala_stock_counts").insert({ ...row, created_by: user.user?.email ?? null }).select("id").single()) as { id: number };
    id = created.id;
  }
  const lines = input.lines.map((l) => ({ count_id: id, item_id: l.itemId, expected: l.expected, counted: l.counted, note: l.note?.trim() || null }));
  if (lines.length) must(await supabase.from("escala_stock_count_lines").upsert(lines, { onConflict: "count_id,item_id" }).select("id"));
  // itens tirados da conferência
  const keep = input.lines.map((l) => l.itemId);
  let del = supabase.from("escala_stock_count_lines").delete().eq("count_id", id);
  if (keep.length) del = del.not("item_id", "in", `(${keep.join(",")})`);
  must(await del.select("id"));
  return id!;
}

async function deleteCount(id: number) {
  must(await supabase.from("escala_stock_counts").delete().eq("id", id).select("id"));
}

export interface SaveItemInput {
  id?: number;
  name: string;
  unit: string;
  category: string | null;
  sector: StockSector;
  kitQty: number;
  active: boolean;
}

async function saveItem(input: SaveItemInput) {
  if (!input.name.trim()) throw new Error("Informe o nome do item.");
  const row = { name: input.name.trim(), unit: input.unit.trim() || "un", category: input.category?.trim() || null, sector: input.sector, kit_qty: input.kitQty, active: input.active };
  if (input.id) must(await supabase.from("escala_stock_items").update(row).eq("id", input.id).select("id"));
  else must(await supabase.from("escala_stock_items").insert(row).select("id"));
}

export function useStockMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
  const fail = (err: Error) => toast.error(err.message);
  return {
    saveCount: useMutation({ mutationFn: saveCount, onSuccess: done, onError: fail }),
    deleteCount: useMutation({ mutationFn: deleteCount, onSuccess: done, onError: fail }),
    saveItem: useMutation({ mutationFn: saveItem, onSuccess: done, onError: fail }),
  };
}
