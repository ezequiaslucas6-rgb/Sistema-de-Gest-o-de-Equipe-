import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { CheckCheck, ClipboardCheck, Download, PackagePlus, Pencil, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { Switch } from "../components/Switch";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { useProfile } from "../helpers/profile";
import { toast } from "../helpers/toast";
import {
  type CountStatus,
  type StockCount,
  type StockData,
  type StockItem,
  type StockSector,
  itemFitsSector,
  lineDiff,
  useStockData,
  useStockMutations,
} from "../helpers/stock";
import styles from "./estoque.module.css";

/** Conferente padrão do time técnico. */
export const DEFAULT_CHECKER = "JOÃO BATISTA DECARLI JUNIOR";

type Sector = "suporte" | "infraestrutura";
type Tab = "conferencias" | "itens";

type LineForm = { itemId: number; expected: string; counted: string; note: string };
type CountForm = { id?: number; teamId: string; date: string; checker: string; notes: string; lines: LineForm[]; status: CountStatus };
type ItemForm = { id?: number; name: string; unit: string; category: string; sector: StockSector; kitQty: string; active: boolean };

const SECTOR_LABEL: Record<StockSector, string> = { suporte: "Suporte", infraestrutura: "Infra / Backbone", ambos: "Ambos" };

const parseQty = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const fmtQty = (n: number | null | undefined) => (n == null ? "—" : String(n).replace(".", ","));
const fmtDiff = (d: number | null) => (d == null ? "—" : d === 0 ? "ok" : `${d > 0 ? "+" : ""}${fmtQty(d)}`);
const fmtDate = (d: string) => scheduleEngine.formatDate(d);
const todayIso = () => new Date().toLocaleDateString("sv-SE");

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
  const [tab, setTab] = useState<Tab>("conferencias");
  const [teamFilter, setTeamFilter] = useState("__all");
  const [form, setForm] = useState<CountForm | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const defaultChecker = profile.role === "almoxarifado" && profile.name ? profile.name : DEFAULT_CHECKER;
  const itemById = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const teams = useMemo(() => (data?.teams ?? []).filter((t) => t.sector === sector), [data, sector]);
  const sectorItems = useMemo(() => (data?.items ?? []).filter((i) => itemFitsSector(i, sector)), [data, sector]);
  const counts = useMemo(
    () => (data?.counts ?? []).filter((c) => teamById.get(c.teamId)?.sector === sector && (teamFilter === "__all" || String(c.teamId) === teamFilter)),
    [data, sector, teamFilter, teamById],
  );

  const membersOf = (teamId: number) =>
    (data?.technicians ?? [])
      .filter((t) => t.teamId === teamId)
      .map((t) => t.name)
      .join(", ");

  // ---------- conferência ----------
  const newCount = (teamId?: number) => {
    const items = sectorItems.filter((i) => i.active);
    setConfirmDelete(false);
    setForm({
      teamId: teamId ? String(teamId) : teams[0] ? String(teams[0].id) : "",
      date: todayIso(),
      checker: defaultChecker,
      notes: "",
      status: "rascunho",
      lines: items.map((i) => ({ itemId: i.id, expected: String(i.kitQty).replace(".", ","), counted: "", note: "" })),
    });
  };

  const openCount = (c: StockCount) => {
    setConfirmDelete(false);
    setForm({
      id: c.id,
      teamId: String(c.teamId),
      date: c.date,
      checker: c.checker,
      notes: c.notes ?? "",
      status: c.status,
      lines: [...c.lines]
        .sort((a, b) => (itemById.get(a.itemId)?.name ?? "").localeCompare(itemById.get(b.itemId)?.name ?? ""))
        .map((l) => ({
          itemId: l.itemId,
          expected: fmtQty(l.expected),
          counted: l.counted == null ? "" : fmtQty(l.counted),
          note: l.note ?? "",
        })),
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
    if (!form.teamId) {
      toast.error("Escolha a dupla conferida.");
      return;
    }
    saveCount.mutate(
      {
        id: form.id,
        teamId: Number(form.teamId),
        date: form.date,
        checker: form.checker,
        status,
        notes: form.notes || null,
        lines: form.lines.map((l) => ({ itemId: l.itemId, expected: parseQty(l.expected) ?? 0, counted: parseQty(l.counted), note: l.note || null })),
      },
      {
        onSuccess: () => {
          toast.success(status === "finalizada" ? "Conferência finalizada" : "Rascunho salvo");
          setForm(null);
        },
      },
    );
  };

  // ---------- exportar / imprimir ----------
  const countRows = (c: StockCount) =>
    [...c.lines]
      .map((l) => ({ l, item: itemById.get(l.itemId) }))
      .sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? ""));

  const exportCsv = (c: StockCount) => {
    const team = teamById.get(c.teamId);
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      [`Conferência de estoque — ${team?.code ?? ""} ${team?.name ?? ""}`].map(esc).join(";"),
      [`Data: ${fmtDate(c.date)}`, `Conferente: ${c.checker}`, `Status: ${c.status}`].map(esc).join(";"),
      "",
      ["Item", "Unidade", "Esperado", "Contado", "Diferença", "Observação"].map(esc).join(";"),
      ...countRows(c).map(({ l, item }) =>
        [item?.name ?? "item removido", item?.unit ?? "", fmtQty(l.expected), fmtQty(l.counted), fmtDiff(lineDiff(l)), l.note ?? ""].map(esc).join(";"),
      ),
      ...(c.notes ? ["", [`Observações: ${c.notes}`].map(esc).join(";")] : []),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `conferencia-${team?.code.replace(/\s+/g, "") ?? c.teamId}-${c.date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const print = (c: StockCount) => {
    const team = teamById.get(c.teamId);
    const s = summarize(c);
    const h = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    const rows = countRows(c)
      .map(({ l, item }) => {
        const d = lineDiff(l);
        return `<tr class="${d == null ? "" : d < 0 ? "neg" : d > 0 ? "pos" : ""}"><td>${h(item?.name ?? "item removido")}</td><td>${h(item?.unit ?? "")}</td><td class="r">${fmtQty(l.expected)}</td><td class="r">${fmtQty(l.counted)}</td><td class="r">${fmtDiff(d)}</td><td>${h(l.note ?? "")}</td></tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Conferência ${h(team?.code ?? "")} ${c.date}</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}
      h1{font-size:18px;margin:0 0 4px} .meta{color:#444;margin-bottom:12px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:5px 7px;text-align:left}
      th{background:#eef2f6} .r{text-align:right} .neg td{background:#fde8e8} .pos td{background:#fff6dd}
      .sign{display:flex;gap:40px;margin-top:48px} .sign div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center}
    </style></head><body>
      <h1>Conferência de estoque — ${h(team?.code ?? "")} · ${h(team?.name ?? "")}</h1>
      <div class="meta">Data: <b>${fmtDate(c.date)}</b> · Conferente: <b>${h(c.checker)}</b> · Integrantes: ${h(membersOf(c.teamId) || "—")}${team?.vehicle ? ` · Veículo: ${h(team.vehicle)}` : ""}<br/>
      Status: ${c.status === "finalizada" ? "finalizada" : "rascunho"} · Faltas: ${s.missing} · Sobras: ${s.extra}${s.pending ? ` · Não contados: ${s.pending}` : ""}</div>
      <table><thead><tr><th>Item</th><th>Un</th><th class="r">Esperado</th><th class="r">Contado</th><th class="r">Diferença</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table>
      ${c.notes ? `<p><b>Observações:</b> ${h(c.notes)}</p>` : ""}
      <div class="sign"><div>${h(c.checker)}<br/>Almoxarifado</div><div>${h(team?.code ?? "")} — responsável da dupla</div></div>
    </body></html>`;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentWindow!.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  };

  // ---------- itens ----------
  const openItem = (i?: StockItem) =>
    setItemForm(
      i
        ? { id: i.id, name: i.name, unit: i.unit, category: i.category ?? "", sector: i.sector, kitQty: fmtQty(i.kitQty), active: i.active }
        : { name: "", unit: "un", category: "", sector, kitQty: "1", active: true },
    );
  const submitItem = () => {
    if (!itemForm) return;
    saveItem.mutate(
      {
        id: itemForm.id,
        name: itemForm.name,
        unit: itemForm.unit,
        category: itemForm.category || null,
        sector: itemForm.sector,
        kitQty: parseQty(itemForm.kitQty) ?? 0,
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

  // ---------- painel por dupla ----------
  const lastByTeam = (teamId: number, all: StockData["counts"]) => all.find((c) => c.teamId === teamId && c.status === "finalizada");
  const draftByTeam = (teamId: number, all: StockData["counts"]) => all.find((c) => c.teamId === teamId && c.status === "rascunho");
  const today = todayIso();

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
            Conferência do kit de material de cada dupla. Conferente: <b>{DEFAULT_CHECKER}</b> (supervisor de almoxarifado).
          </>
        }
        actions={
          <Button onClick={() => newCount()} disabled={!data}>
            <ClipboardCheck size={16} /> Nova conferência
          </Button>
        }
      />

      {error && <p className={styles.error}>{error instanceof Error ? error.message : String(error)}</p>}

      <div className={styles.toolbar}>
        <ToggleGroup type="single" value={sector} onValueChange={(v) => v && (setSector(v as Sector), setTeamFilter("__all"))}>
          <ToggleGroupItem value="suporte">Suporte (time técnico)</ToggleGroupItem>
          <ToggleGroupItem value="infraestrutura">Infra / Backbone</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {!data ? (
        <Skeleton className={styles.skel} />
      ) : (
        <div className={styles.teamGrid}>
          {teams.map((t) => {
            const last = lastByTeam(t.id, data.counts);
            const draft = draftByTeam(t.id, data.counts);
            const s = last ? summarize(last) : null;
            const age = last ? scheduleEngine.diffDays(today, last.date) : null;
            return (
              <div key={t.id} className={`${styles.teamCard} ${s && s.divergent > 0 ? styles.teamWarn : ""}`}>
                <div className={styles.teamHead}>
                  <span className={styles.code}>{t.code}</span>
                  <span className={styles.teamName}>{t.name}</span>
                </div>
                <div className={styles.meta}>{membersOf(t.id) || "sem técnicos"}</div>
                {t.vehicle && <div className={styles.meta}>{t.vehicle}</div>}
                <div className={styles.teamStatus}>
                  {last ? (
                    <>
                      Última: <b>{fmtDate(last.date)}</b> {age != null && age >= 0 && <span className={styles.meta}>({age === 0 ? "hoje" : `há ${age} dia${age > 1 ? "s" : ""}`})</span>}
                      <div>
                        {s!.divergent === 0 ? (
                          <span className={styles.ok}>Kit conforme</span>
                        ) : (
                          <span className={styles.bad}>
                            {s!.missing > 0 && `${s!.missing} falta${s!.missing > 1 ? "s" : ""}`}
                            {s!.missing > 0 && s!.extra > 0 && " · "}
                            {s!.extra > 0 && `${s!.extra} sobra${s!.extra > 1 ? "s" : ""}`}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className={styles.meta}>Nenhuma conferência finalizada</span>
                  )}
                </div>
                <div className={styles.teamActions}>
                  {draft ? (
                    <Button size="sm" variant="secondary" onClick={() => openCount(draft)}>
                      <Pencil size={14} /> Continuar rascunho
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => newCount(t.id)}>
                      <ClipboardCheck size={14} /> Conferir
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {teams.length === 0 && <p className={styles.empty}>Nenhuma dupla neste setor.</p>}
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "conferencias"} className={tab === "conferencias" ? styles.tabOn : ""} onClick={() => setTab("conferencias")}>
          Conferências
        </button>
        <button role="tab" aria-selected={tab === "itens"} className={tab === "itens" ? styles.tabOn : ""} onClick={() => setTab("itens")}>
          Itens do kit
        </button>
      </div>

      {tab === "conferencias" && data && (
        <section>
          <div className={styles.toolbar}>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className={styles.filter}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todas as duplas</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.code} · {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={styles.tableWrap}>
            {counts.length === 0 ? (
              <p className={styles.empty}>Nenhuma conferência registrada ainda. Use “Conferir” no card da dupla.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Dupla</th>
                    <th>Conferente</th>
                    <th className={styles.r}>Itens</th>
                    <th>Resultado</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => {
                    const t = teamById.get(c.teamId);
                    const s = summarize(c);
                    return (
                      <tr key={c.id}>
                        <td className={styles.mono}>{fmtDate(c.date)}</td>
                        <td>
                          <b>{t?.code}</b> <span className={styles.meta}>{t?.name}</span>
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
                          <Button size="icon-sm" variant="ghost" title="Imprimir" aria-label="Imprimir" onClick={() => print(c)}>
                            <Printer size={14} />
                          </Button>
                          <Button size="icon-sm" variant="ghost" title="Planilha (CSV)" aria-label="Planilha (CSV)" onClick={() => exportCsv(c)}>
                            <Download size={14} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {tab === "itens" && data && (
        <section>
          <div className={styles.toolbar}>
            <p className={styles.meta}>
              Itens que entram na conferência de {sector === "suporte" ? "Suporte" : "Infra / Backbone"}. “Qtd. no kit” é o esperado em cada dupla.
            </p>
            <Button size="sm" variant="outline" onClick={() => openItem()}>
              <PackagePlus size={14} /> Novo item
            </Button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Categoria</th>
                  <th>Setor</th>
                  <th className={styles.r}>Qtd. no kit</th>
                  <th>Un</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sectorItems.map((i) => (
                  <tr key={i.id} className={i.active ? "" : styles.inactive}>
                    <td>{i.name}</td>
                    <td className={styles.meta}>{i.category ?? "—"}</td>
                    <td>{SECTOR_LABEL[i.sector]}</td>
                    <td className={`${styles.mono} ${styles.r}`}>{fmtQty(i.kitQty)}</td>
                    <td>{i.unit}</td>
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
                  <label className={styles.label}>Dupla</label>
                  <Select value={form.teamId} onValueChange={(v) => setForm({ ...form, teamId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.teams.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.code} · {t.name}
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
              {form.teamId && <div className={styles.meta}>Integrantes: {membersOf(Number(form.teamId)) || "—"}</div>}

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
                      <th className={styles.r}>Esperado</th>
                      <th className={styles.r}>Contado</th>
                      <th className={styles.r}>Dif.</th>
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
                      return (
                        <tr key={l.itemId} className={d == null ? "" : d < 0 ? styles.lineNeg : d > 0 ? styles.linePos : styles.lineOk}>
                          <td>
                            {item?.name ?? "item removido"} <span className={styles.meta}>{item?.unit}</span>
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
                    if (item) setForm({ ...form, lines: [...form.lines, { itemId: item.id, expected: fmtQty(item.kitQty), counted: "", note: "" }] });
                  }}
                >
                  <SelectTrigger className={styles.addItem}>
                    <SelectValue placeholder="+ Incluir outro item" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableItems.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.name} ({SECTOR_LABEL[i.sector]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: ONU com defeito devolvida, cabo repassado para EQ 02…" />
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
            <Button onClick={() => submitCount("finalizada")} disabled={saveCount.isPending || !!formSummary?.pending}>
              <ClipboardCheck size={15} /> Finalizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- item ---------- */}
      <Dialog open={!!itemForm} onOpenChange={(o) => !o && setItemForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{itemForm?.id ? "Editar item" : "Novo item do kit"}</DialogTitle>
          </DialogHeader>
          {itemForm && (
            <div className={styles.form}>
              <label className={styles.label}>Nome</label>
              <Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
              <div className={styles.row3}>
                <div>
                  <label className={styles.label}>Qtd. no kit</label>
                  <Input inputMode="decimal" value={itemForm.kitQty} onChange={(e) => setItemForm({ ...itemForm, kitQty: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Unidade</label>
                  <Input value={itemForm.unit} placeholder="un, m, rolo…" onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Categoria</label>
                  <Input value={itemForm.category} placeholder="Equipamento, Ferramenta…" onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} />
                </div>
              </div>
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
              <div className={styles.switchRow}>
                <Switch id="item-active" checked={itemForm.active} onCheckedChange={(v) => setItemForm({ ...itemForm, active: v })} />
                <label htmlFor="item-active">Ativo (entra nas novas conferências)</label>
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
