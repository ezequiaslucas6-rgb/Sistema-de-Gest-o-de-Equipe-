import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet";
import { useQueryClient } from "@tanstack/react-query";
import { Maximize, Minimize, X } from "lucide-react";
import { APP_DATA_QUERY_KEY, useAppData } from "../helpers/useAppData";
import { useCountUp, useNow } from "../helpers/useLive";
import { scheduleEngine, DayStatus, Sector } from "../helpers/scheduleEngine";
import { buildScheduleSnapshot } from "../helpers/buildScheduleSnapshot";
import { buildEvents, liveStatus, longDate } from "../helpers/dashboardData";
import { labels } from "../helpers/labels";
import styles from "./tv.module.css";

const SHORT: Partial<Record<DayStatus, string>> = {
  trabalho: "T", plantao: "P", folga: "F", folga_plantao: "FP", feriado: "FE", viagem: "V", compensatoria: "FC", desfalcada: "D", ausente: "A", sem_escala: "–",
};

const Gauge = ({ value, total, sector }: { value: number; total: number; sector: Sector }) => {
  const pct = total ? value / total : 0;
  const shown = useCountUp(pct * 100);
  return (
    <svg viewBox="0 0 100 100" className={styles.gauge} aria-hidden>
      <circle cx="50" cy="50" r="42" className={styles.gaugeTrack} />
      <circle
        cx="50"
        cy="50"
        r="42"
        className={sector === "infraestrutura" ? styles.gaugeInfra : styles.gaugeSupport}
        style={{ strokeDasharray: `${pct * 263.9} 263.9` }}
      />
      <text x="50" y="57" textAnchor="middle" className={styles.gaugeText}>
        {Math.round(shown)}%
      </text>
    </svg>
  );
};

