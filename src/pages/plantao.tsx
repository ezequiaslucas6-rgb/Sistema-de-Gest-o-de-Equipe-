import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CalendarClock, Cpu, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { DateField } from "../components/DateField";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import type { OnCallShiftDTO } from "../endpoints/data_GET.schema";
import styles from "./plantao.module.css";

type RuleForm = { onCallTeams: number; onCallSaturday: string; onCallSunday: string };
type ShiftForm = { id?: number; teamId: string; weekendStart: string; comp1: string; comp2: string; notes: string };

function nextSaturday(from: string) {
  const wd = scheduleEngine.weekdayIndex(from); // 0 = seg ... 5 = sáb
  return scheduleEngine.addDays(from, wd <= 5 ? 5 - wd : 6);
}

function shortDate(iso: string) {
  return `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(iso)]} ${iso.slice(8)}/${iso.slice(5, 7)}`;
}

export default function OnCallPage() {
  const { data, error } = useAppData();
  const { saveSettings, bulkOnCall, saveOnCall, deleteOnCall } = useAppMutations();
  const today = scheduleEngine.todayIso();
  const firstSat = nextSaturday(today);
  // fim de semana em andamento (se hoje é sáb/dom) também aparece
  const listStart = scheduleEngine.weekdayIndex(today) >= 5 ? scheduleEngine.addDays(firstSat, -7) : firstSat;

  const [rules, setRules] = useState<Record<Sector, RuleForm> | null>(null);
  const [genSector, setGenSector] = useState<Sector>("suporte");
  const [genStart, setGenStart] = useState(firstSat);
  const [genWeeks, setGenWeeks] = useState(12);
  const [genPreview, setGenPreview] = useState<{ teamId: number; weekendStart: string; compDates: string[] }[] | null>(null);
  const [form, setForm] = useState<ShiftForm | null>(null);
  const [bankScope, setBankScope] = useState<"hoje" | "projetado">("projetado");

  const settingsKey = data ? JSON.stringify(data.settings) : "";
  useEffect(() => {
    if (!data) return;
    const r = {} as Record<Sector, RuleForm>;
    for (const s of labels.sectors) {
      const st = data.settings.find((x) => x.sector === s);
      r[s] = {
        onCallTeams: st?.onCallTeams ?? 1,
        onCallSaturday: st?.onCallSaturday ?? "14:00-18:00",
        onCallSunday: st?.onCallSunday ?? "08:00-12:00,14:00-18:00",
      };
    }
    setRules(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  const teamById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);
  const membersOf = (teamId: number) => data?.technicians.filter((t) => t.teamId === teamId) ?? [];

  const hoursFor = (sector: Sector) => {
    const st = data?.settings.find((x) => x.sector === sector);
    if (!st) return 0;
    return scheduleEngine.parseHours(st.onCallSaturday) + scheduleEngine.parseHours(st.onCallSunday);
  };

  const saveRules = (sector: Sector) => {
    const st = data?.settings.find((x) => x.sector === sector);
    if (!st || !rules) return;
    saveSettings.mutate({ ...st, ...rules[sector] });
  };

  const generate = () => {
    if (!data) return;
    const teamIds = data.teams.filter((t) => t.sector === genSector).map((t) => t.id);
    const per = data.settings.find((s) => s.sector === genSector)?.onCallTeams ?? 1;
    const isUnavailable = (teamId: number, sat: string) =>
      membersOf(teamId).some(
        (m) =>
          scheduleEngine.isAbsent(data.absences, m.id, sat) || scheduleEngine.isAbsent(data.absences, m.id, scheduleEngine.addDays(sat, 1)),
      );
    setGenPreview(
      scheduleEngine.generateOnCall({
        teamIds,
        firstSaturday: genStart,
        weekends: genWeeks,
        perWeekend: per,
        history: data.onCallShifts,
        isUnavailable,
        compDatesFor: (sat) => scheduleEngine.defaultCompDates(sat, genSector, data.patterns, data.holidays),
      }),
    );
  };

  const saveGenerated = () => {
    if (!genPreview) return;
    bulkOnCall.mutate(
      {
        sector: genSector,
        fromDate: genStart,
        toDate: scheduleEngine.addDays(genStart, (genWeeks - 1) * 7),
        shifts: genPreview,
      },
      { onSuccess: () => setGenPreview(null) },
    );
  };

  const openEdit = (s?: OnCallShiftDTO, weekendStart?: string) => {
    const sat = s?.weekendStart ?? weekendStart ?? firstSat;
    const def = defaultComp(sat, s ? teamById.get(s.teamId)?.sector : undefined);
    setForm({
      id: s?.id,
      teamId: s ? String(s.teamId) : "",
      weekendStart: sat,
      comp1: s?.compDates[0] ?? def[0],
      comp2: s?.compDates[1] ?? def[1],
      notes: s?.notes ?? "",
    });
  };

  function defaultComp(sat: string, sector?: Sector) {
    return scheduleEngine.defaultCompDates(sat, sector ?? "suporte", data?.patterns ?? [], data?.holidays ?? []);
  }

  const submitForm = () => {
    if (!form) return;
    saveOnCall.mutate(
      {
        id: form.id,
        teamId: Number(form.teamId),
        weekendStart: form.weekendStart,
        compDates: [form.comp1, form.comp2].filter(Boolean),
        notes: form.notes || null,
      },
      { onSuccess: () => setForm(null) },
    );
  };

  // próximos 12 fins de semana
  const weekends = Array.from({ length: 12 }, (_, i) => scheduleEngine.addDays(listStart, i * 7));

  const bank = useMemo(() => {
    if (!data) return [];
    return scheduleEngine.computeHourBank({
      teams: data.teams,
      shifts: data.onCallShifts,
      patterns: data.patterns,
      holidays: data.holidays,
      onCallHours: hoursFor,
      hoursPerDay: (sector, type, date) => {
        const st = data.settings.find((x) => x.sector === sector);
        if (type === "6x1" && scheduleEngine.weekdayIndex(date) === 5) return st?.hoursSixOneSaturday ?? 4;
        return type === "6x1" ? st?.hoursSixOne ?? 7.33 : st?.hoursFiveTwo ?? 8.8;
      },
      until: bankScope === "hoje" ? today : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, bankScope, today]);

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Plantões · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Fim de semana"
        title="Regras e banco de horas"
        description="Horário do plantão de cada setor e banco de horas de cada dupla (horas de plantão x dias de folga)."
        actions={
          <Button asChild>
            <Link to="/motor">
              <CalendarCheck size={16} /> Editar escala de plantão
            </Link>
          </Button>
        }
      />

      {/* Regras */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Regras do plantão</h2>
        <div className={styles.rules}>
          {labels.sectors.map((s) =>
            !rules ? (
              <Skeleton key={s} className={styles.skel} />
            ) : (
              <div key={s} className={`${styles.ruleCard} ${s === "infraestrutura" ? styles.infra : styles.support}`}>
                <div className={styles.micro}>{labels.sector[s]}</div>
                <div className={styles.ruleGrid}>
                  <div>
                    <label className={styles.label}>Duplas por fim de semana</label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={rules[s].onCallTeams}
                      onChange={(e) => setRules({ ...rules, [s]: { ...rules[s], onCallTeams: Math.max(0, Number(e.target.value) || 0) } })}
                    />
                  </div>
                  <div>
                    <label className={styles.label}>Sábado</label>
                    <Input
                      value={rules[s].onCallSaturday}
                      placeholder="14:00-18:00"
                      onChange={(e) => setRules({ ...rules, [s]: { ...rules[s], onCallSaturday: e.target.value } })}
                    />
                  </div>
                  <div>
                    <label className={styles.label}>Domingo</label>
                    <Input
                      value={rules[s].onCallSunday}
                      placeholder="08:00-12:00,14:00-18:00"
                      onChange={(e) => setRules({ ...rules, [s]: { ...rules[s], onCallSunday: e.target.value } })}
                    />
                  </div>
                </div>
                <div className={styles.ruleFoot}>
                  <span className={styles.hours}>
                    {scheduleEngine.parseHours(rules[s].onCallSaturday) + scheduleEngine.parseHours(rules[s].onCallSunday)}h por plantão · compensa
                    6x1: sex + sáb · 5x2: qui + sex seguintes
                  </span>
                  <Button variant="outline" size="sm" onClick={() => saveRules(s)} disabled={saveSettings.isPending}>
                    <Save size={14} /> Salvar
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      </section>

      {/* A escala de plantão (quem, quando, folga) é editada numa tela só */}
      <Link to="/motor" className={styles.goEditor}>
        <CalendarCheck size={22} />
        <span>
          <b>Escala de plantão</b>
          <small>Ver e editar quem está de plantão em cada fim de semana, a folga e os feriados — ou gerar o rodízio de vários meses.</small>
        </span>
        <span className={styles.goArrow}>Abrir →</span>
      </Link>

      {/* Banco de horas */}
      <section className={styles.section}>
        <div className={styles.bankHead}>
          <h2 className={styles.h2}>Banco de horas do plantão</h2>
          <ToggleGroup type="single" value={bankScope} onValueChange={(v) => v && setBankScope(v as "hoje" | "projetado")}>
            <ToggleGroupItem value="hoje">Até hoje</ToggleGroupItem>
            <ToggleGroupItem value="projetado">Projetado (com futuros)</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <p className={styles.muted}>
          Crédito = horas de plantão. Débito = horas dos dias de compensação que seriam trabalhados pela escala (6x1 ou 5x2 vigente no dia).
        </p>
        <div className={styles.bankTable}>
          <div className={`${styles.bankRow} ${styles.bankHeader}`}>
            <span>Dupla</span>
            <span>Plantões</span>
            <span>Crédito</span>
            <span>Compensado</span>
            <span>Saldo</span>
          </div>
          {bank.map((b) => {
            const team = teamById.get(b.teamId);
            return (
              <div key={b.teamId} className={styles.bankRow}>
                <span>
                  <b className={styles.mono}>{team?.code}</b> <span className={styles.muted}>{team ? labels.sectorShort[team.sector] : ""}</span>
                  {b.wastedCompDays > 0 && (
                    <span className={styles.wasted} title="Dias de compensação que já eram folga na escala">
                      {b.wastedCompDays} dia(s) de compensação já eram folga
                    </span>
                  )}
                </span>
                <span className={styles.mono}>
                  {b.shifts}
                  {b.holidayShifts > 0 && <span className={styles.muted}> +{b.holidayShifts} fer.</span>}
                </span>
                <span className={styles.mono}>+{b.credit}h</span>
                <span className={styles.mono}>−{b.debit}h</span>
                <span className={`${styles.mono} ${b.balance > 0 ? styles.pos : b.balance < 0 ? styles.neg : ""}`}>
                  {b.balance > 0 ? "+" : b.balance < 0 ? "−" : ""}
                  {Math.abs(b.balance)}h
                </span>
              </div>
            );
          })}
        </div>
        {bank.some((b) => b.wastedCompDays > 0) && (
          <p className={styles.warnText}>
            <AlertTriangle size={15} /> Algumas folgas de compensação caem em dia que já é folga na escala e não abatem horas. Edite o plantão e
            troque esse dia por um dia útil.
          </p>
        )}
      </section>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar plantão" : "Lançar plantão"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className={styles.form}>
              <label className={styles.label}>Dupla</label>
              <Select
                value={form.teamId}
                onValueChange={(v) => {
                  const def = form.id ? null : defaultComp(form.weekendStart, teamById.get(Number(v))?.sector);
                  setForm({ ...form, teamId: v, ...(def ? { comp1: def[0], comp2: def[1] } : {}) });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {data?.teams.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.code} · {t.name} ({labels.sectorShort[t.sector]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className={styles.label}>Fim de semana (sábado)</label>
              <DateField
                value={form.weekendStart}
                onlyWeekday={6}
                onChange={(v) => {
                  const def = defaultComp(v, teamById.get(Number(form.teamId))?.sector);
                  setForm({ ...form, weekendStart: v, comp1: def[0], comp2: def[1] });
                }}
              />
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Folga 1</label>
                  <DateField value={form.comp1} onChange={(v) => setForm({ ...form, comp1: v })} />
                </div>
                <div>
                  <label className={styles.label}>Folga 2</label>
                  <DateField value={form.comp2} onChange={(v) => setForm({ ...form, comp2: v })} />
                </div>
              </div>
              <p className={styles.muted}>
                <CalendarClock size={13} /> Padrão: 6x1 → sexta e sábado seguintes · 5x2 → quinta e sexta seguintes.
              </p>
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submitForm} disabled={saveOnCall.isPending || !form?.teamId}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
