import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet";
import {
  AlertTriangle, ArrowRight, CalendarClock, ChevronLeft, ChevronRight, Lightbulb, LockKeyhole, Monitor, Plane,
  PartyPopper, Repeat, Search, Siren, UserX, Users, Wallet,
} from "lucide-react";
import { DayCell } from "../components/DayCell";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/Tooltip";
import { TeamDetailDialog } from "../components/TeamDetailDialog";
import { AlertActions } from "../components/AlertActions";
import { useAppMutations } from "../helpers/useAppMutations";
import { useAppData } from "../helpers/useAppData";
import { useCountUp, useNow } from "../helpers/useLive";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { alertKey, buildScheduleSnapshot, type Alert } from "../helpers/buildScheduleSnapshot";
import { buildEvents, DashEvent, EventKind, liveStatus, longDate, relativeDay, weekendOf } from "../helpers/dashboardData";
import { labels } from "../helpers/labels";
import { LOCKER_COUNT } from "../helpers/api";
import styles from "./_index.module.css";

/** dias anteriores a hoje que o painel permite consultar */
const PAST = 7;
const HORIZON = 30;
const FIELD = new Set(["trabalho", "plantao", "desfalcada"]);

type SectorFilter = "todos" | Sector;
type AlertTab = "critico" | "atencao" | "sugestoes";

const EVENT_ICON: Record<EventKind, typeof Siren> = {
  plantao: Siren,
  feriado: PartyPopper,
  viagem: Plane,
  retorno: Plane,
  ausencia: UserX,
  compensacao: Repeat,
  escala: CalendarClock,
};

const Count = ({ value, money }: { value: number; money?: boolean }) => {
  const v = useCountUp(value);
  return <>{money ? scheduleEngine.formatMoney(v) : Math.round(v)}</>;
};

