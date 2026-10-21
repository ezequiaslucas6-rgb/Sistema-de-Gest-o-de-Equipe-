import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet";
import { AlertTriangle, ArrowRight, CalendarClock, Lightbulb, ShieldAlert, Siren } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DayCell } from "../components/DayCell";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/Tooltip";
import { useAppData } from "../helpers/useAppData";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { buildScheduleSnapshot } from "../helpers/buildScheduleSnapshot";
import { labels } from "../helpers/labels";
import styles from "./_index.module.css";

const HORIZON = 30;

export default function DashboardPage() {
  const { data, isFetching, error } = useAppData();
  const today = scheduleEngine.todayIso();

  const snapshot = useMemo(() => (data ? buildScheduleSnapshot(data, today, HORIZON) : null), [data, today]);

  const techName = useMemo(() => new Map(data?.technicians.map((t) => [t.id, t.name]) ?? []), [data]);
  const teamsById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);

  const upcomingChanges = useMemo(() => {
    if (!data) return [];
    return data.patterns
      .filter((p) => p.startDate > today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((p) => ({ ...p, daysLeft: scheduleEngine.diffDays(p.startDate, today) }));
  }, [data, today]);

  const todayLabel = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Painel · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow={todayLabel}
        title="Painel de cobertura"
        description="Quem está em campo hoje, cobertura dos próximos 14 dias e alertas de escala para os dois setores."
        actions={
          <Button asChild variant="outline">
            <Link to="/planejamento">
              Planejar 5x2 <ArrowRight size={16} />
            </Link>
          </Button>
        }
      />

      {upcomingChanges.length > 0 && (
        <div className={styles.transition}>
          <CalendarClock size={18} />
          <div>
            {upcomingChanges.map((p) => (
              <div key={p.id}>
                <strong>{labels.sector[p.sector]}</strong> muda para <strong>{p.scaleType}</strong> em{" "}
                <span className={styles.mono}>{scheduleEngine.formatDate(p.startDate)}</span> — faltam{" "}
                <span className={styles.mono}>{p.daysLeft}</span> dias ({p.name}).
              </div>
            ))}
          </div>
        </div>
      )}

      <section className={styles.sectors}>
        {data && (() => {
          const wd = scheduleEngine.weekdayIndex(today);
          const sat = scheduleEngine.addDays(today, 5 - wd);
          const shifts = data.onCallShifts.filter((s) => s.weekendStart === sat);
          const comp = data.onCallShifts.filter((s) => s.weekendStart === scheduleEngine.addDays(sat, -7));
          return (
            <div className={styles.oncall}>
              <Siren size={18} />
              <div className={styles.oncallBody}>
                <div className={styles.micro}>
                  Plantão {scheduleEngine.formatDate(sat).slice(0, 5)} – {scheduleEngine.formatDate(scheduleEngine.addDays(sat, 1)).slice(0, 5)}
                </div>
                <div>
                  {shifts.length === 0 && <span>Nenhuma dupla escalada — defina em Plantões.</span>}
                  {shifts.map((s) => {
                    const team = teamsById.get(s.teamId);
                    const names = data.technicians.filter((t) => t.teamId === s.teamId).map((t) => t.name).join(" + ");
                    return (
                      <span key={s.id} className={styles.oncallItem}>
                        <b>{team?.code}</b> {names} <span className={styles.oncallSector}>({team ? labels.sectorShort[team.sector] : ""})</span>
                      </span>
                    );
                  })}
                </div>
                {comp.length > 0 && (
                  <div className={styles.oncallComp}>
                    De folga nesta semana compensando o plantão anterior: {comp.map((c) => teamsById.get(c.teamId)?.code).join(", ")}
                  </div>
                )}
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/plantao">Plantões</Link>
              </Button>
            </div>
          );
        })()}
        {labels.sectors.map((sector) => {
          const todayView = snapshot?.bySector[sector][0];
          const ok = todayView ? todayView.coverage >= todayView.min : true;
          return (
            <div key={sector} className={`${styles.sectorCard} ${sector === "infraestrutura" ? styles.infra : styles.support}`}>
              <div className={styles.sectorHead}>
                <div>
                  <div className={styles.micro}>{labels.sector[sector]}</div>
                  {todayView ? (
                    <div className={styles.bigNumber}>
                      {todayView.coverage}
                      <span className={styles.bigOf}>/{todayView.teams.length} duplas em campo</span>
                    </div>
                  ) : (
                    <Skeleton className={styles.skelBig} />
                  )}
                </div>
                {todayView && (
                  <div className={styles.sectorMeta}>
                    <Badge variant={ok ? "success" : "destructive"}>
                      {ok ? "Cobertura OK" : "Abaixo do mínimo"} · mín {todayView.min}
                    </Badge>
                    <span className={styles.scale}>Escala {todayView.scaleType ?? "—"}</span>
                  </div>
                )}
              </div>

              <div className={styles.teamList}>
                {!todayView &&
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className={styles.skelRow} />)}
                {todayView?.teams.map((tv) => {
                  const team = teamsById.get(tv.teamId);
                  const members = data!.technicians.filter((t) => t.teamId === tv.teamId);
                  return (
                    <div key={tv.teamId} className={styles.teamRow}>
                      <DayCell status={tv.status} tabIndex={-1} className={styles.teamCell} />
                      <div className={styles.teamInfo}>
                        <div className={styles.teamName}>
                          <span className={styles.code}>{team?.code}</span> {team?.name}
                        </div>
                        <div className={styles.members}>
                          {members.map((m) => (
                            <span key={m.id} className={tv.absentMemberIds.includes(m.id) ? styles.absent : ""}>
                              {m.name}
                            </span>
                          ))}
                          {members.length === 0 && <span className={styles.absent}>sem técnicos</span>}
                        </div>
                      </div>
                      <span className={styles.statusText}>{labels.status[tv.status]}</span>
                    </div>
                  );
                })}
              </div>

              <div className={styles.micro}>Próximos 14 dias</div>
              <div className={styles.strip}>
                {snapshot?.bySector[sector].slice(0, 14).map((d) => {
                  const below = d.coverage < d.min;
                  const wd = scheduleEngine.weekdayIndex(d.date);
                  return (
                    <Tooltip key={d.date}>
                      <TooltipTrigger asChild>
                        <div className={`${styles.stripDay} ${below ? styles.below : ""} ${wd >= 5 ? styles.weekendDay : ""}`}>
                          <span className={styles.stripWd}>{scheduleEngine.WEEKDAY_SHORT[wd].slice(0, 1)}</span>
                          <span className={styles.stripNum}>{d.coverage}</span>
                          <span className={styles.stripDate}>{d.date.slice(8)}</span>
                          {d.partial > 0 && <span className={styles.partialDot} />}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {scheduleEngine.formatDate(d.date)} · {d.coverage} em campo (mín {d.min})
                        {d.partial > 0 ? ` · ${d.partial} desfalcada(s)` : ""}
                        {d.holiday ? ` · ${d.holiday.name}` : ""}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {!snapshot && <Skeleton className={styles.skelStrip} />}
              </div>
            </div>
          );
        })}
      </section>

      <section className={styles.lower}>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>
            <ShieldAlert size={18} /> Alertas — próximos {HORIZON} dias
          </h2>
          {isFetching && !snapshot && <Skeleton className={styles.skelRow} />}
          {snapshot && snapshot.alerts.length === 0 && (
            <p className={styles.empty}>Nenhum alerta. Cobertura mínima garantida em todos os dias.</p>
          )}
          <ul className={styles.alertList}>
            {snapshot?.alerts.slice(0, 40).map((a, i) => (
              <li key={i} className={styles.alertItem}>
                <AlertTriangle size={15} className={a.severity === "critico" ? styles.crit : styles.warn} />
                <span className={styles.alertDate}>
                  {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(a.date)]} {a.date.slice(8)}/{a.date.slice(5, 7)}
                  {a.endDate !== a.date && ` → ${a.endDate.slice(8)}/${a.endDate.slice(5, 7)}`}
                </span>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.panel}>
          <h2 className={styles.panelTitle}>
            <Lightbulb size={18} /> Sugestões inteligentes
          </h2>
          {snapshot && (
            <ul className={styles.alertList}>
              {labels.sectors.flatMap((s) =>
                snapshot.bySector[s]
                  .filter((d) => d.suggestions.length > 0)
                  .flatMap((d) =>
                    d.suggestions.map((sug, i) => (
                      <li key={`${s}-${d.date}-${i}`} className={styles.alertItem}>
                        <span className={styles.alertDate}>
                          {d.date.slice(8)}/{d.date.slice(5, 7)}
                        </span>
                        <span>
                          <strong>{labels.sectorShort[s]}:</strong> {sug}
                        </span>
                      </li>
                    )),
                  ),
              )}
            </ul>
          )}
          {snapshot &&
            labels.sectors.every((s) => snapshot.bySector[s].every((d) => d.suggestions.length === 0)) && (
              <p className={styles.empty}>
                Sem remanejamentos necessários. Quando houver desfalques ou cobertura abaixo do mínimo, o sistema sugere
                duplas temporárias e trocas de folga aqui.
              </p>
            )}
          <div className={styles.legend}>
            {(["trabalho", "plantao", "folga", "folga_plantao", "feriado", "compensatoria", "desfalcada", "ausente"] as const).map((s) => (
              <span key={s} className={styles.legendItem}>
                <DayCell status={s} tabIndex={-1} className={styles.legendCell} /> {labels.status[s]}
              </span>
            ))}
          </div>
          {techName.size === 0 && data && <p className={styles.empty}>Cadastre técnicos em “Equipes e duplas”.</p>}
        </div>
      </section>
    </div>
  );
}
