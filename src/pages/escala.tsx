import { Fragment, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { ChevronLeft, ChevronRight, Printer, Repeat } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DayCell } from "../components/DayCell";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Skeleton } from "../components/Skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { buildScheduleSnapshot, TeamDayView } from "../helpers/buildScheduleSnapshot";
import { labels } from "../helpers/labels";
import type { AbsenceKind } from "../helpers/schema";
import styles from "./escala.module.css";

type Filter = "todos" | Sector;

function monthStart(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function daysInMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftMonth(iso: string, delta: number) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default function SchedulePage() {
  const { data, error } = useAppData();
  const { savePattern, saveAbsence } = useAppMutations();
  const today = scheduleEngine.todayIso();
  const [month, setMonth] = useState(monthStart(today));
  const [filter, setFilter] = useState<Filter>("todos");
  const [selected, setSelected] = useState<{ sector: Sector; date: string; view: TeamDayView } | null>(null);
  const [absenceTech, setAbsenceTech] = useState<string>("");
  const [absenceKind, setAbsenceKind] = useState<AbsenceKind>("folga_extra");

  const nDays = daysInMonth(month);
  const dates = useMemo(() => Array.from({ length: nDays }, (_, i) => scheduleEngine.addDays(month, i)), [month, nDays]);
  const snapshot = useMemo(() => (data ? buildScheduleSnapshot(data, month, nDays) : null), [data, month, nDays]);
  const sectors = filter === "todos" ? labels.sectors : [filter];
  const monthRaw = new Date(`${month}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const monthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);

  const selectedTeam = selected ? data?.teams.find((t) => t.id === selected.view.teamId) : null;
  const selectedMembers = selected ? data?.technicians.filter((t) => t.teamId === selected.view.teamId) ?? [] : [];
  const selectedPattern = selected ? data?.patterns.find((p) => p.id === selected.view.patternId) : null;
  const isOff = selected ? selected.view.status === "folga" || selected.view.status === "compensatoria" : false;

  const toggleOff = () => {
    if (!selected || !selectedPattern || selected.view.cycleDay === null) return;
    const daysOff = scheduleEngine.toggleOff(selectedPattern.daysOff, selected.view.teamId, selected.view.cycleDay);
    savePattern.mutate(
      {
        id: selectedPattern.id,
        sector: selectedPattern.sector,
        scaleType: selectedPattern.scaleType,
        name: selectedPattern.name,
        startDate: selectedPattern.startDate,
        cycleWeeks: selectedPattern.cycleWeeks,
        daysOff,
      },
      { onSuccess: () => setSelected(null) },
    );
  };

  const addAbsence = () => {
    if (!selected || !absenceTech) return;
    saveAbsence.mutate(
      {
        technicianId: Number(absenceTech),
        startDate: selected.date,
        endDate: selected.date,
        kind: absenceKind,
        notes: null,
      },
      { onSuccess: () => setSelected(null) },
    );
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Escala · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Cronograma mensal"
        title="Escala das equipes"
        description="Clique em qualquer célula para ver a dupla, registrar ausência ou mover a folga daquele dia do ciclo."
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.monthNav}>
          <Button variant="ghost" size="icon-md" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
            <ChevronLeft size={18} />
          </Button>
          <span className={styles.monthLabel}>{monthLabel}</span>
          <Button variant="ghost" size="icon-md" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
            <ChevronRight size={18} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(monthStart(today))}>
            Hoje
          </Button>
        </div>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="todos">Todos</ToggleGroupItem>
          <ToggleGroupItem value="suporte">Suporte</ToggleGroupItem>
          <ToggleGroupItem value="infraestrutura">Backbone</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={styles.gridWrap}>
        {!snapshot ? (
          <Skeleton className={styles.skel} />
        ) : (
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.stickyCol}>Equipe</th>
                {dates.map((d) => {
                  const wd = scheduleEngine.weekdayIndex(d);
                  const hol = data?.holidays.find((h) => h.date === d);
                  return (
                    <th
                      key={d}
                      title={hol ? `${hol.name}${hol.dayOff ? "" : " (expediente normal)"}` : undefined}
                      className={`${styles.dayHead} ${wd >= 5 ? styles.weekend : ""} ${d === today ? styles.todayHead : ""} ${hol ? styles.holidayHead : ""}`}
                    >
                      <span className={styles.wd}>{scheduleEngine.WEEKDAY_SHORT[wd].slice(0, 3)}</span>
                      <span className={styles.dn}>{d.slice(8)}</span>
                      {hol && <span className={styles.holMark}>{hol.dayOff ? "FER" : "PF"}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sectors.map((sector) => {
                const days = snapshot.bySector[sector];
                const teams = data!.teams.filter((t) => t.sector === sector);
                return (
                  <Fragment key={sector}>
                    <tr className={styles.sectorRow}>
                      <td className={`${styles.stickyCol} ${styles.sectorName} ${sector === "infraestrutura" ? styles.infra : styles.support}`}>
                        {labels.sector[sector]}
                      </td>
                      {days.map((d, i) => {
                        const prev = days[i - 1];
                        const changed = prev && prev.scaleType !== d.scaleType;
                        return (
                          <td key={d.date} className={styles.scaleMark}>
                            {(i === 0 || changed) && d.scaleType ? <span className={styles.scaleTag}>{d.scaleType}</span> : null}
                          </td>
                        );
                      })}
                    </tr>
                    {teams.map((team, ti) => {
                      const members = data!.technicians.filter((t) => t.teamId === team.id);
                      return (
                        <tr key={team.id}>
                          <td className={styles.stickyCol}>
                            <div className={styles.teamLabel}>
                              <span className={styles.code}>{team.code}</span>
                              <span className={styles.teamMembers}>{members.map((m) => m.name).join(" · ") || "—"}</span>
                            </div>
                          </td>
                          {days.map((d) => {
                            const view = d.teams[ti];
                            const wd = scheduleEngine.weekdayIndex(d.date);
                            return (
                              <td key={d.date} className={`${styles.cellTd} ${wd >= 5 ? styles.weekend : ""}`}>
                                <DayCell
                                  status={view.status}
                                  today={d.date === today}
                                  onClick={() => {
                                    setSelected({ sector, date: d.date, view });
                                    setAbsenceTech("");
                                  }}
                                  aria-label={`${team.code} ${d.date} ${labels.status[view.status]}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    <tr className={styles.coverageRow}>
                      <td className={styles.stickyCol}>Em campo / mín.</td>
                      {days.map((d) =>
                        d.scaleType ? (
                          <td key={d.date} className={`${styles.covTd} ${d.coverage < d.min ? styles.covBad : ""}`}>
                            {d.coverage}
                            <span className={styles.covMin}>/{d.min}</span>
                          </td>
                        ) : (
                          <td key={d.date} className={styles.covNone}>
                            –
                          </td>
                        ),
                      )}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.legend}>
        {(["trabalho", "plantao", "viagem", "folga", "folga_plantao", "feriado", "compensatoria", "desfalcada", "ausente", "sem_escala"] as const).map((s) => (
          <span key={s} className={styles.legendItem}>
            <DayCell status={s} tabIndex={-1} className={styles.legendCell} /> {labels.status[s]}
          </span>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected && selectedTeam && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedTeam.code} · {selectedTeam.name}
                </DialogTitle>
                <DialogDescription>
                  {scheduleEngine.WEEKDAY_LONG[scheduleEngine.weekdayIndex(selected.date)]}, {scheduleEngine.formatDate(selected.date)}
                </DialogDescription>
              </DialogHeader>
              <div className={styles.detail}>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Status</span>
                  <Badge variant={selected.view.status === "trabalho" ? "success" : selected.view.status === "desfalcada" ? "warning" : selected.view.status === "ausente" ? "destructive" : "outline"}>
                    {labels.status[selected.view.status]}
                  </Badge>
                </div>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Dupla</span>
                  <div className={styles.memberList}>
                    {selectedMembers.map((m) => {
                      const abs = scheduleEngine.isAbsent(data!.absences, m.id, selected.date);
                      return (
                        <div key={m.id}>
                          {m.name}
                          {abs && <span className={styles.absTag}> — {labels.absenceKind[abs.kind]}</span>}
                        </div>
                      );
                    })}
                    {selectedMembers.length === 0 && <span>Nenhum técnico na equipe</span>}
                  </div>
                </div>
                {selectedPattern && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Escala</span>
                    <span>
                      {selectedPattern.name} ({selectedPattern.scaleType}) · dia {(selected.view.cycleDay ?? 0) + 1} de{" "}
                      {selectedPattern.cycleWeeks * 7} do ciclo
                    </span>
                  </div>
                )}
                {selected.view.tripId !== null && (() => {
                  const trip = data!.trips.find((t) => t.id === selected.view.tripId);
                  if (!trip) return null;
                  return (
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Viagem</span>
                      <span>
                        {trip.destination}
                        {trip.reason ? ` — ${trip.reason}` : ""} · volta {scheduleEngine.formatDate(scheduleEngine.tripEnd(trip).slice(0, 10))}{" "}
                        {scheduleEngine.tripEnd(trip).slice(11)}. Ajuste em Viagens e diárias.
                      </span>
                    </div>
                  );
                })()}
                {selected.view.onCallId !== null && (() => {
                  const shift = data!.onCallShifts.find((s) => s.id === selected.view.onCallId);
                  if (!shift) return null;
                  const isCompDay = shift.compDates.includes(selected.date);
                  return (
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Plantão</span>
                      <span>
                        {isCompDay
                          ? `Folga de compensação do plantão de ${scheduleEngine.formatDate(shift.weekendStart)}.`
                          : `Plantão do fim de semana ${scheduleEngine.formatDate(shift.weekendStart)} — folga em ${shift.compDates.map(scheduleEngine.formatDate).join(" e ")}.`}{" "}
                        Ajuste em Plantões.
                      </span>
                    </div>
                  );
                })()}

                {selectedPattern && (
                  <div className={styles.actionBox}>
                    <div className={styles.actionTitle}>
                      <Repeat size={15} /> {isOff ? "Remover folga deste dia do ciclo" : "Marcar folga neste dia do ciclo"}
                    </div>
                    <p className={styles.hint}>
                      Altera o padrão da escala: a mudança se repete a cada {selectedPattern.cycleWeeks} semana(s).
                    </p>
                    <Button variant={isOff ? "outline" : "secondary"} onClick={toggleOff} disabled={savePattern.isPending}>
                      {isOff ? "Colocar equipe em campo" : "Dar folga à equipe"}
                    </Button>
                  </div>
                )}

                {selectedMembers.length > 0 && (
                  <div className={styles.actionBox}>
                    <div className={styles.actionTitle}>Registrar ausência só neste dia</div>
                    <div className={styles.inline}>
                      <Select value={absenceTech} onValueChange={setAbsenceTech}>
                        <SelectTrigger>
                          <SelectValue placeholder="Técnico" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedMembers.map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={absenceKind} onValueChange={(v) => setAbsenceKind(v as AbsenceKind)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(labels.absenceKind) as AbsenceKind[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {labels.absenceKind[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={addAbsence} disabled={!absenceTech || saveAbsence.isPending}>
                      Registrar
                    </Button>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
