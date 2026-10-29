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

/** Dia da semana da conferência de cada dupla (0 = segunda … 6 = domingo). */
export interface StockSchedule {
  teamId: number;
  weekday: number;
  time: string;
  active: boolean;
}

export interface Service {
  id: number;
  name: string;
  sector: StockSector;
  weeklyPerTech: number;
  active: boolean;
  materials: { itemId: number; qty: number }[];
}

export type SupplyStatus = "previsto" | "separado" | "entregue";

export interface StockSupply {
  id: number;
  technicianId: number;
  weekStart: string;
  status: SupplyStatus;
  lines: { itemId: number; qty: number }[];
  notes: string | null;
  deliveredAt: string | null;
}

export interface StockData {
  teams: StockTeam[];
  technicians: StockTechnician[];
  items: StockItem[];
  balances: StockBalance[];
  counts: StockCount[];
  imports: StockImport[];
  schedule: StockSchedule[];
  services: Service[];
  /** serviços por semana de cada colaborador quando diferente do padrão do serviço */
  forecast: { technicianId: number; serviceId: number; weeklyQty: number }[];
  supplies: StockSupply[];
}

export const STOCK_QUERY_KEY = ["stock"] as const;
const STOCK_TABLES = [
  "escala_stock_items",
  "escala_stock_counts",
  "escala_stock_count_lines",
  "escala_stock_balances",
  "escala_stock_imports",
  "escala_stock_schedule",
  "escala_services",
  "escala_service_materials",
  "escala_service_forecast",
  "escala_stock_supplies",
];

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
  const [teams, techs, items, counts, lines, balances, imports, schedule, services, materials, forecast, supplies] = await Promise.all([
    supabase.from("escala_teams").select("id, code, name, sector, vehicle").order("code"),
    supabase.from("escala_technicians").select("id, name, team_id").order("name"),
    supabase.from("escala_stock_items").select("*").order("name"),
    supabase.from("escala_stock_counts").select("*").order("date", { ascending: false }).order("id", { ascending: false }),
    selectAll("escala_stock_count_lines"),
    selectAll("escala_stock_balances"),
    supabase.from("escala_stock_imports").select("*").order("imported_at", { ascending: false }).limit(50),
    supabase.from("escala_stock_schedule").select("*"),
    supabase.from("escala_services").select("*").order("name"),
    selectAll("escala_service_materials"),
    selectAll("escala_service_forecast"),
    supabase.from("escala_stock_supplies").select("*").order("week_start", { ascending: false }).limit(500),
  ]);
  const matsBy = new Map<number, { itemId: number; qty: number }[]>();
  for (const m of materials) {
    const arr = matsBy.get(num(m.service_id)) ?? [];
    arr.push({ itemId: num(m.item_id), qty: num(m.qty) });
    matsBy.set(num(m.service_id), arr);
  }
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
    schedule: (must(schedule) as Record<string, unknown>[]).map((x) => ({
      teamId: num(x.team_id),
      weekday: num(x.weekday),
      time: String(x.time ?? "08:00"),
      active: x.active !== false,
    })),
    services: (must(services) as Record<string, unknown>[]).map((x) => ({
      id: num(x.id),
      name: String(x.name),
      sector: (x.sector as StockSector) ?? "suporte",
      weeklyPerTech: num(x.weekly_per_tech),
      active: x.active !== false,
      materials: matsBy.get(num(x.id)) ?? [],
    })),
    forecast: forecast.map((f) => ({ technicianId: num(f.technician_id), serviceId: num(f.service_id), weeklyQty: num(f.weekly_qty) })),
    supplies: (must(supplies) as Record<string, unknown>[]).map((x) => ({
      id: num(x.id),
      technicianId: num(x.technician_id),
      weekStart: String(x.week_start),
      status: (x.status as SupplyStatus) ?? "previsto",
      lines: ((x.lines as { itemId: number; qty: number }[]) ?? []).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })),
      notes: (x.notes as string) ?? null,
      deliveredAt: (x.delivered_at as string) ?? null,
    })),
  };
}

// ---------- agenda e abastecimento ----------

