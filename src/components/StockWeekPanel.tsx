import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, PackageCheck, Printer, Truck } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { toast } from "../helpers/toast";
import {
  type StockData,
  type StockTechnician,
  type SupplyStatus,
  countDateInWeek,
  mondayOfIso,
  useStockMutations,
  weeklyServices,
  weeklySupply,
} from "../helpers/stock";
import { type ExportRow, downloadSpreadsheet, parseNumber } from "../helpers/stockImport";
import { printDocs, supplyReport } from "../helpers/stockPrint";
import styles from "./StockWeekPanel.module.css";

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const STATUS_LABEL: Record<SupplyStatus, string> = { previsto: "Previsto", separado: "Separado", entregue: "Entregue" };
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const NONE = "__none";

type Sector = "suporte" | "infraestrutura";
type SupplyForm = { tech: StockTechnician; status: SupplyStatus; previous: SupplyStatus | null; notes: string; lines: { itemId: number; send: string }[] };

/** Agenda semanal de conferência por dupla e abastecimento calculado pelo fluxo de serviço. */
export const StockWeekPanel = ({ data, sector, query }: { data: StockData; sector: Sector; query: string }) => {
  const { saveSchedule, saveSupply } = useStockMutations();
  const [monday, setMonday] = useState(() => mondayOfIso(scheduleEngine.todayIso()));
  const [form, setForm] = useState<SupplyForm | null>(null);

  const teams = data.teams.filter((t) => t.sector === sector);
  const itemById = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const q = scheduleEngine.normalizeText(query.trim());
  const techsOf = (teamId: number) =>
    data.technicians.filter((t) => t.teamId === teamId && (!q || scheduleEngine.normalizeText(t.name).includes(q)));
  const scheduleOf = (teamId: number) => data.schedule.find((s) => s.teamId === teamId && s.active);
  const supplyOf = (techId: number) => data.supplies.find((s) => s.technicianId === techId && s.weekStart === monday);
  const today = scheduleEngine.todayIso();

  const linesFor = (tech: StockTechnician) => {
    const saved = supplyOf(tech.id);
    const calc = weeklySupply(data, tech.id, sector);
    if (saved) {
      const ids = new Set(saved.lines.map((l) => l.itemId));
      return [
        ...saved.lines.map((l) => ({ itemId: l.itemId, send: fmt(l.qty) })),
        ...calc.filter((c) => !ids.has(c.item.id) && c.send > 0).map((c) => ({ itemId: c.item.id, send: "0" })),
      ];
    }
    return calc.filter((c) => c.send > 0 || c.need > 0).map((c) => ({ itemId: c.item.id, send: fmt(c.send) }));
  };

  const open = (tech: StockTechnician) => {
    const saved = supplyOf(tech.id);
    setForm({ tech, status: saved?.status ?? "previsto", previous: saved?.status ?? null, notes: saved?.notes ?? "", lines: linesFor(tech) });
  };

  const submit = (status: SupplyStatus) => {
    if (!form) return;
    saveSupply.mutate(
      {
        technicianId: form.tech.id,
        weekStart: monday,
        status,
        previousStatus: form.previous,
        notes: form.notes,
        lines: form.lines.map((l) => ({ itemId: l.itemId, qty: parseNumber(l.send) ?? 0 })),
      },
      {
        onSuccess: () => {
          toast.success(status === "entregue" ? "Entregue: material somado ao saldo do colaborador" : `Abastecimento ${STATUS_LABEL[status].toLowerCase()}`);
          setForm(null);
        },
      },
    );
  };

  const reportGroups = (techs: StockTechnician[]) =>
    techs.map((tech) => {
      const saved = supplyOf(tech.id);
      const calc = weeklySupply(data, tech.id, sector);
      const sched = tech.teamId ? scheduleOf(tech.teamId) : undefined;
      const team = data.teams.find((t) => t.id === tech.teamId);
      const lines = saved
        ? saved.lines.map((l) => {
            const c = calc.find((x) => x.item.id === l.itemId);
            const item = itemById.get(l.itemId);
            return { code: item?.code ?? null, name: item?.name ?? "?", unit: item?.unit ?? "", need: c?.need ?? 0, balance: c?.balance ?? 0, send: l.qty };
          })
        : calc.map((c) => ({ code: c.item.code, name: c.item.name, unit: c.item.unit, need: c.need, balance: c.balance, send: c.send }));
      return {
        technician: tech.name,
        team: team ? `${team.code} · ${team.name}` : "",
        countDay: sched ? `${WEEKDAYS[sched.weekday]} ${scheduleEngine.formatDate(countDateInWeek(sched, monday)).slice(0, 5)} ${sched.time}` : "sem dia definido",
        services: weeklyServices(data, tech.id, sector)
          .filter((s) => s.qty > 0)
          .map((s) => `${fmt(s.qty)} ${s.service.name}`)
          .join(" · "),
        lines,
      };
    });

  const allTechs = teams.flatMap((t) => techsOf(t.id));
  const printAll = () =>
    printDocs("Abastecimento da semana", [
      supplyReport({ title: "Ordem de abastecimento da semana", week: scheduleEngine.formatDate(monday), groups: reportGroups(allTechs) }),
    ]);
  const exportAll = () => {
    const lastMapping = data.imports.find((i) => i.mapping)?.mapping ?? null;
    const rows: ExportRow[] = reportGroups(allTechs).flatMap((g) =>
      g.lines
        .filter((l) => l.send > 0)
        .map((l) => ({ technician: g.technician, code: l.code ?? "", name: l.name, unit: l.unit, qty: l.send, min: null, max: null, extra: { "Consumo previsto": l.need, "Saldo atual": l.balance } })),
    );
    if (!rows.length) return toast.error("Nada a enviar nesta semana.");
    void downloadSpreadsheet(`abastecimento-${sector}-${monday}`, rows, lastMapping, "xlsx");
  };

  return (
    <section>
      <div className={styles.bar}>
        <div className={styles.weekNav}>
          <Button size="icon-sm" variant="ghost" aria-label="Semana anterior" onClick={() => setMonday(scheduleEngine.addDays(monday, -7))}>
            <ChevronLeft size={16} />
          </Button>
          <span className={styles.week}>
            Semana {scheduleEngine.formatDate(monday).slice(0, 5)} a {scheduleEngine.formatDate(scheduleEngine.addDays(monday, 6)).slice(0, 5)}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Próxima semana" onClick={() => setMonday(scheduleEngine.addDays(monday, 7))}>
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="outline" onClick={printAll}>
            <Printer size={14} /> Imprimir ordem de abastecimento
          </Button>
          <Button size="sm" variant="outline" onClick={exportAll}>
            <FileDown size={14} /> Exportar (.xlsx)
          </Button>
        </div>
      </div>
      <p className={styles.meta}>
        Cada dupla tem um dia fixo de conferência na semana; o técnico recebe o aviso no celular na véspera. O abastecimento = consumo previsto pelo fluxo de
        serviço + estoque mínimo − saldo atual (sem passar do máximo).
      </p>

      <div className={styles.teams}>
        {teams.map((team) => {
          const sched = scheduleOf(team.id);
          const date = sched ? countDateInWeek(sched, monday) : null;
          const techs = techsOf(team.id);
          if (q && !techs.length) return null;
          return (
            <div key={team.id} className={styles.team}>
              <div className={styles.teamHead}>
                <div>
                  <b>{team.code}</b> <span className={styles.meta}>{team.name}</span>
                </div>
                <div className={styles.sched}>
                  <span className={styles.label}>Conferência</span>
                  <Select
                    value={sched ? String(sched.weekday) : NONE}
                    onValueChange={(v) => saveSchedule.mutate({ teamId: team.id, weekday: v === NONE ? null : Number(v), time: sched?.time ?? "08:00" })}
                  >
                    <SelectTrigger className={styles.daySelect}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— sem dia —</SelectItem>
                      {WEEKDAYS.map((w, i) => (
                        <SelectItem key={w} value={String(i)}>
                          {w}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sched && (
                    <Input
                      type="time"
                      className={styles.time}
                      defaultValue={sched.time}
                      onBlur={(e) => e.target.value !== sched.time && saveSchedule.mutate({ teamId: team.id, weekday: sched.weekday, time: e.target.value })}
                    />
                  )}
                  {date && (
                    <span className={`${styles.pill} ${date === today ? styles.pillToday : date < today ? styles.pillPast : ""}`}>
                      {date === today ? "hoje" : scheduleEngine.formatDate(date).slice(0, 5)}
                    </span>
                  )}
                </div>
              </div>
              <table className={styles.table}>
                <tbody>
                  {techs.map((tech) => {
                    const calc = weeklySupply(data, tech.id, sector);
                    const saved = supplyOf(tech.id);
                    const toSend = saved ? saved.lines.filter((l) => l.qty > 0).length : calc.filter((c) => c.send > 0).length;
                    const services = weeklyServices(data, tech.id, sector).filter((s) => s.qty > 0);
                    return (
                      <tr key={tech.id}>
                        <td>
                          <b>{tech.name}</b>
                          <div className={styles.meta}>{services.map((s) => `${fmt(s.qty)} ${s.service.name.toLowerCase()}`).join(" · ") || "sem serviços previstos"}</div>
                        </td>
                        <td className={styles.r}>
                          {toSend ? `${toSend} ${toSend === 1 ? "item" : "itens"} a enviar` : <span className={styles.meta}>nada a enviar</span>}
                        </td>
                        <td>
                          <span className={`${styles.status} ${styles[saved?.status ?? "none"]}`}>{saved ? STATUS_LABEL[saved.status] : "Não gerado"}</span>
                        </td>
                        <td className={styles.r}>
                          <Button size="sm" variant={saved?.status === "entregue" ? "ghost" : "outline"} onClick={() => open(tech)}>
                            <Truck size={14} /> Abastecimento
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Abastecimento · {form?.tech.name}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className={styles.form}>
              <div className={styles.meta}>
                Semana de {scheduleEngine.formatDate(monday)} ·{" "}
                {weeklyServices(data, form.tech.id, sector)
                  .filter((s) => s.qty > 0)
                  .map((s) => `${fmt(s.qty)} ${s.service.name.toLowerCase()}`)
                  .join(" · ") || "sem serviços previstos"}
              </div>
              <div className={styles.linesWrap}>
                <table className={styles.lines}>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className={styles.r}>Consumo</th>
                      <th className={styles.r}>Saldo</th>
                      <th className={styles.r}>Mín./Máx.</th>
                      <th className={styles.r}>Enviar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, idx) => {
                      const c = weeklySupply(data, form.tech.id, sector).find((x) => x.item.id === l.itemId);
                      const item = itemById.get(l.itemId);
                      return (
                        <tr key={l.itemId}>
                          <td>
                            {item?.name} <span className={styles.meta}>{item?.code ? `${item.code} · ` : ""}{item?.unit}</span>
                            {c?.capped && <div className={styles.warn}>máximo menor que o consumo previsto</div>}
                          </td>
                          <td className={styles.r}>{fmt(c?.need ?? 0)}</td>
                          <td className={styles.r}>{fmt(c?.balance ?? 0)}</td>
                          <td className={styles.r}>
                            {item?.minQty ? fmt(item.minQty) : "—"}/{item?.maxQty != null ? fmt(item.maxQty) : "—"}
                          </td>
                          <td className={styles.r}>
                            <Input
                              inputMode="decimal"
                              className={styles.qty}
                              value={l.send}
                              disabled={form.previous === "entregue"}
                              onChange={(e) => setForm({ ...form, lines: form.lines.map((x, i) => (i === idx ? { ...x, send: e.target.value } : x)) })}
                              aria-label={`Enviar ${item?.name}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {form.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.meta}>
                          Nada calculado: cadastre o fluxo de serviço (aba “Fluxo de serviço”) ou o mínimo dos itens.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              {form.previous === "entregue" && <p className={styles.meta}>Já entregue: o material foi somado ao saldo do colaborador.</p>}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => form && printDocs("Abastecimento", [supplyReport({ title: "Ordem de abastecimento", week: scheduleEngine.formatDate(monday), groups: reportGroups([form.tech]) })])}
            >
              <Printer size={14} /> Imprimir
            </Button>
            {form?.previous !== "entregue" && (
              <>
                <Button variant="outline" onClick={() => submit("previsto")} disabled={saveSupply.isPending}>
                  Salvar previsto
                </Button>
                <Button variant="outline" onClick={() => submit("separado")} disabled={saveSupply.isPending}>
                  Separado
                </Button>
                <Button onClick={() => submit("entregue")} disabled={saveSupply.isPending}>
                  <PackageCheck size={15} /> Entregue
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
