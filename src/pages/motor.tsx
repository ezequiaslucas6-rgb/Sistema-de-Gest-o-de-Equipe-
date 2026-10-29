import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, Printer, CheckCircle2, Cpu, MousePointerClick, PartyPopper, Repeat, Sparkles, Star } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { OnCallEditor } from "../components/OnCallEditor";
import { OnCallMonthDialog } from "../components/OnCallMonthDialog";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { Switch } from "../components/Switch";
import { DateField } from "../components/DateField";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import { defaultSixOneEnd, holidayWeekend, MondayRule, runMotor, saturdayOnOrBefore } from "../helpers/onCallMotor";
import styles from "./motor.module.css";

const short = (d: string) => `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d)]} ${d.slice(8)}/${d.slice(5, 7)}`;

export default function MotorPage() {
  const { data, error } = useAppData();
  const { applyOnCallPlan, saveMotorConfig } = useAppMutations();
  const today = scheduleEngine.todayIso();

  const [from, setFrom] = useState(() => saturdayOnOrBefore(today));
  const [to, setTo] = useState<string | null>(null);
  const [order, setOrder] = useState<Record<Sector, number[]> | null>(null);
  const [startTeam, setStartTeam] = useState<Record<Sector, number | null>>({ suporte: null, infraestrutura: null });
  const [mondayRule, setMondayRule] = useState<MondayRule>("seguinte");
  const [excluded, setExcluded] = useState<number[]>([]);
  const [respect, setRespect] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [tab, setTab] = useState<"editar" | "gerar">("editar");
  const [weeks, setWeeks] = useState(12);
  const [printOpen, setPrintOpen] = useState(false);

  // padrões: ordem por código, fim = véspera do 5x2, abre quem já está de plantão no primeiro fim de semana
  useEffect(() => {
    if (!data || order) return;
    const cfg = data.motorConfig;
    const out = cfg?.excluded.filter((id) => data.teams.some((t) => t.id === id)) ?? [];
    const o = {} as Record<Sector, number[]>;
    const st = {} as Record<Sector, number | null>;
    for (const s of labels.sectors) {
      const ids = data.teams.filter((t) => t.sector === s).sort((a, b) => a.code.localeCompare(b.code)).map((t) => t.id);
      // ordem salva primeiro; duplas novas entram no fim
      const saved = (cfg?.order[s] ?? []).filter((id) => ids.includes(id));
      o[s] = [...saved, ...ids.filter((id) => !saved.includes(id))];
      const active = o[s].filter((id) => !out.includes(id));
      const current = data.onCallShifts.find((x) => x.weekendStart === from && active.includes(x.teamId));
      if (current) st[s] = current.teamId;
      else {
        const last = data.onCallShifts
          .filter((x) => x.weekendStart < from && active.includes(x.teamId))
          .sort((a, b) => b.weekendStart.localeCompare(a.weekendStart))[0];
        st[s] = last ? active[(active.indexOf(last.teamId) + 1) % active.length] : (active[0] ?? null);
      }
    }
    if (cfg) {
      setMondayRule(cfg.mondayRule);
      setRespect(cfg.respectAbsences);
    }
    setExcluded(out);
    setOrder(o);
    setStartTeam(st);
    setTo(defaultSixOneEnd(data, from));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo(
    () =>
      data && order && to
        ? runMotor({
            data,
            from,
            to,
            order: { suporte: order.suporte.filter((id) => !excluded.includes(id)), infraestrutura: order.infraestrutura.filter((id) => !excluded.includes(id)) },
            startTeam,
            mondayRule,
            respectAbsences: respect,
          })
        : null,
    [data, order, to, from, startTeam, mondayRule, respect, excluded],
  );

  const teamById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);
  const names = (teamId: number) => data?.technicians.filter((t) => t.teamId === teamId).map((t) => t.name).join(" + ") || "sem técnicos";

  const changes = useMemo(() => {
    if (!data || !result) return 0;
    return result.shifts.filter((s) => {
      const cur = data.onCallShifts.find((x) => x.weekendStart === s.saturday && teamById.get(x.teamId)?.sector === s.sector);
      return !cur || cur.teamId !== s.teamId || cur.compDates.join() !== [...s.compDates].sort().join();
    }).length;
  }, [data, result, teamById]);

  const move = (sector: Sector, idx: number, dir: -1 | 1) => {
    if (!order) return;
    const list = [...order[sector]];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    setOrder({ ...order, [sector]: list });
  };

  const toggleExcluded = (sector: Sector, id: number) => {
    const next = excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id];
    setExcluded(next);
    if (startTeam[sector] === id && next.includes(id)) {
      setStartTeam({ ...startTeam, [sector]: order?.[sector].find((x) => !next.includes(x)) ?? null });
    }
  };

  const apply = () => {
    if (!result || !data || !order) return;
    saveMotorConfig.mutate({ order, excluded, mondayRule, respectAbsences: respect });
    const lastSat = result.saturdays[result.saturdays.length - 1] ?? from;
    applyOnCallPlan.mutate(
      {
        fromDate: from,
        toDate: lastSat,
        sectors: labels.sectors.map((sector) => ({
          sector,
          shifts: result.shifts
            .filter((s) => s.sector === sector)
            .map((s) => ({
              teamId: s.teamId,
              weekendStart: s.saturday,
              compDates: s.compDates,
              notes: s.swap ? `Troca automática com ${teamById.get(s.swap.expectedTeamId)?.code}: ${s.swap.reason}` : null,
            })),
        })),
        holidays: result.holidays.filter((h) => h.teamIds.length > 0).map((h) => ({ id: h.holidayId, onCallTeamIds: h.teamIds, compDate: h.compDate })),
        basePatterns: result.missingBase.map((sector) => ({ sector, startDate: scheduleEngine.mondayOf(from) })),
      },
      {
        onSuccess: () => {
          setConfirm(false);
          setTab("editar");
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
      },
    );
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  const swaps = result?.shifts.filter((s) => s.swap).length ?? 0;
  const weekendsCount = result?.saturdays.length ?? 0;
  const holidayInWeek = (sat: string) => result?.holidays.filter((h) => holidayWeekend(h.date, mondayRule) === sat) ?? [];
  const currentSat = saturdayOnOrBefore(today);

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Escala de plantão · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Plantão de fim de semana · feriados · banco de horas"
        title="Escala de plantão"
        description="Veja e edite quem está de plantão em cada fim de semana, a folga e os feriados. Para montar vários meses de uma vez, use o rodízio automático."
        actions={
          tab === "gerar" ? (
            <Button className={styles.gradBtn} disabled={!result || weekendsCount === 0} onClick={() => setConfirm(true)}>
              <Sparkles size={16} /> Aplicar na escala
            </Button>
          ) : (
            <div className={styles.headActions}>
              <Button variant="outline" onClick={() => setPrintOpen(true)} disabled={!data}>
                <Printer size={16} /> Imprimir / PDF do mês
              </Button>
              <Button className={styles.gradBtn} onClick={() => setTab("gerar")}>
                <Cpu size={16} /> Gerar rodízio automático
              </Button>
            </div>
          )
        }
      />

      {data && <OnCallMonthDialog data={data} open={printOpen} onOpenChange={setPrintOpen} />}

      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "editar"} className={tab === "editar" ? styles.tabOn : ""} onClick={() => setTab("editar")}>
          <CalendarCheck size={16} /> Escala salva (editar)
        </button>
        <button role="tab" aria-selected={tab === "gerar"} className={tab === "gerar" ? styles.tabOn : ""} onClick={() => setTab("gerar")}>
          <Cpu size={16} /> Gerar rodízio automático
        </button>
      </div>

      {tab === "editar" && data && (
        <section className={styles.card}>
          <div className={styles.editHead}>
            <p className={styles.howto}>
              <MousePointerClick size={16} /> Clique na dupla para trocar quem faz o plantão, na data da folga para mudar o dia e no feriado para escolher quem
              trabalha. Tudo é salvo na hora.
            </p>
            <div className={styles.seg}>
              {[8, 12, 26].map((w) => (
                <button key={w} className={weeks === w ? styles.segOn : ""} onClick={() => setWeeks(w)}>
                  {w === 26 ? "6 meses" : `${w} semanas`}
                </button>
              ))}
            </div>
          </div>
          <OnCallEditor data={data} from={saturdayOnOrBefore(today)} weeks={weeks} />
        </section>
      )}
      {tab === "editar" && !data && <Skeleton className={styles.skel} />}

      {tab === "gerar" && (
      <>
      <div className={styles.top}>
        <section className={styles.card}>
          <h2 className={styles.h2}>
            <Cpu size={18} /> Configuração
          </h2>
          <div className={styles.row2}>
            <div>
              <label className={styles.label}>Primeiro fim de semana (sábado)</label>
              <DateField value={from} onChange={(v) => setFrom(saturdayOnOrBefore(v))} onlyWeekday={6} />
            </div>
            <div>
              <label className={styles.label}>Gerar até</label>
              {to && <DateField value={to} onChange={setTo} />}
              {data && (
                <div className={styles.quick}>
                  <button onClick={() => setTo(defaultSixOneEnd(data, from))}>fim do 6x1</button>
                  <button onClick={() => setTo(scheduleEngine.addDays(from, 7 * 26 - 1))}>+6 meses (inclui 5x2)</button>
                </div>
              )}
            </div>
          </div>
          <div className={styles.hint}>
            {weekendsCount} fins de semana · de {scheduleEngine.formatDate(from)} até {to ? scheduleEngine.formatDate(to) : "…"}
            {data && to && data.patterns.some((p) => p.scaleType === "5x2" && p.startDate === scheduleEngine.addDays(to, 1)) && " (véspera do início do 5x2)"}
          </div>

          <div className={styles.orders}>
            {order &&
              labels.sectors.map((sector) => (
                <div key={sector} className={`${styles.order} ${sector === "infraestrutura" ? styles.oInfra : styles.oSupport}`}>
                  <div className={styles.micro}>Rodízio · {labels.sector[sector]}</div>
                  <ol>
                    {order[sector].map((id, i) => {
                      const first = startTeam[sector] === id;
                      const off = excluded.includes(id);
                      return (
                        <li key={id} className={`${first ? styles.first : ""} ${off ? styles.off : ""}`}>
                          <button
                            className={styles.starBtn}
                            title="Abrir o rodízio com esta dupla"
                            disabled={off}
                            onClick={() => setStartTeam({ ...startTeam, [sector]: id })}
                          >
                            <Star size={14} fill={first ? "currentColor" : "none"} />
                          </button>
                          <span className={styles.ocode}>{teamById.get(id)?.code}</span>
                          <span className={styles.onames}>{names(id)}</span>
                          {first && <span className={styles.firstTag}>abre {from.slice(8)}/{from.slice(5, 7)}</span>}
                          <button
                            className={off ? styles.inBtnOff : styles.inBtn}
                            onClick={() => toggleExcluded(sector, id)}
                            title={off ? "Colocar de volta no rodízio de plantão" : "Tirar esta dupla do rodízio de plantão"}
                          >
                            {off ? "fora" : "no rodízio"}
                          </button>
                          <span className={styles.arrows}>
                            <button onClick={() => move(sector, i, -1)} disabled={i === 0} aria-label="Subir">
                              <ArrowUp size={13} />
                            </button>
                            <button onClick={() => move(sector, i, 1)} disabled={i === order[sector].length - 1} aria-label="Descer">
                              <ArrowDown size={13} />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            {!order && <Skeleton className={styles.skel} />}
          </div>

          <div className={styles.opts}>
            <div>
              <label className={styles.label}>Feriado na segunda-feira</label>
              <div className={styles.seg}>
                <button className={mondayRule === "anterior" ? styles.segOn : ""} onClick={() => setMondayRule("anterior")}>
                  Plantão do fim de semana anterior (emenda)
                </button>
                <button className={mondayRule === "seguinte" ? styles.segOn : ""} onClick={() => setMondayRule("seguinte")}>
                  Do fim de semana seguinte
                </button>
              </div>
            </div>
            <label className={styles.switchRow}>
              <Switch checked={respect} onCheckedChange={setRespect} />
              Trocar automaticamente quando um técnico estiver de férias, atestado ou viagem
            </label>
          </div>
        </section>

        <section className={`${styles.card} ${styles.rules}`}>
          <h2 className={styles.h2}>Regras aplicadas</h2>
          <ul>
            <li>
              <b>1 dupla por setor</b> em cada fim de semana, em rodízio fixo (Suporte a cada {order?.suporte.filter((id) => !excluded.includes(id)).length ?? 4} semanas, Backbone a cada{" "}
              {order?.infraestrutura.filter((id) => !excluded.includes(id)).length ?? 3}).
            </li>
            <li>
              Plantão: <b>sábado {data?.settings[0]?.onCallSaturday.replace("-", "–")}</b> e <b>domingo {data?.settings[0]?.onCallSunday.replace(/-/g, "–").replace(",", " e ")}</b> (sábado de manhã é expediente normal do 6x1).
            </li>
            <li>
              Banco de horas: quem fez o plantão <b>folga sexta e sábado da semana seguinte</b>. O domingo é DSR (descanso semanal remunerado) e não entra.
            </li>
            <li>
              <b>Feriado em dia de semana</b>: quem está de plantão no fim de semana daquela semana faz o feriado e <b>folga no próximo dia útil</b> (ex.: feriado na
              segunda → folga na terça). <b>Feriado na sexta</b> fica com outra dupla, porque o plantão é só sábado e domingo.
            </li>
            <li>Se a semana seguinte já for 5x2, a folga do plantão passa para quinta e sexta.</li>
            <li>Ninguém pega dois fins de semana seguidos. Dupla desfalcada troca com a próxima da fila, que devolve a vez depois.</li>
          </ul>
        </section>
      </div>

      {result && (
        <>
          <section className={styles.stats}>
            <div>
              <b>{weekendsCount}</b>
              <span>fins de semana</span>
            </div>
            <div>
              <b>{result.shifts.length}</b>
              <span>plantões gerados</span>
            </div>
            <div>
              <b>{result.holidays.filter((h) => scheduleEngine.weekdayIndex(h.date) < 5).length}</b>
              <span>feriados em dia útil</span>
            </div>
            <div className={swaps ? styles.statWarn : ""}>
              <b>{swaps}</b>
              <span>trocas automáticas</span>
            </div>
            <div className={changes ? styles.statInfo : ""}>
              <b>{changes}</b>
              <span>mudam em relação ao cadastrado</span>
            </div>
          </section>

          {(result.warnings.length > 0 || result.missingBase.length > 0) && (
            <section className={styles.warnings}>
              {result.missingBase.length > 0 && (
                <div>
                  <AlertTriangle size={15} /> {result.missingBase.map((s) => labels.sectorShort[s]).join(" e ")} sem escala 6x1 em{" "}
                  {scheduleEngine.formatDate(from)} — ao aplicar, o motor cria a escala base 6x1 (segunda a sábado, domingo de folga).
                </div>
              )}
              {result.warnings.map((w, i) => (
                <div key={i}>
                  <AlertTriangle size={15} /> {w}
                </div>
              ))}
            </section>
          )}

          <section className={styles.card}>
            <h2 className={styles.h2}>Escala de plantão gerada</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fim de semana</th>
                    <th className={styles.thSupport}>Suporte · plantão</th>
                    <th>Folga (banco de horas)</th>
                    <th className={styles.thInfra}>Backbone · plantão</th>
                    <th>Folga (banco de horas)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.saturdays.map((sat) => {
                    const hs = holidayInWeek(sat);
                    return (
                      <tr key={sat} className={sat === currentSat ? styles.rowNow : ""}>
                        <td className={styles.when}>
                          <b>
                            {sat.slice(8)}–{scheduleEngine.addDays(sat, 1).slice(8)}/{scheduleEngine.addDays(sat, 1).slice(5, 7)}
                          </b>
                          {result.shifts.find((x) => x.saturday === sat)?.scale && (
                            <span className={styles.scaleTag}>{result.shifts.find((x) => x.saturday === sat)?.scale}</span>
                          )}
                          {sat === currentSat && <span className={styles.nowTag}>este fim de semana</span>}
                          {hs.map((h) => (
                            <div key={h.holidayId} className={styles.hol}>
                              <PartyPopper size={12} /> {h.name} · {short(h.date)}
                              {h.compDate && <> · folga {short(h.compDate)}</>}
                            </div>
                          ))}
                        </td>
                        {labels.sectors.map((sector) => {
                          const s = result.shifts.find((x) => x.sector === sector && x.saturday === sat);
                          if (!s) return [<td key={`${sector}a`}>—</td>, <td key={`${sector}b`} />];
                          const cur = data!.onCallShifts.find((x) => x.weekendStart === sat && teamById.get(x.teamId)?.sector === sector);
                          const changed = !cur || cur.teamId !== s.teamId;
                          return [
                            <td key={`${sector}a`}>
                              <div className={styles.team}>
                                <span className={`${styles.code} ${sector === "infraestrutura" ? styles.cInfra : styles.cSupport}`}>
                                  {teamById.get(s.teamId)?.code}
                                </span>
                                <span>
                                  {names(s.teamId)}
                                  {hs.some((h) => h.teamIds.includes(s.teamId) && scheduleEngine.weekdayIndex(h.date) < 5) && (
                                    <span className={styles.plus}>+ feriado</span>
                                  )}
                                </span>
                              </div>
                              {s.swap && (
                                <div className={styles.swap}>
                                  <Repeat size={11} /> no lugar de {teamById.get(s.swap.expectedTeamId)?.code}: {s.swap.reason}
                                </div>
                              )}
                              {changed && cur && <div className={styles.was}>antes: {teamById.get(cur.teamId)?.code}</div>}
                            </td>,
                            <td key={`${sector}b`} className={styles.comp}>
                              {s.compDates.map(short).join(" + ")}
                            </td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.h2}>Equilíbrio e banco de horas projetado</h2>
            <p className={styles.hint}>
              Crédito = horas de plantão (fim de semana e feriado). Débito = horas dos dias de folga de compensação. Saldo próximo de zero significa que a folga
              compensa o plantão.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Dupla</th>
                    <th className={styles.r}>Plantões</th>
                    <th className={styles.r}>Feriados</th>
                    <th className={styles.r}>Crédito</th>
                    <th className={styles.r}>Débito</th>
                    <th className={styles.r}>Saldo</th>
                    <th>Fins de semana</th>
                  </tr>
                </thead>
                <tbody>
                  {result.bank.map((b) => (
                    <tr key={b.teamId}>
                      <td>
                        <div className={styles.team}>
                          <span className={`${styles.code} ${b.sector === "infraestrutura" ? styles.cInfra : styles.cSupport}`}>{teamById.get(b.teamId)?.code}</span>
                          <span>{names(b.teamId)}</span>
                        </div>
                      </td>
                      <td className={styles.r}>{b.shifts}</td>
                      <td className={styles.r}>{b.holidays}</td>
                      <td className={styles.r}>{b.credit}h</td>
                      <td className={styles.r}>{b.debit}h</td>
                      <td className={`${styles.r} ${b.balance > 0 ? styles.pos : b.balance < 0 ? styles.neg : ""}`}>
                        {b.balance > 0 ? "+" : ""}
                        {b.balance}h
                      </td>
                      <td className={styles.dates}>{b.dates.map((d) => d.slice(8) + "/" + d.slice(5, 7)).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      </>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar a escala de plantão?</DialogTitle>
            <DialogDescription>
              Os plantões dos dois setores de {scheduleEngine.formatDate(from)} até{" "}
              {result?.saturdays.length ? scheduleEngine.formatDate(result.saturdays[result.saturdays.length - 1]) : "—"} serão substituídos pelos {result?.shifts.length}{" "}
              gerados ({changes} mudam). Os feriados do período recebem a dupla de plantão e a folga do dia seguinte.
              {result && result.missingBase.length > 0 && " A escala base 6x1 também será criada."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button onClick={apply} disabled={applyOnCallPlan.isPending}>
              <CheckCircle2 size={16} /> Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className={styles.footer}>
        Horário do plantão e banco de horas por dupla ficam em <Link to="/plantao">Regras e banco de horas</Link>.
      </p>
    </div>
  );
}