/** Data da conferência da dupla na semana que começa na segunda `monday`. */
export function countDateInWeek(s: StockSchedule, monday: string): string {
  const d = new Date(`${monday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + s.weekday);
  return d.toISOString().slice(0, 10);
}

/** Serviços previstos na semana para o colaborador (padrão do serviço ou valor próprio dele). */
export function weeklyServices(data: Pick<StockData, "services" | "forecast">, technicianId: number, sector: "suporte" | "infraestrutura") {
  return data.services
    .filter((s) => s.active && (s.sector === "ambos" || s.sector === sector))
    .map((s) => ({ service: s, qty: data.forecast.find((f) => f.technicianId === technicianId && f.serviceId === s.id)?.weeklyQty ?? s.weeklyPerTech }));
}

export interface SupplyLine {
  item: StockItem;
  /** consumo previsto na semana pelo fluxo de serviço */
  need: number;
  balance: number;
  /** saldo desejado no início da semana: consumo + mínimo, limitado ao máximo */
  target: number;
  send: number;
  /** máximo menor que o consumo previsto */
  capped: boolean;
}

/** Abastecimento da semana: o que mandar para o colaborador cobrir o consumo previsto e ficar no mínimo. */
export function weeklySupply(data: StockData, technicianId: number, sector: "suporte" | "infraestrutura"): SupplyLine[] {
  const need = new Map<number, number>();
  for (const { service, qty } of weeklyServices(data, technicianId, sector)) {
    for (const m of service.materials) need.set(m.itemId, (need.get(m.itemId) ?? 0) + m.qty * qty);
  }
  const bal = new Map(data.balances.filter((b) => b.technicianId === technicianId).map((b) => [b.itemId, b.qty]));
  const ids = new Set<number>(need.keys());
  for (const i of data.items) if (i.active && i.minQty > 0 && itemFitsSector(i, sector) && bal.has(i.id)) ids.add(i.id);
  const out: SupplyLine[] = [];
  for (const id of ids) {
    const item = data.items.find((i) => i.id === id);
    if (!item || !item.active) continue;
    const n = need.get(id) ?? 0;
    const balance = bal.get(id) ?? 0;
    let target = n + item.minQty;
    let capped = false;
    if (item.maxQty != null && target > item.maxQty) {
      capped = item.maxQty < n;
      target = item.maxQty;
    }
    out.push({ item, need: n, balance, target, send: Math.max(0, Math.ceil(target - balance)), capped });
  }
  return out.sort((a, b) => b.send - a.send || a.item.name.localeCompare(b.item.name));
}

export const mondayOfIso = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

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

async function saveSchedule(input: { teamId: number; weekday: number | null; time: string }) {
  if (input.weekday == null) {
    must(await supabase.from("escala_stock_schedule").delete().eq("team_id", input.teamId).select("team_id"));
    return;
  }
  must(
    await supabase
      .from("escala_stock_schedule")
      .upsert({ team_id: input.teamId, weekday: input.weekday, time: input.time || "08:00", active: true }, { onConflict: "team_id" })
      .select("team_id"),
  );
}

export interface SaveServiceInput {
  id?: number;
  name: string;
  sector: StockSector;
  weeklyPerTech: number;
  active: boolean;
  materials: { itemId: number; qty: number }[];
}

async function saveService(input: SaveServiceInput) {
  if (!input.name.trim()) throw new Error("Informe o nome do serviço.");
  const row = { name: input.name.trim(), sector: input.sector, weekly_per_tech: input.weeklyPerTech, active: input.active };
  let id = input.id;
  if (id) must(await supabase.from("escala_services").update(row).eq("id", id).select("id"));
  else id = (must(await supabase.from("escala_services").insert(row).select("id").single()) as { id: number }).id;
  const mats = input.materials.filter((m) => m.qty > 0);
  if (mats.length)
    must(
      await supabase
        .from("escala_service_materials")
        .upsert(
          mats.map((m) => ({ service_id: id, item_id: m.itemId, qty: m.qty })),
          { onConflict: "service_id,item_id" },
        )
        .select("id"),
    );
  let del = supabase.from("escala_service_materials").delete().eq("service_id", id);
  if (mats.length) del = del.not("item_id", "in", `(${mats.map((m) => m.itemId).join(",")})`);
  must(await del.select("id"));
}

async function deleteService(id: number) {
  must(await supabase.from("escala_services").delete().eq("id", id).select("id"));
}

async function saveForecast(input: { technicianId: number; serviceId: number; weeklyQty: number | null }) {
  if (input.weeklyQty == null) {
    must(await supabase.from("escala_service_forecast").delete().eq("technician_id", input.technicianId).eq("service_id", input.serviceId).select("id"));
    return;
  }
  must(
    await supabase
      .from("escala_service_forecast")
      .upsert({ technician_id: input.technicianId, service_id: input.serviceId, weekly_qty: input.weeklyQty }, { onConflict: "technician_id,service_id" })
      .select("id"),
  );
}

export interface SaveSupplyInput {
  technicianId: number;
  weekStart: string;
  status: SupplyStatus;
  lines: { itemId: number; qty: number }[];
  notes: string | null;
  /** status anterior: ao virar "entregue" o material entra no saldo do colaborador */
  previousStatus?: SupplyStatus | null;
}

async function saveSupply(input: SaveSupplyInput) {
  const lines = input.lines.filter((l) => l.qty > 0);
  must(
    await supabase
      .from("escala_stock_supplies")
      .upsert(
        {
          technician_id: input.technicianId,
          week_start: input.weekStart,
          status: input.status,
          lines,
          notes: input.notes?.trim() || null,
          delivered_at: input.status === "entregue" ? new Date().toISOString() : null,
          created_by: await currentEmail(),
        },
        { onConflict: "technician_id,week_start" },
      )
      .select("id"),
  );
  if (input.status === "entregue" && input.previousStatus !== "entregue" && lines.length) {
    const ids = lines.map((l) => l.itemId);
    const current = must(
      await supabase.from("escala_stock_balances").select("item_id, qty").eq("technician_id", input.technicianId).in("item_id", ids),
    ) as { item_id: number; qty: number }[];
    const cur = new Map(current.map((c) => [Number(c.item_id), Number(c.qty)]));
    await upsertBalances(
      lines.map((l) => ({ technicianId: input.technicianId, itemId: l.itemId, qty: (cur.get(l.itemId) ?? 0) + l.qty })),
      "manual",
    );
  }
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
    saveSchedule: useMutation({ mutationFn: saveSchedule, onSuccess: done, onError: fail }),
    saveService: useMutation({ mutationFn: saveService, onSuccess: done, onError: fail }),
    deleteService: useMutation({ mutationFn: deleteService, onSuccess: done, onError: fail }),
    saveForecast: useMutation({ mutationFn: saveForecast, onSuccess: done, onError: fail }),
    saveSupply: useMutation({ mutationFn: saveSupply, onSuccess: done, onError: fail }),
  };
}
