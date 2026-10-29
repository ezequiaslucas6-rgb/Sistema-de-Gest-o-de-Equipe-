import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { AlertTriangle, CheckCheck, ClipboardCheck, Download, FileDown, Package, PackagePlus, Pencil, Printer, Search, Trash2, Upload } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { Switch } from "../components/Switch";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { StockImportDialog } from "../components/StockImportDialog";
import { StockWeekPanel } from "../components/StockWeekPanel";
import { StockServicesPanel } from "../components/StockServicesPanel";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { useProfile } from "../helpers/profile";
import { toast } from "../helpers/toast";
import {
  type CountStatus,
  type Level,
  type StockCount,
  type StockItem,
  type StockSector,
  type StockTechnician,
  itemFitsSector,
  lineDiff,
  restock,
  stockLevel,
  useStockData,
  useStockMutations,
} from "../helpers/stock";
import { type ExportRow, downloadSpreadsheet, parseNumber } from "../helpers/stockImport";
import { type PrintLine, countResult, countSheet, printDocs, restockReport } from "../helpers/stockPrint";
import styles from "./estoque.module.css";

/** Conferente padrão do time técnico. */
export const DEFAULT_CHECKER = "JOÃO BATISTA DECARLI JUNIOR";

type Sector = "suporte" | "infraestrutura";
type Tab = "colaboradores" | "semana" | "conferencias" | "reposicao" | "servicos" | "itens" | "importacoes";

type LineForm = { itemId: number; expected: string; counted: string; note: string };
type CountForm = { id?: number; technicianId: string; date: string; checker: string; notes: string; lines: LineForm[]; status: CountStatus; updateBalances: boolean };
type ItemForm = { id?: number; code: string; name: string; unit: string; category: string; sector: StockSector; kitQty: string; minQty: string; maxQty: string; active: boolean };

/** Uma linha do estoque de um colaborador. */
type StockRow = { item: StockItem; qty: number; level: Level; move: number };

const SECTOR_LABEL: Record<StockSector, string> = { suporte: "Suporte", infraestrutura: "Infra / Backbone", ambos: "Ambos" };
const LEVEL_LABEL: Record<Level, string> = { abaixo: "abaixo do mínimo", acima: "acima do máximo", ok: "ok" };