/** Modo TV / NOC: visão em tela cheia para monitor da sala, atualiza sozinha. */
export default function TvPage() {
  const { data } = useAppData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useNow(1000);
  const today = scheduleEngine.todayIso();
  const [full, setFull] = useState(() => !!document.fullscreenElement);

  // relê o banco a cada minuto (alterações feitas em outro computador/sessão aparecem sozinhas)
  useEffect(() => {
    const id = window.setInterval(() => qc.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }), 60_000);
    return () => window.clearInterval(id);
  }, [qc]);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };
  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    navigate("/");
  };

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
      if (e.key.toLowerCase() === "f") toggleFull();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps


  const snapshot = useMemo(() => (data ? buildScheduleSnapshot(data, today, 30) : null), [data, today]);
  const events = useMemo(() => (data ? buildEvents(data, today, 3).slice(0, 7) : []), [data, today]);
  const live = data ? liveStatus(now, data) : null;
  const alerts = snapshot?.alerts ?? [];
  const teamsById = new Map(data?.teams.map((t) => [t.id, t]) ?? []);

  const clock = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return (
    <div className={styles.tv}>
      <Helmet>
        <title>Modo TV · Escala Técnica</title>
      </Helmet>
      <div className={styles.controls}>
        <button onClick={toggleFull} title="Tela cheia (F)">
          {full ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <button onClick={exit} title="Sair do modo TV (Esc)">
          <X size={16} />
        </button>
      </div>

      <header className={styles.top}>
        <div className={styles.brand}>
          <img src="./logo.png" alt="" />
          <div>
            <div className={styles.micro}>Escala Técnica · Centro de operações</div>
            <h1>Cobertura em tempo real</h1>
          </div>
        </div>
        {live && (
          <div className={`${styles.status} ${styles[`st_${live.kind}`]}`}>
            <span className={styles.dot} />
            <span>
              {live.title}
              {live.range ? ` · ${live.detail}` : ""}
            </span>
            {live.progress != null && (
              <span className={styles.statusProg}>
                <i style={{ width: `${live.progress * 100}%` }} />
              </span>
            )}
          </div>
        )}
        <div className={styles.clock}>
          <b>
            {clock}
            <small>:{seconds}</small>
          </b>
          <div className={styles.micro}>{longDate(today)}</div>
        </div>
      </header>

      <main className={styles.grid}>
        {labels.sectors.map((sector) => {
          const days = snapshot?.bySector[sector] ?? [];
          const v = days[0];
          if (!v || !data) return <section key={sector} className={styles.panel} />;
          const techs = v.teams.filter((t) => ["trabalho", "plantao", "desfalcada"].includes(t.status)).reduce((s, t) => s + t.availableMemberIds.length, 0);
          const ok = v.coverage >= v.min;
          return (
            <section key={sector} className={`${styles.panel} ${sector === "infraestrutura" ? styles.pInfra : styles.pSupport}`}>
              <h2>{labels.sector[sector]}</h2>
              <div className={styles.gaugeRow}>
                <Gauge value={v.coverage} total={v.teams.length} sector={sector} />
                <div>
                  <div className={styles.big}>
                    {v.coverage}
                    <small>/{v.teams.length} duplas</small>
                  </div>
                  <div className={styles.micro}>
                    mínimo {v.min} · {techs} técnicos em campo
                  </div>
                  <span className={`${styles.badge} ${ok ? styles.ok : styles.bad}`}>{ok ? "Cobertura OK" : "Abaixo do mínimo"}</span>
                </div>
              </div>
              <div className={styles.tiles}>
                {v.teams.map((tv) => {
                  const team = teamsById.get(tv.teamId);
                  const members = data.technicians.filter((t) => t.teamId === tv.teamId);
                  const trip = tv.tripId ? data.trips.find((t) => t.id === tv.tripId) : null;
                  return (
                    <div key={tv.teamId} className={`${styles.tile} ${styles[`t_${tv.status}`] ?? ""}`}>
                      <div className={styles.code}>{team?.code}</div>
                      <span className={styles.tileSt}>{tv.status === "viagem" ? "✈ Viagem" : labels.status[tv.status]}</span>
                      <div className={styles.tileM}>
                        {tv.status === "viagem" && trip
                          ? `${trip.destination} · volta ${scheduleEngine.formatDate(scheduleEngine.tripEnd(trip).slice(0, 10)).slice(0, 5)} ${scheduleEngine.tripEnd(trip).slice(11)}`
                          : members.map((m) => (
                              <span key={m.id} className={tv.absentMemberIds.includes(m.id) ? styles.away : ""}>
                                {m.name}
                              </span>
                            ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.micro}>Próximos 7 dias</div>
              <div className={styles.week}>
                <span />
                {days.slice(0, 7).map((d) => (
                  <span key={d.date} className={styles.weekHd}>
                    {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d.date)]} {d.date.slice(8)}
                  </span>
                ))}
                {v.teams.map((tv) => (
                  <div key={tv.teamId} className={styles.weekRow}>
                    <span className={styles.weekCode}>{teamsById.get(tv.teamId)?.code}</span>
                    {days.slice(0, 7).map((d) => {
                      const st = d.teams.find((t) => t.teamId === tv.teamId)?.status ?? "sem_escala";
                      return (
                        <i key={d.date} className={styles[`c_${st}`]}>
                          {SHORT[st]}
                        </i>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <section className={styles.panel}>
          <h2>Próximas 72h</h2>
          <ul className={styles.events}>
            {events.length === 0 && <li className={styles.micro}>Nada programado.</li>}
            {events.map((e, i) => (
              <li key={i}>
                <span>{e.text}</span>
                <span className={styles.evWhen}>
                  {e.date === today ? "HOJE" : `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(e.date)].toUpperCase()} ${e.date.slice(8)}`}
                  {e.time ? ` ${e.time}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.micro} style={{ marginTop: 18 }}>
            Cobertura total · 14 dias
          </div>
          <div className={styles.spark}>
            {snapshot &&
              Array.from({ length: 14 }, (_, i) => {
                const cov = labels.sectors.reduce((s, sec) => s + snapshot.bySector[sec][i].coverage, 0);
                const tot = labels.sectors.reduce((s, sec) => s + snapshot.bySector[sec][i].teams.length, 0) || 1;
                const below = labels.sectors.some((sec) => snapshot.bySector[sec][i].coverage < snapshot.bySector[sec][i].min);
                const d = snapshot.bySector.suporte[i].date;
                return (
                  <div key={d} className={styles.sparkCol} title={`${scheduleEngine.formatDate(d)} · ${cov}/${tot}`}>
                    <i className={below ? styles.sparkBad : ""} style={{ height: `${Math.max(4, (cov / tot) * 100)}%` }} />
                    <span>{d.slice(8)}</span>
                  </div>
                );
              })}
          </div>
          <div className={styles.stats}>
            <div>
              <b>{data ? data.trips.filter((t) => t.departAt.slice(0, 10) <= today && scheduleEngine.tripEnd(t).slice(0, 10) >= today).length : 0}</b>
              <span>viagens hoje</span>
            </div>
            <div>
              <b>{data ? data.technicians.filter((t) => scheduleEngine.isAbsent(data.absences, t.id, today)).length : 0}</b>
              <span>ausentes</span>
            </div>
            <div>
              <b className={alerts.some((a) => a.severity === "critico") ? styles.critNum : ""}>{alerts.length}</b>
              <span>alertas 30 dias</span>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.ticker}>
        <span className={styles.tickerLbl}>{alerts.length ? "ALERTAS" : "TUDO OK"}</span>
        <div className={styles.tickerTrack}>
          <div className={styles.tickerItems} style={{ animationDuration: `${Math.max(25, alerts.length * 8)}s` }}>
            {(alerts.length ? [...alerts, ...alerts] : [null]).map((a, i) =>
              a ? (
                <span key={i} className={a.severity === "critico" ? styles.tickCrit : ""}>
                  <b>
                    {scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(a.date)]} {a.date.slice(8)}/{a.date.slice(5, 7)}
                  </b>{" "}
                  · {a.message}
                </span>
              ) : (
                <span key={i}>Cobertura mínima garantida nos próximos 30 dias.</span>
              ),
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
