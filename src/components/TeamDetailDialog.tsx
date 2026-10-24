import { Link } from "react-router-dom";
import { CalendarRange, CalendarOff, Car, Plane, UserRound } from "lucide-react";
import type { OutputType } from "../endpoints/data_GET.schema";
import type { TeamDayView } from "../helpers/buildScheduleSnapshot";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./Dialog";
import { Button } from "./Button";
import { DayCell } from "./DayCell";
import styles from "./TeamDetailDialog.module.css";

interface Props {
  data: OutputType;
  teamId: number | null;
  date: string;
  /** status da dupla a partir de `date` (o primeiro item é o dia selecionado) */
  days: { date: string; view: TeamDayView }[];
  onOpenChange: (open: boolean) => void;
}

/** Detalhes de uma dupla no dia escolhido do painel: quem está disponível, próximos dias, próxima folga e plantão. */
export const TeamDetailDialog = ({ data, teamId, date, days, onOpenChange }: Props) => {
  const team = data.teams.find((t) => t.id === teamId);
  const members = data.technicians.filter((t) => t.teamId === teamId);
  const current = days[0]?.view;
  const nextOff = days.slice(1).find((d) => ["folga", "folga_plantao", "compensatoria", "feriado"].includes(d.view.status));
  const nextOnCall = days.slice(1).find((d) => d.view.status === "plantao");
  const short = (d: string) => `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d)]} ${scheduleEngine.formatDate(d).slice(0, 5)}`;

  return (
    <Dialog open={teamId !== null} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog}>
        {team && current && (
          <>
            <DialogHeader>
              <div className={team.sector === "infraestrutura" ? styles.eyebrowInfra : styles.eyebrowSupport}>{labels.sector[team.sector]}</div>
              <DialogTitle className={styles.title}>
                <span className={styles.code}>{team.code}</span> {team.name}
              </DialogTitle>
              <DialogDescription>
                {short(date)} · <b>{labels.status[current.status]}</b>
                {team.vehicle && (
                  <span className={styles.vehicle}>
                    <Car size={14} /> {team.vehicle}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className={styles.members}>
              {members.map((m) => {
                const absence = scheduleEngine.isAbsent(data.absences, m.id, date);
                const trip = scheduleEngine.tripForTechnician(data.trips, m.id, date);
                const state = absence ? "absent" : trip ? "trip" : "ok";
                return (
                  <div key={m.id} className={`${styles.member} ${styles[state]}`}>
                    <span className={styles.avatar}>{trip ? <Plane size={16} /> : <UserRound size={16} />}</span>
                    <div>
                      <div className={styles.memberName}>{m.name}</div>
                      <div className={styles.memberMeta}>
                        {absence
                          ? `${labels.absenceKind[absence.kind]} até ${scheduleEngine.formatDate(absence.endDate).slice(0, 5)}`
                          : trip
                            ? `Em viagem · ${trip.destination} · volta ${scheduleEngine.formatDate(scheduleEngine.tripEnd(trip).slice(0, 10)).slice(0, 5)} ${scheduleEngine.tripEnd(trip).slice(11)}`
                            : [m.role, m.phone].filter(Boolean).join(" · ") || "Disponível"}
                      </div>
                    </div>
                  </div>
                );
              })}
              {members.length === 0 && <p className={styles.empty}>Nenhum técnico nesta dupla.</p>}
            </div>

            <div className={styles.micro}>Próximos 14 dias</div>
            <div className={styles.strip}>
              {days.slice(0, 14).map((d) => (
                <div key={d.date} className={styles.stripDay}>
                  <span>{scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d.date)].slice(0, 1)}</span>
                  <DayCell status={d.view.status} tabIndex={-1} title={labels.status[d.view.status]} className={styles.stripCell} />
                  <span>{d.date.slice(8)}</span>
                </div>
              ))}
            </div>

            <div className={styles.facts}>
              <div>
                <div className={styles.micro}>Próxima folga</div>
                <b>{nextOff ? `${short(nextOff.date)} · ${labels.status[nextOff.view.status]}` : "—"}</b>
              </div>
              <div>
                <div className={styles.micro}>Próximo plantão</div>
                <b>{nextOnCall ? short(nextOnCall.date) : "nos próximos 14 dias, nenhum"}</b>
              </div>
            </div>

            <div className={styles.actions}>
              <Button asChild variant="outline" size="sm">
                <Link to="/ausencias">
                  <CalendarOff size={15} /> Registrar ausência
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/escala">
                  <CalendarRange size={15} /> Ver na escala
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