const parseQty = (v: string): number | null => {
  const n = parseNumber(v);
  return n != null && n >= 0 ? n : null;
};
const fmtQty = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n * 1000) / 1000).replace(".", ","));
const fmtDiff = (d: number | null) => (d == null ? "—" : d === 0 ? "ok" : `${d > 0 ? "+" : ""}${fmtQty(d)}`);
const fmtDate = (d: string) => scheduleEngine.formatDate(d);
const fmtDateTime = (iso: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const todayIso = () => new Date().toLocaleDateString("sv-SE");
const fileSafe = (s: string) => scheduleEngine.normalizeText(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Resumo de uma conferência: faltas, sobras e itens não contados. */
function summarize(c: Pick<StockCount, "lines">) {
  let missing = 0;
  let extra = 0;
  let pending = 0;
  for (const l of c.lines) {
    const d = lineDiff(l);
    if (d == null) pending++;
    else if (d < 0) missing++;
    else if (d > 0) extra++;
  }
  return { missing, extra, pending, divergent: missing + extra };
}

export default function StockPage() {
  const profile = useProfile();
  const { data, error } = useStockData();
  const { saveCount, deleteCount, saveItem } = useStockMutations();
  const [sector, setSector] = useState<Sector>("suporte");
  const [tab, setTab] = useState<Tab>("colaboradores");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<CountForm | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [viewTech, setViewTech] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const defaultChecker = profile.role === "almoxarifado" && profile.name ? profile.name : DEFAULT_CHECKER;
  const itemById = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const techById = useMemo(() => new Map((data?.technicians ?? []).map((t) => [t.id, t])), [data]);
  const lastMapping = data?.imports.find((i) => i.mapping)?.mapping ?? null;

  const balances = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const b of data?.balances ?? []) {
      const inner = m.get(b.technicianId) ?? new Map<number, number>();
      inner.set(b.itemId, b.qty);
      m.set(b.technicianId, inner);
    }
    return m;
  }, [data]);

  const techSector = (t: StockTechnician): Sector | null => (t.teamId ? (teamById.get(t.teamId)?.sector ?? null) : null);
  const teamLabel = (t: StockTechnician | undefined) => {
    const team = t?.teamId ? teamById.get(t.teamId) : undefined;
    return team ? `${team.code} · ${team.name}` : "sem dupla";
  };

  /** Estoque do colaborador: o que veio do outro sistema + itens com mínimo do setor que ele não tem. */
  const stockOf = (techId: number): StockRow[] => {
    if (!data) return [];
    const tech = techById.get(techId);
    const sec = tech ? (techSector(tech) ?? sector) : sector;
    const bal = balances.get(techId);
    const ids = new Set<number>(bal ? [...bal.keys()] : []);
    if (bal) for (const i of data.items) if (i.active && i.minQty > 0 && itemFitsSector(i, sec)) ids.add(i.id);
    return [...ids]
      .map((id) => itemById.get(id))
      .filter((i): i is StockItem => !!i)
      .map((item) => {
        const qty = bal?.get(item.id) ?? 0;
        return { item, qty, level: stockLevel(qty, item.minQty, item.maxQty), move: restock(qty, item.minQty, item.maxQty) };
      })
      .filter((r) => r.qty !== 0 || r.level !== "ok")
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  };

  const techs = useMemo(() => {
    if (!data) return [];
    const q = scheduleEngine.normalizeText(query.trim());
    return data.technicians
      .filter((t) => {
        const s = techSector(t);
        return s === sector || (s === null && balances.has(t.id));
      })
      .filter((t) => !q || scheduleEngine.normalizeText(`${t.name} ${teamLabel(t)}`).includes(q))
      .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sector, query, balances]);

  const stockByTech = useMemo(() => new Map(techs.map((t) => [t.id, stockOf(t.id)])), [techs, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let below = 0;
    let above = 0;
    let withStock = 0;
    for (const rows of stockByTech.values()) {
      if (rows.length) withStock++;
      below += rows.filter((r) => r.level === "abaixo").length;
      above += rows.filter((r) => r.level === "acima").length;
    }
    return { below, above, withStock };
  }, [stockByTech]);

  const counts = useMemo(() => {
    const q = scheduleEngine.normalizeText(query.trim());
    return (data?.counts ?? []).filter((c) => {
      const tech = c.technicianId ? techById.get(c.technicianId) : undefined;
      const sec = tech ? (techSector(tech) ?? (balances.has(tech.id) ? sector : null)) : (teamById.get(c.teamId ?? -1)?.sector ?? null);
      if (sec !== sector) return false;
      return !q || scheduleEngine.normalizeText(`${tech?.name ?? ""} ${teamLabel(tech)}`).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sector, query, balances]);
  const lastCount = (techId: number) => data?.counts.find((c) => c.technicianId === techId && c.status === "finalizada");
  const draftOf = (techId: number) => data?.counts.find((c) => c.technicianId === techId && c.status === "rascunho");
  const sectorItems = useMemo(() => (data?.items ?? []).filter((i) => itemFitsSector(i, sector)), [data, sector]);
  const today = todayIso();

  // ---------- impressão / exportação ----------
  const printLinesOf = (rows: StockRow[]): PrintLine[] =>
    rows.map((r) => ({ name: r.item.name, code: r.item.code, unit: r.item.unit, balance: r.qty, min: r.item.minQty || null, max: r.item.maxQty, level: r.level }));

  const sheetFor = (techId: number) => {
    const t = techById.get(techId);
    return countSheet({ technician: t?.name ?? "?", team: teamLabel(t), checker: defaultChecker, date: fmtDate(today), lines: printLinesOf(stockOf(techId)) });
  };

  const printSheets = (ids: number[]) => {
    const withStock = ids.filter((id) => stockOf(id).length > 0);
    if (!withStock.length) return toast.error("Nenhum colaborador com estoque importado.");
    printDocs("Estoque a conferir", withStock.map(sheetFor));
  };

  const countPrintLines = (c: StockCount): PrintLine[] =>
    [...c.lines]
      .map((l) => {
        const item = itemById.get(l.itemId);
        const min = l.minQty ?? item?.minQty ?? null;
        const max = l.maxQty ?? item?.maxQty ?? null;
        return {
          name: item?.name ?? "item removido",
          code: item?.code ?? null,
          unit: item?.unit ?? "",
          balance: l.expected,
          counted: l.counted,
          note: l.note,
          min: min || null,
          max,
          level: l.counted == null ? undefined : stockLevel(l.counted, min, max),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

  const countOwner = (c: StockCount) => {
    const t = c.technicianId ? techById.get(c.technicianId) : undefined;
    const team = c.teamId ? teamById.get(c.teamId) : undefined;
    return { name: t?.name ?? (team ? `${team.code} · ${team.name}` : "?"), team: t ? teamLabel(t) : team ? `${team.code} · ${team.name}` : "" };
  };

  const printCount = (c: StockCount) => {
    const o = countOwner(c);
    printDocs(`Conferência ${o.name} ${c.date}`, [
      countResult({ technician: o.name, team: o.team, checker: c.checker, date: fmtDate(c.date), status: c.status === "finalizada" ? "finalizada" : "rascunho", notes: c.notes, lines: countPrintLines(c) }),
    ]);
  };

  /** Contagem no layout do outro sistema: quantidade = contado. */
  const exportCount = (c: StockCount, format: "xlsx" | "csv") => {
    const o = countOwner(c);
    const rows: ExportRow[] = countPrintLines(c).map((l) => ({
      technician: o.name,
      code: l.code ?? "",
      name: l.name,
      unit: l.unit,
      qty: l.counted ?? l.balance,
      min: l.min,
      max: l.max,
      extra: { "Saldo anterior": l.balance, Diferença: l.counted == null ? "" : l.counted - l.balance, Observação: l.note ?? "" },
    }));
    void downloadSpreadsheet(`conferencia-${fileSafe(o.name)}-${c.date}`, rows, lastMapping, format);
  };

  const exportBalances = (ids: number[], format: "xlsx" | "csv") => {
    const rows: ExportRow[] = ids.flatMap((id) =>
      stockOf(id).map((r) => ({
        technician: techById.get(id)?.name ?? "?",
        code: r.item.code ?? "",
        name: r.item.name,
        unit: r.item.unit,
        qty: r.qty,
        min: r.item.minQty || null,
        max: r.item.maxQty,
      })),
    );
    if (!rows.length) return toast.error("Nenhum saldo para exportar.");
    void downloadSpreadsheet(`estoque-${sector}-${today}`, rows, lastMapping, format);
  };

  const restockGroups = useMemo(
    () =>
      techs
        .map((t) => ({ t, lines: (stockByTech.get(t.id) ?? []).filter((r) => r.move !== 0) }))
        .filter((g) => g.lines.length > 0),
    [techs, stockByTech],
  );

  const printRestock = () =>
    printDocs("Reposição de estoque", [
      restockReport({
        title: `Reposição de estoque — ${SECTOR_LABEL[sector]}`,
        groups: restockGroups.map((g) => ({ technician: g.t.name, team: teamLabel(g.t), lines: printLinesOf(g.lines).map((l, i) => ({ ...l, move: g.lines[i].move })) })),
      }),
    ]);

  const exportRestock = () => {
    const rows: ExportRow[] = restockGroups.flatMap((g) =>
      g.lines.map((r) => ({
        technician: g.t.name,
        code: r.item.code ?? "",
        name: r.item.name,
        unit: r.item.unit,
        qty: r.qty,
        min: r.item.minQty || null,
        max: r.item.maxQty,
        extra: { Enviar: r.move > 0 ? r.move : "", Recolher: r.move < 0 ? -r.move : "" },
      })),
    );
    void downloadSpreadsheet(`reposicao-${sector}-${today}`, rows, lastMapping, "xlsx");
  };

  // ---------- conferência ----------
  const newCount = (techId?: number) => {
    const id = techId ?? techs[0]?.id;
    setConfirmDelete(false);
    setViewTech(null);
    setForm({ technicianId: id ? String(id) : "", date: today, checker: defaultChecker, notes: "", status: "rascunho", updateBalances: true, lines: id ? linesFor(id) : [] });
  };

  /** Esperado = saldo do outro sistema; sem saldo importado, usa o kit padrão do setor. */
  const linesFor = (techId: number): LineForm[] => {
    const rows = stockOf(techId);
    if (rows.length) return rows.map((r) => ({ itemId: r.item.id, expected: fmtQty(r.qty), counted: "", note: "" }));
    const tech = techById.get(techId);
    const sec = tech ? (techSector(tech) ?? sector) : sector;
    return (data?.items ?? [])
      .filter((i) => i.active && itemFitsSector(i, sec) && (i.kitQty > 0 || i.minQty > 0))
      .map((i) => ({ itemId: i.id, expected: fmtQty(i.kitQty), counted: "", note: "" }));
  };

  const openCount = (c: StockCount) => {
    setConfirmDelete(false);
    setForm({
      id: c.id,
      technicianId: c.technicianId ? String(c.technicianId) : "",
      date: c.date,
      checker: c.checker,
      notes: c.notes ?? "",
      status: c.status,
      updateBalances: c.status !== "finalizada",
      lines: [...c.lines]
        .sort((a, b) => (itemById.get(a.itemId)?.name ?? "").localeCompare(itemById.get(b.itemId)?.name ?? ""))
        .map((l) => ({ itemId: l.itemId, expected: fmtQty(l.expected), counted: l.counted == null ? "" : fmtQty(l.counted), note: l.note ?? "" })),
    });
  };

  const setLine = (idx: number, patch: Partial<LineForm>) => {
    if (!form) return;
    setForm({ ...form, lines: form.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  };

  const formSummary = useMemo(() => {
    if (!form) return null;
    return summarize({ lines: form.lines.map((l) => ({ itemId: l.itemId, expected: parseQty(l.expected) ?? 0, counted: parseQty(l.counted), note: null })) });
  }, [form]);

  const addableItems = useMemo(() => {
    if (!form) return [];
    const used = new Set(form.lines.map((l) => l.itemId));
    return (data?.items ?? []).filter((i) => i.active && !used.has(i.id));
  }, [form, data]);

  const submitCount = (status: CountStatus) => {
    if (!form) return;
    if (!form.technicianId) return toast.error("Escolha o colaborador conferido.");
    const tech = techById.get(Number(form.technicianId));
    saveCount.mutate(
      {
        id: form.id,
        technicianId: Number(form.technicianId),
        teamId: tech?.teamId ?? null,
        date: form.date,
        checker: form.checker,
        status,
        notes: form.notes || null,
        updateBalances: form.updateBalances,
        lines: form.lines.map((l) => {
          const item = itemById.get(l.itemId);
          return { itemId: l.itemId, expected: parseQty(l.expected) ?? 0, counted: parseQty(l.counted), note: l.note || null, minQty: item?.minQty ?? null, maxQty: item?.maxQty ?? null };
        }),
      },
      {
        onSuccess: () => {
          toast.success(status === "finalizada" ? (form.updateBalances ? "Conferência finalizada e saldo atualizado" : "Conferência finalizada") : "Rascunho salvo");
          setForm(null);
        },
      },
    );
  };

  // ---------- itens ----------
  const openItem = (i?: StockItem) =>
    setItemForm(
      i
        ? {
            id: i.id,
            code: i.code ?? "",
            name: i.name,
            unit: i.unit,
            category: i.category ?? "",
            sector: i.sector,
            kitQty: fmtQty(i.kitQty),
            minQty: i.minQty ? fmtQty(i.minQty) : "",
            maxQty: i.maxQty == null ? "" : fmtQty(i.maxQty),
            active: i.active,
          }
        : { code: "", name: "", unit: "un", category: "", sector, kitQty: "0", minQty: "", maxQty: "", active: true },
    );
  const submitItem = () => {
    if (!itemForm) return;
    saveItem.mutate(
      {
        id: itemForm.id,
        code: itemForm.code || null,
        name: itemForm.name,
        unit: itemForm.unit,
        category: itemForm.category || null,
        sector: itemForm.sector,
        kitQty: parseQty(itemForm.kitQty) ?? 0,
        minQty: parseQty(itemForm.minQty) ?? 0,
        maxQty: parseQty(itemForm.maxQty),
        active: itemForm.active,
      },
      {
        onSuccess: () => {
          toast.success("Item salvo");
          setItemForm(null);
        },
      },
    );
  };

  const viewRows = viewTech ? stockOf(viewTech) : [];
  const formTech = form?.technicianId ? techById.get(Number(form.technicianId)) : undefined;
  const lastImport = data?.imports[0];

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Conferência de estoque — Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Almoxarifado"
        title="Conferência de estoque"
        description={
          <>
            Estoque de cada colaborador (importado do outro sistema), mínimo e máximo, conferência e reposição. Conferente: <b>{DEFAULT_CHECKER}</b>.
          </>
        }
        actions={
          <div className={styles.headActions}>
            <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!data}>
              <Upload size={16} /> Importar estoque
            </Button>
            <Button onClick={() => newCount()} disabled={!data || !techs.length}>
              <ClipboardCheck size={16} /> Nova conferência
            </Button>
          </div>
        }
      />

      {error && <p className={styles.error}>{error instanceof Error ? error.message : String(error)}</p>}

      <div className={styles.toolbar}>
        <ToggleGroup type="single" value={sector} onValueChange={(v) => v && setSector(v as Sector)}>
          <ToggleGroupItem value="suporte">Suporte (time técnico)</ToggleGroupItem>
          <ToggleGroupItem value="infraestrutura">Infra / Backbone</ToggleGroupItem>
        </ToggleGroup>
        <div className={styles.search}>
          <Search size={15} />
          <Input value={query} placeholder="Buscar colaborador ou dupla" onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {!data ? (
        <Skeleton className={styles.skel} />
      ) : (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <b>
              {stats.withStock}/{techs.length}
            </b>
            <span>Colaboradores com estoque</span>
          </div>
          <button className={`${styles.stat} ${stats.below ? styles.statBad : ""}`} onClick={() => setTab("reposicao")}>
            <b>{stats.below}</b>
            <span>Itens abaixo do mínimo</span>
          </button>
          <button className={`${styles.stat} ${stats.above ? styles.statWarn : ""}`} onClick={() => setTab("reposicao")}>
            <b>{stats.above}</b>
            <span>Itens acima do máximo</span>
          </button>
          <button className={styles.stat} onClick={() => setTab("importacoes")}>
            <b className={styles.statSmall}>{lastImport ? fmtDateTime(lastImport.importedAt) : "—"}</b>
            <span>{lastImport ? `Última importação · ${lastImport.fileName ?? ""}` : "Nenhuma importação ainda"}</span>
          </button>
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        {(
          [
            ["colaboradores", "Colaboradores"],
            ["semana", "Agenda e abastecimento"],
            ["conferencias", "Conferências"],
            ["reposicao", `Reposição${restockGroups.length ? ` (${restockGroups.length})` : ""}`],
            ["servicos", "Fluxo de serviço"],
            ["itens", "Itens e mín./máx."],
            ["importacoes", "Importações"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabOn : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "colaboradores" && data && (
        <section>
          <div className={styles.toolbar}>
            <p className={styles.meta}>Saldo de cada colaborador. “Conferir” já traz o saldo do sistema como esperado.</p>
            <div className={styles.headActions}>
              <Button size="sm" variant="outline" onClick={() => printSheets(techs.map((t) => t.id))}>
                <Printer size={14} /> Imprimir folhas de conferência
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportBalances(techs.map((t) => t.id), "xlsx")}>
                <FileDown size={14} /> Exportar saldos (.xlsx)
              </Button>
              <Button size="sm" variant="ghost" onClick={() => exportBalances(techs.map((t) => t.id), "csv")}>
                .csv
              </Button>
            </div>
          </div>
          <div className={styles.techGrid}>
            {techs.map((t) => {
              const rows = stockByTech.get(t.id) ?? [];
              const held = rows.filter((r) => r.qty > 0).length;
              const below = rows.filter((r) => r.level === "abaixo").length;
              const above = rows.filter((r) => r.level === "acima").length;
              const last = lastCount(t.id);
              const draft = draftOf(t.id);
              const age = last ? scheduleEngine.diffDays(today, last.date) : null;
              const s = last ? summarize(last) : null;
              return (
                <div key={t.id} className={`${styles.techCard} ${below ? styles.cardBad : above ? styles.cardWarn : rows.length ? "" : styles.cardEmpty}`}>
                  <div className={styles.techHead}>
                    <span className={styles.techName}>{t.name}</span>
                    <span className={styles.code}>{t.teamId ? teamById.get(t.teamId)?.code : "—"}</span>
                  </div>
                  <div className={styles.meta}>
                    {balances.has(t.id) ? `${held} ${held === 1 ? "item" : "itens"} no estoque` : "sem estoque importado"}
                    {below > 0 && <span className={styles.bad}> · {below} abaixo do mín.</span>}
                    {above > 0 && <span className={styles.warn}> · {above} acima do máx.</span>}
                  </div>
                  <div className={styles.meta}>
                    {last ? (
                      <>
                        Conferido em {fmtDate(last.date)}
                        {age != null && age >= 0 && ` (${age === 0 ? "hoje" : `há ${age} dia${age > 1 ? "s" : ""}`})`}
                        {s && (s.divergent ? <span className={styles.bad}> · {s.divergent} divergência(s)</span> : <span className={styles.ok}> · conforme</span>)}
                      </>
                    ) : (
                      "Nunca conferido"
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    <Button size="sm" variant="ghost" onClick={() => setViewTech(t.id)} disabled={!balances.has(t.id)}>
                      <Package size={14} /> Estoque
                    </Button>
                    {draft ? (
                      <Button size="sm" variant="secondary" onClick={() => openCount(draft)}>
                        <Pencil size={14} /> Continuar
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => newCount(t.id)}>
                        <ClipboardCheck size={14} /> Conferir
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" title="Imprimir folha de conferência" aria-label={`Imprimir folha de ${t.name}`} onClick={() => printSheets([t.id])}>
                      <Printer size={14} />
                    </Button>
                  </div>
                </div>
              );
            })}
            {techs.length === 0 && <p className={styles.empty}>Nenhum colaborador neste setor.</p>}
          </div>
        </section>
      )}

      {tab === "semana" && data && <StockWeekPanel data={data} sector={sector} query={query} />}
      {tab === "servicos" && data && <StockServicesPanel data={data} sector={sector} />}

      {tab === "conferencias" && data && (
        <section className={styles.tableWrap}>
          {counts.length === 0 ? (
            <p className={styles.empty}>Nenhuma conferência registrada ainda. Use “Conferir” no card do colaborador.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Colaborador</th>
                  <th>Conferente</th>
                  <th className={styles.r}>Itens</th>
                  <th>Resultado</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => {
                  const o = countOwner(c);
                  const s = summarize(c);
                  return (
                    <tr key={c.id}>
                      <td className={styles.mono}>{fmtDate(c.date)}</td>
                      <td>
                        <b>{o.name}</b> <span className={styles.meta}>{o.team}</span>
                      </td>
                      <td>{c.checker}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{c.lines.length}</td>
                      <td>
                        {s.divergent === 0 && s.pending === 0 ? (
                          <span className={styles.ok}>conforme</span>
                        ) : (
                          <span className={s.divergent ? styles.bad : styles.meta}>
                            {[s.missing && `${s.missing} falta(s)`, s.extra && `${s.extra} sobra(s)`, s.pending && `${s.pending} não contado(s)`].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={c.status === "finalizada" ? styles.pillDone : styles.pillDraft}>{c.status === "finalizada" ? "Finalizada" : "Rascunho"}</span>
                      </td>
                      <td className={styles.rowActions}>
                        <Button size="icon-sm" variant="ghost" title="Abrir" aria-label="Abrir" onClick={() => openCount(c)}>
                          <Pencil size={14} />
                        </Button>
                        <Button size="icon-sm" variant="ghost" title="Imprimir relatório" aria-label="Imprimir relatório" onClick={() => printCount(c)}>
                          <Printer size={14} />
                        </Button>
                        <Button size="icon-sm" variant="ghost" title="Exportar para o outro sistema (.xlsx)" aria-label="Exportar planilha" onClick={() => exportCount(c, "xlsx")}>
                          <Download size={14} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "reposicao" && data && (
        <section>
          <div className={styles.toolbar}>
            <p className={styles.meta}>
              Abaixo do mínimo: enviar até o máximo. Acima do máximo: recolher o excedente. Defina mínimo e máximo em “Itens e mín./máx.” (ou traga na
              planilha).
            </p>
            <div className={styles.headActions}>
              <Button size="sm" variant="outline" onClick={printRestock}>
                <Printer size={14} /> Imprimir reposição
              </Button>
              <Button size="sm" variant="outline" onClick={exportRestock} disabled={!restockGroups.length}>
                <FileDown size={14} /> Exportar (.xlsx)
              </Button>
            </div>
          </div>
          {restockGroups.length === 0 ? (
            <p className={styles.empty}>Ninguém abaixo do mínimo ou acima do máximo.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Item</th>
                    <th className={styles.r}>Saldo</th>
                    <th className={styles.r}>Mín.</th>
                    <th className={styles.r}>Máx.</th>
                    <th className={styles.r}>Enviar</th>
                    <th className={styles.r}>Recolher</th>
                  </tr>
                </thead>
                <tbody>
                  {restockGroups.flatMap((g) =>
                    g.lines.map((r, i) => (
                      <tr key={`${g.t.id}-${r.item.id}`} className={r.move > 0 ? styles.rowBad : styles.rowWarn}>
                        <td>{i === 0 ? <b>{g.t.name}</b> : ""}</td>
                        <td>
                          {r.item.name} <span className={styles.meta}>{r.item.code}</span>
                        </td>
                        <td className={`${styles.mono} ${styles.r}`}>{fmtQty(r.qty)}</td>
                        <td className={`${styles.mono} ${styles.r}`}>{fmtQty(r.item.minQty)}</td>
                        <td className={`${styles.mono} ${styles.r}`}>{fmtQty(r.item.maxQty)}</td>
                        <td className={`${styles.mono} ${styles.r} ${styles.bad}`}>{r.move > 0 ? `${fmtQty(r.move)} ${r.item.unit}` : ""}</td>
                        <td className={`${styles.mono} ${styles.r} ${styles.warn}`}>{r.move < 0 ? `${fmtQty(-r.move)} ${r.item.unit}` : ""}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "itens" && data && (
        <section>
          <div className={styles.toolbar}>
            <p className={styles.meta}>Mínimo e máximo valem por colaborador. “Kit” é o esperado quando o colaborador ainda não tem estoque importado.</p>
            <Button size="sm" variant="outline" onClick={() => openItem()}>
              <PackagePlus size={14} /> Novo item
            </Button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Item</th>
                  <th>Setor</th>
                  <th>Un</th>
                  <th className={styles.r}>Mín.</th>
                  <th className={styles.r}>Máx.</th>
                  <th className={styles.r}>Kit</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sectorItems.map((i) => (
                  <tr key={i.id} className={i.active ? "" : styles.inactive}>
                    <td className={styles.mono}>{i.code ?? "—"}</td>
                    <td>
                      {i.name} {i.category && <span className={styles.meta}>{i.category}</span>}
                    </td>
                    <td>{SECTOR_LABEL[i.sector]}</td>
                    <td>{i.unit}</td>
                    <td className={`${styles.mono} ${styles.r}`}>{i.minQty ? fmtQty(i.minQty) : "—"}</td>
                    <td className={`${styles.mono} ${styles.r}`}>{fmtQty(i.maxQty)}</td>
                    <td className={`${styles.mono} ${styles.r}`}>{fmtQty(i.kitQty)}</td>
                    <td>{i.active ? "ativo" : "desativado"}</td>
                    <td className={styles.rowActions}>
                      <Button size="icon-sm" variant="ghost" title="Editar" aria-label={`Editar ${i.name}`} onClick={() => openItem(i)}>
                        <Pencil size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "importacoes" && data && (
        <section>
          <div className={styles.toolbar}>
            <p className={styles.meta}>
              Para alimentar o outro sistema, use “Exportar saldos” ou o botão de planilha de cada conferência: o arquivo sai com as mesmas colunas da última
              importação.
            </p>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Importar estoque
            </Button>
          </div>
          <div className={styles.tableWrap}>
            {data.imports.length === 0 ? (
              <p className={styles.empty}>Nenhuma importação ainda.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Arquivo</th>
                    <th>Por</th>
                    <th className={styles.r}>Colaboradores</th>
                    <th className={styles.r}>Saldos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.imports.map((i) => (
                    <tr key={i.id}>
                      <td className={styles.mono}>{fmtDateTime(i.importedAt)}</td>
                      <td>{i.fileName ?? "—"}</td>
                      <td className={styles.meta}>{i.importedBy ?? "—"}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{i.technicians}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{i.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {data && <StockImportDialog open={importOpen} onOpenChange={setImportOpen} data={data} />}

      {/* ---------- estoque do colaborador ---------- */}
      <Dialog open={viewTech != null} onOpenChange={(o) => !o && setViewTech(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Estoque · {viewTech ? techById.get(viewTech)?.name : ""}</DialogTitle>
          </DialogHeader>
          {viewTech != null && (
            <div className={styles.form}>
              <div className={styles.meta}>{teamLabel(techById.get(viewTech))}</div>
              <div className={styles.linesWrap}>
                <table className={styles.lines}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Item</th>
                      <th className={styles.r}>Saldo</th>
                      <th className={styles.r}>Mín.</th>
                      <th className={styles.r}>Máx.</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewRows.map((r) => (
                      <tr key={r.item.id} className={r.level === "abaixo" ? styles.rowBad : r.level === "acima" ? styles.rowWarn : ""}>
                        <td className={styles.mono}>{r.item.code ?? "—"}</td>
                        <td>
                          {r.item.name} <span className={styles.meta}>{r.item.unit}</span>
                        </td>
                        <td className={`${styles.mono} ${styles.r}`}>{fmtQty(r.qty)}</td>
                        <td className={`${styles.mono} ${styles.r}`}>{r.item.minQty ? fmtQty(r.item.minQty) : "—"}</td>
                        <td className={`${styles.mono} ${styles.r}`}>{fmtQty(r.item.maxQty)}</td>
                        <td>
                          {r.level === "ok" ? (
                            <span className={styles.ok}>ok</span>
                          ) : (
                            <span className={r.level === "abaixo" ? styles.bad : styles.warn}>
                              {LEVEL_LABEL[r.level]} ({r.move > 0 ? `enviar ${fmtQty(r.move)}` : `recolher ${fmtQty(-r.move)}`})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter className={styles.footer}>
            <Button variant="ghost" onClick={() => viewTech && exportBalances([viewTech], "xlsx")}>
              <FileDown size={14} /> Exportar (.xlsx)
            </Button>
            <Button variant="outline" onClick={() => viewTech && printSheets([viewTech])}>
              <Printer size={14} /> Imprimir folha de conferência
            </Button>
            <span className={styles.spacer} />
            <Button onClick={() => viewTech && newCount(viewTech)}>
              <ClipboardCheck size={15} /> Conferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- conferência ---------- */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Conferência de estoque" : "Nova conferência de estoque"}</DialogTitle>
          </DialogHeader>
          {form && data && (
            <div className={styles.form}>
              <div className={styles.row3}>
                <div>
                  <label className={styles.label}>Colaborador</label>
                  <Select
                    value={form.technicianId}
                    onValueChange={(v) => setForm({ ...form, technicianId: v, lines: form.id ? form.lines : linesFor(Number(v)) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.technicians.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} · {t.teamId ? teamById.get(t.teamId)?.code : "sem dupla"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className={styles.label}>Data</label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Conferente</label>
                  <Input value={form.checker} onChange={(e) => setForm({ ...form, checker: e.target.value })} />
                </div>
              </div>
              {formTech && (
                <div className={styles.meta}>
                  {teamLabel(formTech)} · esperado = {balances.has(formTech.id) ? "saldo importado do outro sistema" : "kit padrão (sem estoque importado)"}
                </div>
              )}

              <div className={styles.linesHead}>
                <span className={styles.micro}>Itens ({form.lines.length})</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm({ ...form, lines: form.lines.map((l) => (l.counted.trim() ? l : { ...l, counted: l.expected })) })}
                  title="Preenche os itens ainda em branco com a quantidade esperada"
                >
                  <CheckCheck size={14} /> Completar em branco com o esperado
                </Button>
              </div>
              <div className={styles.linesWrap}>
                <table className={styles.lines}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className={styles.r}>Sistema</th>
                      <th className={styles.r}>Contado</th>
                      <th className={styles.r}>Dif.</th>
                      <th className={styles.r}>Mín./Máx.</th>
                      <th>Obs.</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, idx) => {
                      const item = itemById.get(l.itemId);
                      const exp = parseQty(l.expected) ?? 0;
                      const cnt = parseQty(l.counted);
                      const d = cnt == null ? null : cnt - exp;
                      const lvl = cnt == null || !item ? null : stockLevel(cnt, item.minQty, item.maxQty);
                      return (
                        <tr key={l.itemId} className={d == null ? "" : d < 0 ? styles.lineNeg : d > 0 ? styles.linePos : styles.lineOk}>
                          <td>
                            {item?.name ?? "item removido"} <span className={styles.meta}>{item?.code ? `${item.code} · ` : ""}{item?.unit}</span>
                          </td>
                          <td className={styles.qtyCell}>
                            <Input inputMode="decimal" className={styles.qty} value={l.expected} onChange={(e) => setLine(idx, { expected: e.target.value })} aria-label={`Esperado de ${item?.name}`} />
                          </td>
                          <td className={styles.qtyCell}>
                            <Input
                              inputMode="decimal"
                              className={styles.qty}
                              value={l.counted}
                              placeholder="?"
                              onChange={(e) => setLine(idx, { counted: e.target.value })}
                              aria-label={`Contado de ${item?.name}`}
                            />
                          </td>
                          <td className={`${styles.mono} ${styles.r} ${styles.diff}`}>{fmtDiff(d)}</td>
                          <td className={`${styles.mono} ${styles.r}`}>
                            {item?.minQty || item?.maxQty != null ? `${item?.minQty ? fmtQty(item.minQty) : "—"}/${fmtQty(item?.maxQty)}` : "—"}
                            {lvl && lvl !== "ok" && (
                              <div className={lvl === "abaixo" ? styles.bad : styles.warn}>
                                <AlertTriangle size={11} /> {lvl === "abaixo" ? "abaixo" : "acima"}
                              </div>
                            )}
                          </td>
                          <td>
                            <Input value={l.note} className={styles.note} onChange={(e) => setLine(idx, { note: e.target.value })} aria-label={`Observação de ${item?.name}`} />
                          </td>
                          <td>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Tirar da conferência"
                              aria-label={`Tirar ${item?.name} da conferência`}
                              onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) })}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {addableItems.length > 0 && (
                <Select
                  value=""
                  onValueChange={(v) => {
                    const item = itemById.get(Number(v));
                    if (item) setForm({ ...form, lines: [...form.lines, { itemId: item.id, expected: "0", counted: "", note: "" }] });
                  }}
                >
                  <SelectTrigger className={styles.addItem}>
                    <SelectValue placeholder="+ Incluir outro item" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableItems.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.code ? `${i.code} · ` : ""}
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: ONU com defeito devolvida, cabo repassado para outro técnico…" />
              <div className={styles.switchRow}>
                <Switch id="upd-bal" checked={form.updateBalances} onCheckedChange={(v) => setForm({ ...form, updateBalances: v })} />
                <label htmlFor="upd-bal">Ao finalizar, o saldo do colaborador passa a ser o contado (depois exporte para lançar no outro sistema)</label>
              </div>
              {formSummary && (
                <div className={styles.summary}>
                  <span className={formSummary.missing ? styles.bad : ""}>Faltas: {formSummary.missing}</span>
                  <span className={formSummary.extra ? styles.warn : ""}>Sobras: {formSummary.extra}</span>
                  <span>Não contados: {formSummary.pending}</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter className={styles.footer}>
            {form?.id &&
              (confirmDelete ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    deleteCount.mutate(form.id!, {
                      onSuccess: () => {
                        toast.success("Conferência excluída");
                        setForm(null);
                      },
                    })
                  }
                >
                  Confirmar exclusão
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} /> Excluir
                </Button>
              ))}
            <span className={styles.spacer} />
            <Button variant="outline" onClick={() => submitCount("rascunho")} disabled={saveCount.isPending}>
              Salvar rascunho
            </Button>
            <Button onClick={() => submitCount("finalizada")} disabled={saveCount.isPending || !!formSummary?.pending || !form?.lines.length}>
              <ClipboardCheck size={15} /> Finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- item ---------- */}
      <Dialog open={!!itemForm} onOpenChange={(o) => !o && setItemForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{itemForm?.id ? "Editar item" : "Novo item"}</DialogTitle>
          </DialogHeader>
          {itemForm && (
            <div className={styles.form}>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Código (no outro sistema)</label>
                  <Input value={itemForm.code} onChange={(e) => setItemForm({ ...itemForm, code: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Unidade</label>
                  <Input value={itemForm.unit} placeholder="un, m, rolo…" onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} />
                </div>
              </div>
              <label className={styles.label}>Nome</label>
              <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
              <div className={styles.row3}>
                <div>
                  <label className={styles.label}>Estoque mínimo</label>
                  <Input inputMode="decimal" value={itemForm.minQty} placeholder="sem mínimo" onChange={(e) => setItemForm({ ...itemForm, minQty: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Estoque máximo</label>
                  <Input inputMode="decimal" value={itemForm.maxQty} placeholder="sem máximo" onChange={(e) => setItemForm({ ...itemForm, maxQty: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Qtd. no kit</label>
                  <Input inputMode="decimal" value={itemForm.kitQty} onChange={(e) => setItemForm({ ...itemForm, kitQty: e.target.value })} />
                </div>
              </div>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Categoria</label>
                  <Input value={itemForm.category} placeholder="Equipamento, Ferramenta…" onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Setor</label>
                  <Select value={itemForm.sector} onValueChange={(v) => setItemForm({ ...itemForm, sector: v as StockSector })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suporte">Suporte</SelectItem>
                      <SelectItem value="infraestrutura">Infra / Backbone</SelectItem>
                      <SelectItem value="ambos">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className={styles.switchRow}>
                <Switch id="item-active" checked={itemForm.active} onCheckedChange={(v) => setItemForm({ ...itemForm, active: v })} />
                <label htmlFor="item-active">Ativo</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submitItem} disabled={saveItem.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
