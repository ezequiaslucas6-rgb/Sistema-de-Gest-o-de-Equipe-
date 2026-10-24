import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { ChevronLeft, ChevronRight, FileDown, Pencil, Plane, Plus, Printer, Repeat, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Switch } from "../components/Switch";
import { Skeleton } from "../components/Skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import type { TripStatus } from "../helpers/schema";
import type { TripDTO, TripSettingsDTO } from "../endpoints/data_GET.schema";
import { planOnCallAdjustment } from "../helpers/onCallMotor";
import { toast } from "../helpers/toast";
import styles from "./viagens.module.css";

type Form = {
  id?: number;
  teamId: string;
  technicianIds: string[];
  destination: string;
  reason: string;
  vehicle: string;
  departAt: string;
  returnAt: string;
  returnedAt: string;
  advance: string;
  status: TripStatus;
  notes: string;
};

const money = scheduleEngine.formatMoney;
const STATUS_ORDER: TripStatus[] = ["planejada", "em_viagem", "retornou", "prestacao", "paga"];

function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDateTime(dt: string): string {
  const [d, t] = dt.split("T");
  return `${scheduleEngine.formatDate(d).slice(0, 5)} ${t}`;
}

/** "2 + ½" diárias */
function fmtDiarias(full: number, half: number): string {
  if (full === 0 && half === 0) return "—";
  if (full === 0) return "½";
  return half ? `${full} + ½` : String(full);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function statusVariant(s: TripStatus): "outline" | "warning" | "success" | "secondary" | "primary" {
  if (s === "paga") return "success";
  if (s === "em_viagem") return "primary";
  if (s === "retornou" || s === "prestacao") return "warning";
  return "outline";
}

export default function TripsPage() {
  const { data, error } = useAppData();
  const { saveTrip, setTripStatus, deleteTrip, saveTripSettings, applyOnCallAdjust } = useAppMutations();
  const now = nowLocal();
  const [month, setMonth] = useState(now.slice(0, 7));
  const [scope, setScope] = useState<"todas" | "abertas" | "pagas">("todas");
  const [form, setForm] = useState<Form | null>(null);
  const [rules, setRules] = useState<TripSettingsDTO | null>(null);

  const settingsKey = data ? JSON.stringify(data.tripSettings) : "";
  useEffect(() => {
    if (data) setRules(data.tripSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const techById = useMemo(() => new Map((data?.technicians ?? []).map((t) => [t.id, t])), [data]);
  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const settings = data?.tripSettings;

  const teamCodeOf = (techId: number) => {
    const t = techById.get(techId);
    return t?.teamId ? teamById.get(t.teamId)?.code : undefined;
  };
  const techNames = (ids: number[]) => ids.map((id) => techById.get(id)?.name ?? "removido").join(", ");

  // viagens do mês (pela data de saída), com diárias calculadas
  const monthTrips = useMemo(() => {
    if (!data || !settings) return [];
    return data.trips
      .filter((t) => t.departAt.slice(0, 7) === month)
      .filter((t) => (scope === "pagas" ? t.status === "paga" : scope === "abertas" ? t.status !== "paga" : true))
      .map((t) => ({ trip: t, calc: scheduleEngine.tripAllowance(t, settings) }))
      .sort((a, b) => a.trip.departAt.localeCompare(b.trip.departAt));
  }, [data, settings, month, scope]);

  const allMonthTrips = useMemo(
    () => (data && settings ? data.trips.filter((t) => t.departAt.slice(0, 7) === month).map((t) => ({ trip: t, calc: scheduleEngine.tripAllowance(t, settings) })) : []),
    [data, settings, month],
  );

  // relatório por técnico (adiantamento rateado igualmente entre os técnicos da viagem)
  const report = useMemo(() => {
    const rows = new Map<number, { trips: number; full: number; half: number; value: number; advance: number }>();
    for (const { trip, calc } of allMonthTrips) {
      const share = trip.technicianIds.length ? trip.advance / trip.technicianIds.length : 0;
      for (const id of trip.technicianIds) {
        const r = rows.get(id) ?? { trips: 0, full: 0, half: 0, value: 0, advance: 0 };
        r.trips += 1;
        r.full += calc.full;
        r.half += calc.half;
        r.value += calc.perTechnician;
        r.advance += share;
        rows.set(id, r);
      }
    }
    return [...rows.entries()]
      .map(([id, r]) => ({ id, name: techById.get(id)?.name ?? "removido", code: teamCodeOf(id), ...r, balance: r.value - r.advance }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMonthTrips, techById]);

  const totals = useMemo(() => {
    const value = allMonthTrips.reduce((s, x) => s + x.calc.total, 0);
    const advance = allMonthTrips.reduce((s, x) => s + x.trip.advance, 0);
    const open = allMonthTrips.filter((x) => x.trip.status !== "paga").reduce((s, x) => s + x.calc.total - x.trip.advance, 0);
    const full = allMonthTrips.reduce((s, x) => s + x.calc.full * x.trip.technicianIds.length, 0);
    const half = allMonthTrips.reduce((s, x) => s + x.calc.half * x.trip.technicianIds.length, 0);
    return { value, advance, open, full, half };
  }, [allMonthTrips]);

  const travelingNow = (data?.trips ?? []).filter((t) => t.departAt <= now && scheduleEngine.tripEnd(t) >= now && !t.returnedAt);

  const monthLabel = (() => {
    const raw = new Date(`${month}-15T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();

  // ---------- formulário ----------
  const openForm = (t?: TripDTO) => {
    const today = now.slice(0, 10);
    setForm(
      t
        ? {
            id: t.id,
            teamId: "__none",
            technicianIds: t.technicianIds.map(String),
            destination: t.destination,
            reason: t.reason ?? "",
            vehicle: t.vehicle ?? "",
            departAt: t.departAt,
            returnAt: t.returnAt,
            returnedAt: t.returnedAt ?? "",
            advance: String(t.advance || ""),
            status: t.status,
            notes: t.notes ?? "",
          }
        : {
            teamId: "__none",
            technicianIds: [],
            destination: "",
            reason: "",
            vehicle: "",
            departAt: `${today}T07:00`,
            returnAt: `${today}T18:00`,
            returnedAt: "",
            advance: "",
            status: "planejada",
            notes: "",
          },
    );
  };

  const formCalc = useMemo(() => {
    if (!form || !settings || !form.departAt || !form.returnAt) return null;
    return scheduleEngine.tripAllowance(
      {
        id: 0,
        technicianIds: form.technicianIds.map(Number),
        departAt: form.departAt,
        returnAt: form.returnAt,
        returnedAt: form.returnedAt || null,
      },
      settings,
    );
  }, [form, settings]);

  // viagem em fim de semana/feriado de plantão: o plantão passa para outra dupla automaticamente
  const onCallAdjust = useMemo(() => {
    if (!data || !form || !form.technicianIds.length || !/^\d{4}-\d{2}-\d{2}/.test(form.departAt) || !/^\d{4}-\d{2}-\d{2}/.test(form.returnAt)) return null;
    const end = (form.returnedAt || form.returnAt).slice(0, 10);
    if (end < form.departAt.slice(0, 10)) return null;
    return planOnCallAdjustment(
      { ...data, trips: data.trips.filter((t) => t.id !== form.id) },
      {
        technicianIds: form.technicianIds.map(Number),
        start: form.departAt.slice(0, 10),
        end,
        label: `viagem para ${form.destination || "o destino"}`,
      },
    );
  }, [data, form]);

  const submit = () => {
    if (!form) return;
    const adjust = onCallAdjust;
    saveTrip.mutate(
      {
        id: form.id,
        technicianIds: form.technicianIds.map(Number),
        destination: form.destination,
        reason: form.reason || null,
        vehicle: form.vehicle || null,
        departAt: form.departAt,
        returnAt: form.returnAt,
        returnedAt: form.returnedAt || null,
        status: form.status,
        advance: Number(form.advance.replace(",", ".")) || 0,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          setForm(null);
          if (adjust && (adjust.shifts.length || adjust.holidays.length)) {
            applyOnCallAdjust.mutate(
              { shifts: adjust.shifts, holidays: adjust.holidays },
              { onSuccess: () => toast(`Plantão ajustado — ${adjust.messages.join(" ")}`) },
            );
          } else if (adjust?.messages.length) {
            toast.error(adjust.messages.join(" "));
          }
        },
      },
    );
  };

  // ---------- exportação ----------
  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const num = (v: number) => v.toFixed(2).replace(".", ",");
    const lines = [
      ["Técnico", "Dupla", "Viagens", "Diárias cheias", "Meias diárias", "Valor", "Adiantado", "Saldo a pagar"].map(esc).join(";"),
      ...report.map((r) => [r.name, r.code ?? "", r.trips, r.full, r.half, num(r.value), num(r.advance), num(r.balance)].map(esc).join(";")),
      "",
      ["Destino", "Motivo", "Técnicos", "Saída", "Retorno", "Diárias por técnico", "Valor total", "Adiantamento", "Status"].map(esc).join(";"),
      ...allMonthTrips.map(({ trip, calc }) =>
        [
          trip.destination,
          trip.reason ?? "",
          techNames(trip.technicianIds),
          fmtDateTime(trip.departAt),
          fmtDateTime(scheduleEngine.tripEnd(trip)),
          fmtDiarias(calc.full, calc.half),
          num(calc.total),
          num(trip.advance),
          labels.tripStatus[trip.status],
        ]
          .map(esc)
          .join(";"),
      ),
    ];
    // BOM para o Excel abrir os acentos corretamente
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `diarias-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  const infraFirst = [...(data?.technicians ?? [])].sort((a, b) => {
    const sa = a.teamId ? teamById.get(a.teamId)?.sector : "z";
    const sb = b.teamId ? teamById.get(b.teamId)?.sector : "z";
    if (sa !== sb) return sa === "infraestrutura" ? -1 : sb === "infraestrutura" ? 1 : 0;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Viagens · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Equipe em deslocamento"
        title="Viagens e diárias"
        description="Registre as viagens da equipe (principalmente Backbone). As diárias são calculadas pelas datas e horários; a dupla viajando aparece na escala como V e sai da cobertura local."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={16} /> Imprimir
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={allMonthTrips.length === 0}>
              <FileDown size={16} /> Exportar CSV
            </Button>
            <Button onClick={() => openForm()}>
              <Plus size={16} /> Nova viagem
            </Button>
          </>
        }
      />

      {travelingNow.length > 0 && (
        <div className={styles.now}>
          <Plane size={18} />
          <div>
            <div className={styles.micro}>Em viagem agora</div>
            {travelingNow.map((t) => (
              <div key={t.id}>
                <b>{t.destination}</b> — {techNames(t.technicianIds)} · volta {fmtDateTime(t.returnAt)}
                {t.returnAt < now && <span className={styles.late}> (retorno atrasado)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.monthNav}>
          <Button variant="ghost" size="icon-md" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
            <ChevronLeft size={18} />
          </Button>
          <span className={styles.monthLabel}>{monthLabel}</span>
          <Button variant="ghost" size="icon-md" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
            <ChevronRight size={18} />
          </Button>
        </div>
        <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v as typeof scope)}>
          <ToggleGroupItem value="todas">Todas</ToggleGroupItem>
          <ToggleGroupItem value="abertas">Em aberto</ToggleGroupItem>
          <ToggleGroupItem value="pagas">Pagas</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <b>{allMonthTrips.length}</b>
          <span>Viagens no mês</span>
        </div>
        <div className={styles.stat}>
          <b>{totals.full}</b>
          <span>Diárias cheias (soma dos técnicos)</span>
        </div>
        <div className={styles.stat}>
          <b>{totals.half}</b>
          <span>Meias diárias (soma dos técnicos)</span>
        </div>
        <div className={styles.stat}>
          <b className={styles.statMoney}>{money(totals.value)}</b>
          <span>Total do mês</span>
        </div>
        <div className={`${styles.stat} ${styles.statOpen}`}>
          <b className={styles.statMoney}>{money(totals.open)}</b>
          <span>A acertar (não pagas)</span>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.h2}>Viagens</h2>
        <div className={styles.tableWrap}>
          {!data && <Skeleton className={styles.skel} />}
          {data && monthTrips.length === 0 && <p className={styles.empty}>Nenhuma viagem em {monthLabel.toLowerCase()}.</p>}
          {monthTrips.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Destino</th>
                  <th>Técnicos</th>
                  <th>Saída</th>
                  <th>Retorno</th>
                  <th className={styles.r}>Diárias/téc.</th>
                  <th className={styles.r}>Total</th>
                  <th className={styles.r}>Adiantado</th>
                  <th className={styles.r}>Saldo</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monthTrips.map(({ trip, calc }) => {
                  const late = !trip.returnedAt && trip.returnAt < now && trip.status !== "paga";
                  return (
                    <tr key={trip.id}>
                      <td>
                        <div className={styles.dest}>{trip.destination}</div>
                        <div className={styles.meta}>{[trip.reason, trip.vehicle].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className={styles.techs}>
                        {trip.technicianIds.map((id) => (
                          <div key={id}>
                            {techById.get(id)?.name ?? "removido"} <span className={styles.meta}>{teamCodeOf(id)}</span>
                          </div>
                        ))}
                      </td>
                      <td className={styles.mono}>{fmtDateTime(trip.departAt)}</td>
                      <td className={styles.mono}>
                        {fmtDateTime(scheduleEngine.tripEnd(trip))}
                        {!trip.returnedAt && <div className={late ? styles.late : styles.meta}>{late ? "atrasado" : "previsto"}</div>}
                      </td>
                      <td className={`${styles.mono} ${styles.r}`}>
                        {fmtDiarias(calc.full, calc.half)}
                        <div className={styles.meta}>{money(calc.perTechnician)}</div>
                      </td>
                      <td className={`${styles.mono} ${styles.r}`}>{money(calc.total)}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{money(trip.advance)}</td>
                      <td className={`${styles.mono} ${styles.r} ${calc.total - trip.advance < 0 ? styles.neg : ""}`}>{money(calc.total - trip.advance)}</td>
                      <td>
                        <Select value={trip.status} onValueChange={(v) => setTripStatus.mutate({ id: trip.id, status: v as TripStatus })}>
                          <SelectTrigger className={styles.statusTrigger} aria-label="Status da viagem">
                            <Badge variant={statusVariant(trip.status)}>{labels.tripStatus[trip.status]}</Badge>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_ORDER.map((s) => (
                              <SelectItem key={s} value={s}>
                                {labels.tripStatus[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={styles.actions}>
                        <Button variant="ghost" size="icon-sm" onClick={() => openForm(trip)} aria-label="Editar viagem">
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Excluir viagem"
                          onClick={() => window.confirm(`Excluir a viagem para ${trip.destination}?`) && deleteTrip.mutate({ id: trip.id })}
                        >
                          <Trash2 />
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

      <div className={styles.twoCol}>
        <section className={styles.section}>
          <h2 className={styles.h2}>Diárias por técnico — {monthLabel}</h2>
          <div className={styles.tableWrap}>
            {report.length === 0 ? (
              <p className={styles.empty}>Sem diárias no mês.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Técnico</th>
                    <th className={styles.r}>Viagens</th>
                    <th className={styles.r}>Diárias</th>
                    <th className={styles.r}>Valor</th>
                    <th className={styles.r}>Adiantado</th>
                    <th className={styles.r}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name} <span className={styles.meta}>{r.code}</span>
                      </td>
                      <td className={`${styles.mono} ${styles.r}`}>{r.trips}</td>
                      <td className={`${styles.mono} ${styles.r}`}>
                        {r.full}
                        {r.half > 0 ? ` + ${r.half}×½` : ""}
                      </td>
                      <td className={`${styles.mono} ${styles.r}`}>{money(r.value)}</td>
                      <td className={`${styles.mono} ${styles.r}`}>{money(r.advance)}</td>
                      <td className={`${styles.mono} ${styles.r} ${styles.strong}`}>{money(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Regras das diárias</h2>
          {!rules ? (
            <Skeleton className={styles.skel} />
          ) : (
            <div className={styles.rules}>
              <div className={styles.rulesGrid}>
                <div>
                  <label className={styles.label}>Diária cheia (por pernoite)</label>
                  <Input type="number" min={0} step="0.01" value={rules.fullValue} onChange={(e) => setRules({ ...rules, fullValue: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={styles.label}>Meia diária</label>
                  <Input type="number" min={0} step="0.01" value={rules.halfValue} onChange={(e) => setRules({ ...rules, halfValue: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className={styles.label}>Horas mínimas p/ meia (sem pernoite)</label>
                  <Input type="number" min={0} max={24} step="0.5" value={rules.minHoursHalf} onChange={(e) => setRules({ ...rules, minHoursHalf: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className={styles.switchRow}>
                <Switch id="half-return" checked={rules.halfOnReturn} onCheckedChange={(v) => setRules({ ...rules, halfOnReturn: v })} />
                <label htmlFor="half-return">Dia do retorno (após pernoite) vale meia diária</label>
              </div>
              <p className={styles.hint}>
                Exemplo com essas regras: sai segunda 07h e volta quarta 18h → 2 pernoites = 2 diárias cheias
                {rules.halfOnReturn ? " + ½ no retorno" : ""} = {money(2 * rules.fullValue + (rules.halfOnReturn ? rules.halfValue : 0))} por técnico.
              </p>
              <Button variant="outline" size="sm" onClick={() => saveTripSettings.mutate(rules)} disabled={saveTripSettings.isPending}>
                <Save size={14} /> Salvar regras
              </Button>
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar viagem" : "Nova viagem"}</DialogTitle>
          </DialogHeader>
          {form && data && (
            <div className={styles.form}>
              <label className={styles.label}>Dupla</label>
              <Select
                value={form.teamId}
                onValueChange={(v) => {
                  const team = data.teams.find((t) => String(t.id) === v);
                  setForm({
                    ...form,
                    teamId: v,
                    technicianIds: team ? data.technicians.filter((t) => t.teamId === team.id).map((t) => String(t.id)) : form.technicianIds,
                    vehicle: team?.vehicle && !form.vehicle ? team.vehicle : form.vehicle,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolher dupla" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Escolher técnicos um a um</SelectItem>
                  {[...data.teams]
                    .sort((a, b) => (a.sector === b.sector ? a.code.localeCompare(b.code) : a.sector === "infraestrutura" ? -1 : 1))
                    .map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.code} · {t.name} ({labels.sectorShort[t.sector]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <label className={styles.label}>Técnicos na viagem</label>
              <ToggleGroup
                type="multiple"
                size="sm"
                variant="outline"
                value={form.technicianIds}
                onValueChange={(v) => setForm({ ...form, technicianIds: v, teamId: "__none" })}
                className={styles.techPicker}
              >
                {infraFirst.map((t) => (
                  <ToggleGroupItem key={t.id} value={String(t.id)}>
                    {t.name}
                    {t.teamId ? ` · ${teamById.get(t.teamId)?.code}` : ""}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Destino</label>
                  <Input value={form.destination} placeholder="Cidade / POP" onChange={(e) => setForm({ ...form, destination: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Motivo</label>
                  <Input value={form.reason} placeholder="Ex.: rompimento de fibra" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
              </div>
              <div className={styles.row3}>
                <div>
                  <label className={styles.label}>Saída</label>
                  <Input type="datetime-local" value={form.departAt} onChange={(e) => setForm({ ...form, departAt: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Retorno previsto</label>
                  <Input type="datetime-local" value={form.returnAt} onChange={(e) => setForm({ ...form, returnAt: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Retorno real</label>
                  <Input type="datetime-local" value={form.returnedAt} onChange={(e) => setForm({ ...form, returnedAt: e.target.value })} />
                </div>
              </div>
              <div className={styles.row3}>
                <div>
                  <label className={styles.label}>Veículo</label>
                  <Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Adiantamento (R$)</label>
                  <Input inputMode="decimal" value={form.advance} placeholder="0,00" onChange={(e) => setForm({ ...form, advance: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Status</label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as TripStatus })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>
                          {labels.tripStatus[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              {formCalc && (
                <div className={styles.calc}>
                  <div className={styles.micro}>Cálculo das diárias</div>
                  <div>
                    {formCalc.nights} pernoite(s) · {formCalc.hours}h fora → <b>{fmtDiarias(formCalc.full, formCalc.half)}</b> diária(s) ={" "}
                    <b>{money(formCalc.perTechnician)}</b> por técnico
                    {form.technicianIds.length > 0 && (
                      <>
                        {" "}
                        · total ({form.technicianIds.length} técnico{form.technicianIds.length > 1 ? "s" : ""}): <b>{money(formCalc.total)}</b>
                      </>
                    )}
                  </div>
                  {formCalc.full === 0 && formCalc.half === 0 && settings && (
                    <div className={styles.meta}>Sem diária: menos de {settings.minHoursHalf}h fora e sem pernoite.</div>
                  )}
                </div>
              )}
              {onCallAdjust && onCallAdjust.messages.length > 0 && (
                <div className={styles.onCallBox}>
                  <div className={styles.micro}>
                    <Repeat size={12} /> Plantão · ajuste automático ao salvar
                  </div>
                  {onCallAdjust.messages.map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saveTrip.isPending || !form?.destination || !form?.technicianIds.length}>
              Salvar viagem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