export default function DashboardPage() {
  const { data, error } = useAppData();
  const navigate = useNavigate();
  const now = useNow(15_000);
  const today = scheduleEngine.todayIso();
  const base = scheduleEngine.addDays(today, -PAST);
  const maxDate = scheduleEngine.addDays(today, HORIZON - 1);

  const [selected, setSelected] = useState(today);
  const [filter, setFilter] = useState<SectorFilter>("todos");
  const [range, setRange] = useState<14 | 30>(14);
  const [tab, setTab] = useState<AlertTab>("critico");
  const [detailTeam, setDetailTeam] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const go = useCallback(
    (date: string) => setSelected(date < base ? base : date > maxDate ? maxDate : date),
    [base, maxDate],
  );

  // ← → navegam entre os dias (fora de campos de texto e diálogos)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [role=dialog], [role=listbox]")) return;
      if (e.key === "ArrowLeft") go(scheduleEngine.addDays(selected, -1));
      else if (e.key === "ArrowRight") go(scheduleEngine.addDays(selected, 1));
      else if (e.key.toLowerCase() === "h") go(today);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, go, today]);

  const snapshot = useMemo(() => (data ? buildScheduleSnapshot(data, base, PAST + HORIZON) : null), [data, base]);
  const sectors: Sector[] = filter === "todos" ? labels.sectors : [filter];
  const idx = scheduleEngine.diffDays(selected, base);
  const teamsById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);

  const day = useMemo(() => {
    if (!data || !snapshot) return null;
    const views = sectors.map((s) => snapshot.bySector[s][idx]);
    const teamIds = new Set(data.teams.filter((t) => sectors.includes(t.sector)).map((t) => t.id));
    const techs = data.technicians.filter((t) => t.teamId !== null && teamIds.has(t.teamId));
    const allTeams = views.flatMap((v) => v.teams);
    const sat = weekendOf(selected);
    return {
      views,
      pairs: views.reduce((s, v) => s + v.coverage, 0),
      pairsTotal: views.reduce((s, v) => s + v.teams.length, 0),
      min: views.reduce((s, v) => s + v.min, 0),
      techField: allTeams.filter((t) => FIELD.has(t.status)).reduce((s, t) => s + t.availableMemberIds.length, 0),
      techTotal: techs.length,
      absent: techs
        .map((t) => ({ t, a: scheduleEngine.isAbsent(data.absences, t.id, selected) }))
        .filter((x) => x.a),
      travel: techs
        .map((t) => ({ t, trip: scheduleEngine.tripForTechnician(data.trips, t.id, selected) }))
        .filter((x) => x.trip),
      sat,
      onCall: data.onCallShifts.filter((s) => s.weekendStart === sat && teamIds.has(s.teamId)),
      holiday: views[0]?.holiday ?? null,
    };
  }, [data, snapshot, idx, selected, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const { saveIgnoredAlerts } = useAppMutations();
  const [showIgnored, setShowIgnored] = useState(false);
  const ignoredKeys = useMemo(() => new Set(data?.ignoredAlerts ?? []), [data]);
  const allAlerts = useMemo(
    () => (snapshot ? snapshot.alerts.filter((a) => a.endDate >= today && sectors.includes(a.sector)) : []),
    [snapshot, today, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const alerts = useMemo(() => allAlerts.filter((a) => showIgnored || !ignoredKeys.has(alertKey(a))), [allAlerts, ignoredKeys, showIgnored]);
  const ignoredCount = allAlerts.filter((a) => ignoredKeys.has(alertKey(a))).length;
  const toggleIgnore = (a: Alert) => {
    const k = alertKey(a);
    const keys = ignoredKeys.has(k) ? [...ignoredKeys].filter((x) => x !== k) : [...ignoredKeys, k];
    // limpa chaves de alertas que já passaram
    saveIgnoredAlerts.mutate({ keys: keys.filter((x) => (x.split("|")[1] ?? "") >= scheduleEngine.addDays(today, -40)) });
  };
  const suggestions = useMemo(() => {
    if (!snapshot) return [];
    return sectors.flatMap((s) =>
      snapshot.bySector[s].filter((d) => d.date >= today).flatMap((d) => d.suggestions.map((text) => ({ date: d.date, sector: s, text }))),
    ).sort((a, b) => a.date.localeCompare(b.date));
  }, [snapshot, today, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(
    () => (data ? buildEvents(data, today, 14).filter((e) => e.sectors.length === 0 || e.sectors.some((s) => sectors.includes(s))) : []),
    [data, today, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const live = data ? liveStatus(now, data) : null;

  const chartStart = selected < today ? base : today;
  const chartIdx0 = scheduleEngine.diffDays(chartStart, base);
  const chartDays = snapshot
    ? Array.from({ length: Math.min(range, PAST + HORIZON - chartIdx0) }, (_, i) => {
        const per = labels.sectors.map((s) => ({ s, v: snapshot.bySector[s][chartIdx0 + i] }));
        return { date: per[0].v.date, per, min: per.filter((p) => sectors.includes(p.s)).reduce((a, p) => a + p.v.min, 0) };
      })
    : [];
  const chartMax = Math.max(1, ...chartDays.map((d) => d.per.reduce((a, p) => a + (sectors.includes(p.s) ? Math.max(p.v.teams.length, p.v.min) : 0), 0)));

  const monthTrips = data?.trips.filter((t) => t.departAt.slice(0, 7) === today.slice(0, 7)) ?? [];
  const monthValue = data ? monthTrips.reduce((s, t) => s + scheduleEngine.tripAllowance(t, data.tripSettings).total, 0) : 0;
  const pendingTrips = data?.trips.filter((t) => t.status === "retornou" || t.status === "prestacao").length ?? 0;
  const transitions = data?.patterns.filter((p) => p.startDate > today && sectors.includes(p.sector)).sort((a, b) => a.startDate.localeCompare(b.startDate)) ?? [];

  const oc = data?.settings.find((x) => x.sector === "suporte") ?? data?.settings[0];
  const hrs = (r: string) => r.replace(/-/g, "–").replace(/,/g, ", ");
  const onCallHours = oc ? `Sáb ${hrs(oc.onCallSaturday)} · Dom ${hrs(oc.onCallSunday)}` : "";

  const q = search.trim().toLowerCase();
  const matchTeam = (teamId: number) =>
    !q ||
    (teamsById.get(teamId)?.code.toLowerCase().includes(q) ?? false) ||
    (teamsById.get(teamId)?.name.toLowerCase().includes(q) ?? false) ||
    (data?.technicians.some((t) => t.teamId === teamId && t.name.toLowerCase().includes(q)) ?? false);

  const detailDays =
    detailTeam !== null && snapshot && teamsById.get(detailTeam)
      ? snapshot.bySector[teamsById.get(detailTeam)!.sector]
          .slice(idx, idx + 14)
          .map((d) => ({ date: d.date, view: d.teams.find((t) => t.teamId === detailTeam)! }))
          .filter((d) => d.view)
      : [];

  const pickDate = (date: string) => {
    go(date);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  const criticos = alerts.filter((a) => a.severity === "critico");
  const atencao = alerts.filter((a) => a.severity === "atencao");
  const coveragePct = day && day.pairsTotal ? day.pairs / day.pairsTotal : 0;
  const ok = day ? day.pairs >= day.min : true;
  const clock = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Painel · Escala Técnica</title>
      </Helmet>

      <header className={styles.top}>
        <div>
          <div className={styles.micro}>
            {longDate(today)} · {clock}
          </div>
          <h1 className={styles.h1}>Centro de operações</h1>
          <p className={styles.lead}>Cobertura, plantões, viagens e alertas dos dois setores em tempo real.</p>
        </div>
        <div className={styles.topActions}>
          {live && (
            <span className={`${styles.livePill} ${styles[`live_${live.kind}`]}`}>
              <span className={styles.liveDot} />
              {live.title}
              {live.range ? ` · ${live.detail}` : ""}
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => {
              document.documentElement.requestFullscreen?.().catch(() => undefined);
              navigate("/tv");
            }}
          >
            <Monitor size={16} /> Modo TV
          </Button>
          <Button asChild className={styles.gradBtn}>
            <Link to="/planejamento">
              Planejar 5x2 <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.dayNav}>
          <button className={styles.arrow} onClick={() => go(scheduleEngine.addDays(selected, -1))} disabled={selected <= base} aria-label="Dia anterior">
            <ChevronLeft size={16} />
          </button>
          <div className={styles.dayLabel} key={selected}>
            <span>
              {scheduleEngine.WEEKDAY_LONG[scheduleEngine.weekdayIndex(selected)]}, {scheduleEngine.formatDate(selected).slice(0, 5)}
            </span>
            <small className={selected === today ? styles.isToday : ""}>
              {relativeDay(selected, today)}
              {day?.holiday ? ` · ${day.holiday.name}` : ""}
            </small>
          </div>
          <button className={styles.arrow} onClick={() => go(scheduleEngine.addDays(selected, 1))} disabled={selected >= maxDate} aria-label="Próximo dia">
            <ChevronRight size={16} />
          </button>
          <Button variant="outline" size="sm" onClick={() => go(today)} disabled={selected === today}>
            Hoje
          </Button>
          <span className={styles.hint}>← → navegam · H volta para hoje</span>
        </div>
        <div className={styles.seg} role="tablist" aria-label="Setor">
          {(["todos", ...labels.sectors] as SectorFilter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? styles.segOn : ""} onClick={() => setFilter(f)}>
              {f === "todos" ? "Todos" : labels.sectorShort[f]}
            </button>
          ))}
        </div>
      </div>

      <section className={styles.kpis}>
        <div className={`${styles.kpi} ${styles.kpiDonut}`} style={{ ["--i" as string]: 0 }}>
          <div className={styles.micro}>Duplas em campo</div>
          {day ? (
            <>
              <b className={styles.kpiNum}>
                <Count value={day.pairs} />
                <small>/{day.pairsTotal}</small>
              </b>
              <div className={ok ? styles.kpiOk : styles.kpiBad}>
                mínimo {day.min} · {ok ? "cobertura OK" : "abaixo do mínimo"}
              </div>
              <svg className={styles.donut} viewBox="0 0 44 44" aria-hidden>
                <circle cx="22" cy="22" r="18" className={styles.donutTrack} />
                <circle cx="22" cy="22" r="18" className={styles.donutVal} style={{ strokeDasharray: `${coveragePct * 113.1} 113.1` }} />
              </svg>
            </>
          ) : (
            <Skeleton className={styles.skelKpi} />
          )}
        </div>
        <div className={styles.kpi} style={{ ["--i" as string]: 1 }}>
          <div className={styles.micro}>Técnicos em campo</div>
          {day ? (
            <>
              <b className={styles.kpiNum}>
                <Count value={day.techField} />
                <small>/{day.techTotal}</small>
              </b>
              <div className={styles.meter}>
                <i style={{ width: `${day.techTotal ? (day.techField / day.techTotal) * 100 : 0}%` }} />
              </div>
              <div className={styles.kpiSub}>{day.techTotal - day.techField} fora de campo</div>
            </>
          ) : (
            <Skeleton className={styles.skelKpi} />
          )}
        </div>
        <Link to="/motor" className={styles.kpi} style={{ ["--i" as string]: 2 }}>
          <div className={styles.micro}>
            Plantão {scheduleEngine.formatDate(day?.sat ?? today).slice(0, 5)}–{scheduleEngine.formatDate(scheduleEngine.addDays(day?.sat ?? today, 1)).slice(0, 5)}
          </div>
          <b className={styles.kpiText}>{day && day.onCall.length ? day.onCall.map((s) => teamsById.get(s.teamId)?.code).join(" · ") : "—"}</b>
          <div className={styles.kpiSub}>{day && day.onCall.length ? onCallHours : "nenhuma dupla escalada"}</div>
        </Link>
        <Link to="/viagens" className={styles.kpi} style={{ ["--i" as string]: 3 }}>
          <div className={styles.micro}>Em viagem</div>
          <b className={styles.kpiNum}>
            <Count value={day?.travel.length ?? 0} />
          </b>
          <div className={styles.kpiSub}>
            {day && day.travel.length
              ? [...new Set(day.travel.map((x) => x.trip!.destination))].join(", ")
              : "ninguém fora da base"}
          </div>
        </Link>
        <Link to="/ausencias" className={styles.kpi} style={{ ["--i" as string]: 4 }}>
          <div className={styles.micro}>Ausências</div>
          <b className={styles.kpiNum}>
            <Count value={day?.absent.length ?? 0} />
          </b>
          <div className={styles.kpiSub}>
            {day && day.absent.length
              ? day.absent.map((x) => `${x.t.name} (${labels.absenceKind[x.a!.kind].toLowerCase()})`).join(", ")
              : "ninguém de férias ou atestado"}
          </div>
        </Link>
        <button
          className={styles.kpi}
          style={{ ["--i" as string]: 5 }}
          onClick={() => document.getElementById("alertas")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <div className={styles.micro}>Alertas · {HORIZON} dias</div>
          <b className={`${styles.kpiNum} ${criticos.length ? styles.critText : ""}`}>
            <Count value={alerts.length} />
          </b>
          <div className={styles.kpiSub}>
            <span className={styles.critText}>{criticos.length} crítico(s)</span> · <span className={styles.warnText}>{atencao.length} atenção</span>
          </div>
        </button>
      </section>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.h2}>Cobertura {selected < today ? "do período" : "dos próximos dias"}</h2>
              <div className={styles.cardTools}>
                <div className={styles.legend}>
                  {sectors.includes("suporte") && (
                    <span>
                      <i className={styles.lgSupport} /> Suporte
                    </span>
                  )}
                  {sectors.includes("infraestrutura") && (
                    <span>
                      <i className={styles.lgInfra} /> Backbone
                    </span>
                  )}
                  <span>
                    <i className={styles.lgPartial} /> Desfalcada
                  </span>
                  <span>
                    <i className={styles.lgMin} /> Mínimo
                  </span>
                </div>
                <div className={styles.seg}>
                  {([14, 30] as const).map((r) => (
                    <button key={r} className={range === r ? styles.segOn : ""} onClick={() => setRange(r)}>
                      {r} dias
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {!snapshot ? (
              <Skeleton className={styles.skelChart} />
            ) : (
              <>
                <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${chartDays.length}, 1fr)` }}>
                  {chartDays.map((d) => {
                    const wd = scheduleEngine.weekdayIndex(d.date);
                    const fieldSum = d.per.filter((p) => sectors.includes(p.s)).reduce((a, p) => a + p.v.coverage, 0);
                    const below = fieldSum < d.min;
                    return (
                      <Tooltip key={d.date}>
                        <TooltipTrigger asChild>
                          <button
                            className={`${styles.col} ${d.date === selected ? styles.colSel : ""} ${wd >= 5 ? styles.colWk : ""} ${below ? styles.colBad : ""}`}
                            onClick={() => go(d.date)}
                            aria-label={`${scheduleEngine.formatDate(d.date)}: ${fieldSum} duplas em campo`}
                          >
                            {d.per
                              .filter((p) => sectors.includes(p.s))
                              .slice()
                              .reverse()
                              .map((p) => (
                                <Fragment key={p.s}>
                                  {p.v.partial > 0 && (
                                    <span className={styles.segPartial} style={{ height: `${(p.v.partial / chartMax) * 100}%` }} />
                                  )}
                                  <span
                                    className={p.s === "suporte" ? styles.segSupport : styles.segInfra}
                                    style={{ height: `${(p.v.coverage / chartMax) * 100}%` }}
                                  />
                                </Fragment>
                              ))}
                            {d.min > 0 && <span className={styles.minLine} style={{ bottom: `${(d.min / chartMax) * 100}%` }} />}
                            {d.per[0].v.holiday && <span className={styles.holidayMark}>FE</span>}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <b>
                            {scheduleEngine.WEEKDAY_SHORT[wd]} {scheduleEngine.formatDate(d.date)}
                          </b>
                          {d.per
                            .filter((p) => sectors.includes(p.s))
                            .map((p) => (
                              <div key={p.s}>
                                {labels.sectorShort[p.s]}: {p.v.coverage}/{p.v.teams.length} em campo (mín {p.v.min})
                                {p.v.partial ? ` · ${p.v.partial} desfalcada` : ""}
                              </div>
                            ))}
                          {d.per[0].v.holiday && <div>Feriado: {d.per[0].v.holiday.name}</div>}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
                <div className={styles.axis} style={{ gridTemplateColumns: `repeat(${chartDays.length}, 1fr)` }}>
                  {chartDays.map((d) => (
                    <span key={d.date} className={`${d.date === selected ? styles.axisSel : ""} ${d.date === today ? styles.axisToday : ""}`}>
                      {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d.date)].slice(0, 1)}
                      <br />
                      {d.date.slice(8)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <div className={styles.boardHead}>
            <h2 className={styles.h2}>Duplas · {scheduleEngine.formatDate(selected).slice(0, 5)}</h2>
            <label className={styles.search}>
              <Search size={15} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar técnico ou dupla" />
            </label>
          </div>
          <section className={`${styles.board} ${sectors.length === 1 ? styles.boardOne : ""}`}>
            {sectors.map((sector) => {
              const v = day?.views.find((x) => x.sector === sector);
              const sok = v ? v.coverage >= v.min : true;
              return (
                <div key={sector} className={`${styles.card} ${styles.sector} ${sector === "infraestrutura" ? styles.infra : styles.support}`}>
                  <div className={styles.sectorHead}>
                    <div>
                      <div className={styles.micro}>{labels.sector[sector]}</div>
                      <div className={styles.sectorCount}>
                        {v ? (
                          <>
                            <b>{v.coverage}</b>/{v.teams.length} duplas em campo
                          </>
                        ) : (
                          "…"
                        )}
                      </div>
                    </div>
                    {v && (
                      <span className={`${styles.badge} ${sok ? styles.badgeOk : styles.badgeBad}`}>
                        {sok ? "Cobertura OK" : "Abaixo do mínimo"} · mín {v.min}
                      </span>
                    )}
                  </div>
                  {!v && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className={styles.skelRow} />)}
                  {v?.teams.map((tv) => {
                    const team = teamsById.get(tv.teamId);
                    const members = data!.technicians.filter((t) => t.teamId === tv.teamId);
                    const next = snapshot!.bySector[sector].slice(idx, idx + 7);
                    const hit = matchTeam(tv.teamId);
                    return (
                      <button
                        key={tv.teamId}
                        className={`${styles.team} ${q && hit ? styles.teamHit : ""} ${q && !hit ? styles.teamDim : ""}`}
                        onClick={() => setDetailTeam(tv.teamId)}
                      >
                        <DayCell status={tv.status} tabIndex={-1} className={styles.teamCell} />
                        <span className={styles.teamInfo}>
                          <span className={styles.teamName}>
                            <code>{team?.code}</code> {team?.name}
                          </span>
                          <span className={styles.members}>
                            {members.map((m) => {
                              const away = tv.absentMemberIds.includes(m.id);
                              const onTrip = away && tv.tripId !== null && scheduleEngine.tripForTechnician(data!.trips, m.id, selected);
                              return (
                                <span key={m.id} className={onTrip ? styles.mTrip : away ? styles.mAway : styles.mOk}>
                                  {onTrip ? <Plane size={11} /> : <i />}
                                  {m.name}
                                </span>
                              );
                            })}
                            {members.length === 0 && <span className={styles.mAway}>sem técnicos</span>}
                          </span>
                        </span>
                        <span className={styles.teamRight}>
                          <span className={styles.statusText}>{labels.status[tv.status]}</span>
                          <span className={styles.mini}>
                            {next.map((d) => {
                              const st = d.teams.find((t) => t.teamId === tv.teamId)?.status ?? "sem_escala";
                              return <DayCell key={d.date} status={st} tabIndex={-1} className={styles.miniCell} title={`${scheduleEngine.formatDate(d.date).slice(0, 5)} · ${labels.status[st]}`} />;
                            })}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </section>
          <div className={styles.legendRow}>
            {(["trabalho", "plantao", "viagem", "folga", "folga_plantao", "feriado", "compensatoria", "desfalcada", "ausente"] as const).map((s) => (
              <span key={s}>
                <DayCell status={s} tabIndex={-1} className={styles.legendCell} /> {labels.status[s]}
              </span>
            ))}
          </div>
        </div>

        <aside className={styles.sideCol}>
          <section className={styles.now}>
            <div className={styles.nowMicro}>Agora · ao vivo</div>
            <div className={styles.nowClock}>{clock}</div>
            <div className={styles.nowTitle}>{live?.title ?? "…"}</div>
            {live?.progress != null && (
              <div className={styles.nowProg}>
                <i style={{ width: `${Math.round(live.progress * 100)}%` }} />
              </div>
            )}
            <div className={styles.nowDetail}>
              {live?.detail}
              {live?.kind === "plantao" && snapshot && (() => {
                const todayIdx = scheduleEngine.diffDays(today, base);
                const oc = labels.sectors.flatMap((s) => snapshot.bySector[s][todayIdx].teams.filter((t) => t.status === "plantao"));
                return oc.length ? ` · ${oc.map((t) => teamsById.get(t.teamId)?.code).join(" + ")}` : "";
              })()}
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>Próximos eventos</h2>
            {events.length === 0 && <p className={styles.empty}>Nada programado nos próximos 14 dias.</p>}
            <ul className={styles.timeline}>
              {events.slice(0, 9).map((e: DashEvent, i) => {
                const Icon = EVENT_ICON[e.kind];
                return (
                  <li key={i} className={`${styles.ev} ${styles[`ev_${e.kind}`]}`}>
                    <button onClick={() => pickDate(e.date)}>
                      <span className={styles.evIcon}>
                        <Icon size={13} />
                      </span>
                      <span>
                        <small>
                          {e.date === today ? "hoje" : `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(e.date)]} ${e.date.slice(8)}/${e.date.slice(5, 7)}`}
                          {e.time ? ` · ${e.time}` : ""}
                        </small>
                        {e.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {events.length > 9 && <div className={styles.more}>+ {events.length - 9} eventos nos próximos 14 dias</div>}
          </section>

          {transitions.map((p) => {
            const left = scheduleEngine.diffDays(p.startDate, today);
            return (
              <Link key={p.id} to="/planejamento" className={`${styles.card} ${styles.transition}`}>
                <div className={styles.micro}>Transição {labels.sectorShort[p.sector]} → {p.scaleType}</div>
                <div>
                  <b className={styles.bigDays}>{left}</b> dias · {scheduleEngine.formatDate(p.startDate)}
                </div>
                <div className={styles.meter}>
                  <i style={{ width: `${Math.max(4, 100 - (left / 90) * 100)}%` }} />
                </div>
              </Link>
            );
          })}

          <section className={`${styles.card} ${styles.mini2}`}>
            <Link to="/armarios" className={styles.miniLink}>
              <span className={styles.micro}>
                <LockKeyhole size={12} /> Armários
              </span>
              <span className={styles.miniRow}>
                <b>{data?.lockers.length ?? 0} ocupados</b>
                <span>{LOCKER_COUNT - (data?.lockers.length ?? 0)} livres de {LOCKER_COUNT}</span>
              </span>
              <span className={styles.meter}>
                <i style={{ width: `${((data?.lockers.length ?? 0) / LOCKER_COUNT) * 100}%` }} />
              </span>
            </Link>
            <Link to="/viagens" className={styles.miniLink}>
              <span className={styles.micro}>
                <Wallet size={12} /> Diárias do mês
              </span>
              <span className={styles.miniRow}>
                <b>
                  <Count value={monthValue} money />
                </b>
                {pendingTrips > 0 ? <span className={styles.warnText}>{pendingTrips} a acertar</span> : <span>tudo acertado</span>}
              </span>
            </Link>
            <Link to="/equipes" className={styles.miniLink}>
              <span className={styles.micro}>
                <Users size={12} /> Equipe
              </span>
              <span className={styles.miniRow}>
                <b>{data?.teams.length ?? 0} duplas</b>
                <span>{data?.technicians.length ?? 0} técnicos</span>
              </span>
            </Link>
          </section>
        </aside>
      </div>

      <section className={`${styles.card} ${styles.alerts}`} id="alertas">
        <div className={styles.cardHead}>
          <h2 className={styles.h2}>Alertas e sugestões · próximos {HORIZON} dias</h2>
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={tab === "critico"} className={`${tab === "critico" ? styles.tabCrit : ""}`} onClick={() => setTab("critico")}>
              <AlertTriangle size={14} /> Críticos · {criticos.length}
            </button>
            <button role="tab" aria-selected={tab === "atencao"} className={`${tab === "atencao" ? styles.tabWarn : ""}`} onClick={() => setTab("atencao")}>
              <AlertTriangle size={14} /> Atenção · {atencao.length}
            </button>
            <button role="tab" aria-selected={tab === "sugestoes"} className={`${tab === "sugestoes" ? styles.tabSug : ""}`} onClick={() => setTab("sugestoes")}>
              <Lightbulb size={14} /> Sugestões · {suggestions.length}
            </button>
          </div>
        </div>
        {ignoredCount > 0 && (
          <button className={styles.showIgnored} onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? "Esconder os ignorados" : `Mostrar ${ignoredCount} alerta(s) ignorado(s)`}
          </button>
        )}
        <ul className={styles.alertList}>
          {tab !== "sugestoes" &&
            (tab === "critico" ? criticos : atencao).slice(0, 40).map((a) => {
              const ignored = ignoredKeys.has(alertKey(a));
              return (
                <li key={alertKey(a)} className={`${styles.alertItem} ${ignored ? styles.alertIgnored : ""}`}>
                  <span className={styles.alertDate}>
                    {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(a.date)]} {a.date.slice(8)}/{a.date.slice(5, 7)}
                    {a.endDate !== a.date && ` → ${a.endDate.slice(8)}/${a.endDate.slice(5, 7)}`}
                  </span>
                  <div className={styles.alertBody}>
                    <span>{a.message}</span>
                    {data && <AlertActions alert={a} data={data} today={today} ignored={ignored} onToggleIgnore={() => toggleIgnore(a)} />}
                  </div>
                  <button className={styles.alertGo} onClick={() => pickDate(a.date < today ? today : a.date)}>
                    Ver dia <ArrowRight size={13} />
                  </button>
                </li>
              );
            })}
          {tab === "sugestoes" &&
            suggestions.slice(0, 30).map((sg, i) => (
              <li key={i} className={styles.alertItem}>
                <span className={styles.alertDate}>
                  {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(sg.date)]} {sg.date.slice(8)}/{sg.date.slice(5, 7)}
                </span>
                <span>
                  {labels.sectorShort[sg.sector]}: {sg.text}
                </span>
                <button className={styles.alertGo} onClick={() => pickDate(sg.date < today ? today : sg.date)}>
                  Ver dia <ArrowRight size={13} />
                </button>
              </li>
            ))}
        </ul>
        {tab !== "sugestoes" && (tab === "critico" ? criticos : atencao).length === 0 && (
          <p className={styles.empty}>{tab === "critico" ? "Nenhum alerta crítico. Cobertura mínima garantida." : "Nada que precise de atenção."}</p>
        )}
        {tab === "sugestoes" && suggestions.length === 0 && (
          <p className={styles.empty}>Sem remanejamentos necessários. Quando houver desfalques, o sistema sugere duplas temporárias e trocas de folga aqui.</p>
        )}
      </section>

      {data && (
        <TeamDetailDialog
          data={data}
          teamId={detailTeam}
          date={selected}
          days={detailDays}
          onOpenChange={(o) => !o && setDetailTeam(null)}
        />
      )}
    </div>
  );
}
