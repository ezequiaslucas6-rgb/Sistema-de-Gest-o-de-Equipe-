import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { AlertTriangle, CheckCircle2, Pencil, Save, Trash2, Wand2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DayCell } from "../components/DayCell";
import { DateField } from "../components/DateField";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Skeleton } from "../components/Skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine, PatternDays, ScaleType, Sector } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import type { PatternDTO } from "../endpoints/data_GET.schema";
import styles from "./planejamento.module.css";

function nextMonday(from: string) {
  const wd = scheduleEngine.weekdayIndex(from);
  return scheduleEngine.addDays(from, wd === 0 ? 7 : 7 - wd);
}

export default function PlanningPage() {
  const { data, error } = useAppData();
  const { savePattern, deletePattern, saveSettings } = useAppMutations();
  const today = scheduleEngine.todayIso();

  const [sector, setSector] = useState<Sector>("suporte");
  const [scaleType, setScaleType] = useState<ScaleType>("5x2");
  const [weekendMode, setWeekendMode] = useState<"plantao" | "rodizio">("plantao");
  const [minCoverage, setMinCoverage] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [maxConsecutive, setMaxConsecutive] = useState(6);
  const [hoursSixOne, setHoursSixOne] = useState(8);
  const [hoursSixOneSat, setHoursSixOneSat] = useState(4);
  const [hoursFiveTwo, setHoursFiveTwo] = useState(8.8);
  const [shiftStart, setShiftStart] = useState("08:00");
  const [shiftEnd, setShiftEnd] = useState("17:48");
  const [cycleWeeks, setCycleWeeks] = useState(4);
  const [preview, setPreview] = useState<{ cycleWeeks: number; daysOff: PatternDays; warnings: string[] } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("Transição para 5x2");
  const [startDate, setStartDate] = useState(nextMonday(today));

  const teams = useMemo(() => data?.teams.filter((t) => t.sector === sector) ?? [], [data, sector]);
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const settings = data?.settings.find((s) => s.sector === sector);
  const settingsKey = settings ? JSON.stringify(settings) : "";
  const pendingLoad = useRef<PatternDTO | null>(null);

  // carrega parâmetros do setor quando os dados chegam, mudam ou o setor muda
  useEffect(() => {
    if (!settings) return;
    setMinCoverage(settings.minCoverage);
    setMaxConsecutive(settings.maxConsecutive);
    setHoursSixOne(settings.hoursSixOne);
    setHoursSixOneSat(settings.hoursSixOneSaturday);
    setHoursFiveTwo(settings.hoursFiveTwo);
    setShiftStart(settings.shiftStart);
    setShiftEnd(settings.shiftEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // 6x1: sábado é meio período
  const hoursSixOneByWd = useMemo(
    () => [hoursSixOne, hoursSixOne, hoursSixOne, hoursSixOne, hoursSixOne, hoursSixOneSat, hoursSixOne],
    [hoursSixOne, hoursSixOneSat],
  );

  const applyPattern = (p: PatternDTO) => {
    setScaleType(p.scaleType);
    setCycleWeeks(p.cycleWeeks);
    setPreview({ cycleWeeks: p.cycleWeeks, daysOff: p.daysOff, warnings: [] });
    setEditingId(p.id);
    setName(p.name);
    setStartDate(p.startDate);
    document.getElementById("gerador")?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const pending = pendingLoad.current;
    if (pending && pending.sector === sector) {
      pendingLoad.current = null;
      applyPattern(pending);
      return;
    }
    setCycleWeeks(Math.max(1, teamIds.length));
    setPreview(null);
    setEditingId(null);
  }, [sector, teamIds.length]);

  const generate = () => {
    setPreview(scheduleEngine.generatePattern({ teamIds, scaleType, minCoverage, maxConsecutive, cycleWeeks, weekendMode }));
  };

  // no modo plantão o fim de semana não é exigido da escala base
  const effMinCoverage = useMemo(
    () => (weekendMode === "plantao" ? minCoverage.map((m, i) => (i >= 5 ? 0 : m)) : minCoverage),
    [weekendMode, minCoverage],
  );

  const loadPattern = (p: PatternDTO) => {
    if (p.sector === sector) {
      applyPattern(p);
    } else {
      pendingLoad.current = p;
      setSector(p.sector);
    }
  };

  const save = (asNew: boolean) => {
    if (!preview) return;
    savePattern.mutate(
      {
        id: asNew ? undefined : editingId ?? undefined,
        sector,
        scaleType,
        name,
        startDate,
        cycleWeeks: preview.cycleWeeks,
        daysOff: preview.daysOff,
      },
      { onSuccess: (r) => setEditingId(r.id) },
    );
  };

  const saveParams = () => {
    saveSettings.mutate({
      sector,
      minCoverage,
      maxConsecutive,
      hoursSixOne,
      hoursSixOneSaturday: hoursSixOneSat,
      hoursFiveTwo,
      shiftStart,
      shiftEnd,
      onCallTeams: settings?.onCallTeams ?? 1,
      onCallSaturday: settings?.onCallSaturday ?? "14:00-18:00",
      onCallSunday: settings?.onCallSunday ?? "08:00-12:00,14:00-18:00",
    });
  };

  const coverage = useMemo(
    () => (preview ? scheduleEngine.patternCoverage(preview.daysOff, teamIds, preview.cycleWeeks) : []),
    [preview, teamIds],
  );
  const previewMetrics = useMemo(
    () =>
      preview
        ? scheduleEngine.computeMetrics(preview.daysOff, teamIds, preview.cycleWeeks, effMinCoverage, scaleType === "6x1" ? hoursSixOneByWd : hoursFiveTwo)
        : null,
    [preview, teamIds, effMinCoverage, scaleType, hoursSixOneByWd, hoursFiveTwo],
  );

  // Comparativo: gera as duas escalas com os mesmos parâmetros
  const comparison = useMemo(() => {
    if (teamIds.length === 0) return null;
    return (["6x1", "5x2"] as const).map((type) => {
      const r = scheduleEngine.generatePattern({ teamIds, scaleType: type, minCoverage, maxConsecutive, weekendMode });
      // no modo plantão o fim de semana é coberto pelo plantão, não pela escala base
      const effMin = weekendMode === "plantao" ? minCoverage.map((m, i) => (i >= 5 ? 0 : m)) : minCoverage;
      return {
        type,
        metrics: scheduleEngine.computeMetrics(r.daysOff, teamIds, r.cycleWeeks, effMin, type === "6x1" ? hoursSixOneByWd : hoursFiveTwo),
      };
    });
  }, [teamIds, minCoverage, maxConsecutive, hoursSixOneByWd, hoursFiveTwo, weekendMode]);

  const onCallPer = settings?.onCallTeams ?? 1;
  const onCallEvery = onCallPer > 0 ? Math.round((teamIds.length / onCallPer) * 10) / 10 : 0;
  const onCallHours = settings
    ? scheduleEngine.parseHours(settings.onCallSaturday) + scheduleEngine.parseHours(settings.onCallSunday)
    : 12;

  const demand = minCoverage.reduce((a, b) => a + b, 0);
  const capacity6 = teamIds.length * 6;
  const capacity5 = teamIds.length * 5;
  const needed5 = Math.ceil(demand / 5);

  const patternStatus = (p: PatternDTO) => {
    const current = scheduleEngine.patternForDate(data?.patterns ?? [], p.sector, today);
    if (current?.id === p.id) return { label: "Vigente", variant: "success" as const };
    if (p.startDate > today) return { label: "Programada", variant: "warning" as const };
    return { label: "Encerrada", variant: "outline" as const };
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Planejamento · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Gerador inteligente"
        title="Planejamento 6x1 → 5x2"
        description="Defina a cobertura mínima de cada dia, gere a escala automaticamente, ajuste à mão e programe a data de início. O sistema troca de escala sozinho na data definida."
      />

      <ToggleGroup type="single" value={sector} onValueChange={(v) => v && setSector(v as Sector)} className={styles.sectorToggle}>
        {labels.sectors.map((s) => (
          <ToggleGroupItem key={s} value={s}>
            {labels.sector[s]} · {data?.teams.filter((t) => t.sector === s).length ?? "–"} duplas
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* Comparativo */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Comparativo 6x1 × 5x2 — {labels.sector[sector]}</h2>
        {!comparison ? (
          <Skeleton className={styles.skel} />
        ) : (
          <div className={styles.compareWrap}>
            <div className={styles.tableScroll}>
            <table className={styles.compare}>
              <thead>
                <tr>
                  <th />
                  {comparison.map((c) => (
                    <th key={c.type} className={styles.compareHead}>
                      {c.type}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Dias trabalhados / semana", (m: typeof comparison[0]["metrics"]) => m.workDaysPerWeek],
                  ["Horas semanais por técnico", (m: typeof comparison[0]["metrics"]) => `${m.weeklyHours} h`],
                  ["Folgas por mês", (m: typeof comparison[0]["metrics"]) => m.offDaysPerMonth],
                  ["Domingos livres por ciclo", (m: typeof comparison[0]["metrics"]) => m.sundaysOffPerCycle],
                  ["Fins de semana completos por ciclo", (m: typeof comparison[0]["metrics"]) => m.weekendsOffPerCycle],
                  ["Folgas compensatórias no ciclo", (m: typeof comparison[0]["metrics"]) => m.compensatoryPerCycle],
                  ["Maior sequência de trabalho", (m: typeof comparison[0]["metrics"]) => `${m.maxConsecutiveFound} dias`],
                  ["Dias abaixo do mínimo no ciclo", (m: typeof comparison[0]["metrics"]) => m.daysBelowMin],
                ].map(([label, fn]) => (
                  <tr key={label as string}>
                    <td className={styles.compareLabel}>{label as string}</td>
                    {comparison.map((c) => {
                      const v = (fn as (m: typeof c.metrics) => string | number)(c.metrics);
                      const bad = label === "Dias abaixo do mínimo no ciclo" && Number(v) > 0;
                      return (
                        <td key={c.type} className={`${styles.compareVal} ${bad ? styles.bad : ""}`}>
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className={styles.compareLabel}>Cobertura média (Seg→Dom)</td>
                  {comparison.map((c) => (
                    <td key={c.type} className={styles.compareVal}>
                      <div className={styles.bars}>
                        {c.metrics.avgCoverageByWeekday.map((v, i) => (
                          <div key={i} className={styles.barCol} title={`${scheduleEngine.WEEKDAY_SHORT[i]}: ${v} (mín ${minCoverage[i]})`}>
                            <div
                              className={`${styles.bar} ${c.metrics.minCoverageByWeekday[i] < minCoverage[i] ? styles.barBad : ""}`}
                              style={{ height: `${(v / Math.max(teamIds.length, 1)) * 100}%` }}
                            />
                            <div className={styles.barMin} style={{ bottom: `${(minCoverage[i] / Math.max(teamIds.length, 1)) * 100}%` }} />
                            <span className={styles.barLabel}>{scheduleEngine.WEEKDAY_SHORT[i].slice(0, 1)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            </div>
            <div className={styles.insight}>
              <div className={styles.insightTitle}>Leitura rápida</div>
              <p>
                Demanda mínima semanal: <b className={styles.mono}>{demand}</b> dupla-dias. Capacidade com {teamIds.length} duplas:{" "}
                <b className={styles.mono}>{capacity6}</b> no 6x1 e <b className={styles.mono}>{capacity5}</b> no 5x2.
              </p>
              {capacity5 >= demand ? (
                <p className={styles.ok}>
                  <CheckCircle2 size={15} /> O 5x2 é viável com as duplas atuais — sobram {capacity5 - demand} dupla-dia(s) por semana de folga
                  operacional para cobrir ausências.
                </p>
              ) : (
                <p className={styles.warnText}>
                  <AlertTriangle size={15} /> Para manter esses mínimos no 5x2 são necessárias pelo menos {needed5} duplas (hoje{" "}
                  {teamIds.length}). Reduza o mínimo em algum dia ou reforce o setor.
                </p>
              )}
              <p className={styles.muted}>
                Jornada configurada: 6x1 = {hoursSixOne} h seg–sex + {hoursSixOneSat} h sábado · 5x2 = {hoursFiveTwo} h/dia · turno{" "}
                {shiftStart}–{shiftEnd}.
              </p>
              {weekendMode === "plantao" && onCallPer > 0 && (
                <>
                  <p>
                    Plantão: {onCallPer} dupla(s) por fim de semana → cada dupla faz plantão a cada{" "}
                    <b className={styles.mono}>{onCallEvery}</b> fins de semana ({onCallHours}h por plantão).
                  </p>
                  <p className={styles.muted}>
                    6x1: compensação sexta ({hoursSixOne}h) + sábado ({hoursSixOneSat}h) = {Math.round((hoursSixOne + hoursSixOneSat) * 10) / 10}h
                    para {onCallHours}h de plantão.
                  </p>
                  <p className={styles.muted}>
                    5x2: compensação quinta + sexta = {Math.round(hoursFiveTwo * 2 * 10) / 10}h para {onCallHours}h de plantão (saldo{" "}
                    {Math.round((onCallHours - hoursFiveTwo * 2) * 10) / 10}h por plantão).
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Gerador */}
      <section className={styles.section} id="gerador">
        <h2 className={styles.h2}>{editingId ? "Editando escala" : "Gerar nova escala"}</h2>
        <div className={styles.genLayout}>
          <div className={styles.params}>
            <label className={styles.label}>Tipo de escala</label>
            <ToggleGroup type="single" value={scaleType} onValueChange={(v) => v && setScaleType(v as ScaleType)}>
              <ToggleGroupItem value="6x1">6x1</ToggleGroupItem>
              <ToggleGroupItem value="5x2">5x2</ToggleGroupItem>
            </ToggleGroup>

            <label className={styles.label}>Fim de semana</label>
            <ToggleGroup type="single" value={weekendMode} onValueChange={(v) => v && setWeekendMode(v as "plantao" | "rodizio")}>
              <ToggleGroupItem value="plantao">Coberto por plantão</ToggleGroupItem>
              <ToggleGroupItem value="rodizio">Rodízio de folgas</ToggleGroupItem>
            </ToggleGroup>
            <p className={styles.muted}>
              {weekendMode === "plantao"
                ? scaleType === "6x1"
                  ? "Todas as duplas trabalham seg–sáb e folgam domingo; o plantão cobre sábado à tarde e domingo."
                  : "Todas as duplas trabalham seg–sex e folgam sáb+dom; o plantão cobre o fim de semana."
                : "As folgas são espalhadas na semana com rodízio de domingo / fim de semana completo."}
            </p>

            <label className={styles.label}>Mínimo de duplas em campo por dia</label>
            <div className={styles.minGrid}>
              {scheduleEngine.WEEKDAY_SHORT.map((d, i) => (
                <div key={d} className={styles.minCell}>
                  <span className={styles.minDay}>{d}</span>
                  <Input
                    type="number"
                    min={0}
                    max={teamIds.length}
                    value={minCoverage[i]}
                    onChange={(e) => {
                      const next = [...minCoverage];
                      next[i] = Math.max(0, Number(e.target.value) || 0);
                      setMinCoverage(next);
                    }}
                    className={styles.minInput}
                  />
                </div>
              ))}
            </div>

            <div className={styles.twoCol}>
              <div>
                <label className={styles.label}>Máx. dias seguidos</label>
                <Input type="number" min={1} max={13} value={maxConsecutive} onChange={(e) => setMaxConsecutive(Number(e.target.value) || 6)} />
              </div>
              <div>
                <label className={styles.label}>Semanas do ciclo</label>
                <Input type="number" min={1} max={12} value={cycleWeeks} onChange={(e) => setCycleWeeks(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} />
              </div>
              <div>
                <label className={styles.label}>6x1 seg–sex (h/dia)</label>
                <Input type="number" step="0.01" value={hoursSixOne} onChange={(e) => setHoursSixOne(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={styles.label}>6x1 sábado (h)</label>
                <Input type="number" step="0.5" value={hoursSixOneSat} onChange={(e) => setHoursSixOneSat(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={styles.label}>Horas/dia 5x2</label>
                <Input type="number" step="0.01" value={hoursFiveTwo} onChange={(e) => setHoursFiveTwo(Number(e.target.value) || 0)} />
              </div>
              <div>
                <label className={styles.label}>Início do turno</label>
                <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
              </div>
              <div>
                <label className={styles.label}>Fim do turno</label>
                <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
              </div>
            </div>
            <div className={styles.paramActions}>
              <Button onClick={generate} disabled={teamIds.length === 0}>
                <Wand2 size={16} /> Gerar escala {scaleType}
              </Button>
              <Button variant="outline" onClick={saveParams} disabled={saveSettings.isPending}>
                Salvar parâmetros do setor
              </Button>
            </div>
          </div>

          <div className={styles.previewCol}>
            {!preview ? (
              <div className={styles.placeholder}>
                Ajuste os parâmetros e clique em <b>Gerar escala</b>. O algoritmo distribui as folgas para manter o mínimo de duplas em
                cada dia, faz rodízio de domingo (6x1) ou de fim de semana completo (5x2) e respeita o limite de dias seguidos.
              </div>
            ) : (
              <>
                <div className={styles.previewGridWrap}>
                  <table className={styles.previewGrid}>
                    <thead>
                      <tr>
                        <th className={styles.pgSticky} />
                        {Array.from({ length: preview.cycleWeeks * 7 }, (_, d) => (
                          <th key={d} className={`${styles.pgHead} ${d % 7 === 0 ? styles.weekStart : ""} ${d % 7 >= 5 ? styles.weekendCol : ""}`}>
                            {d % 7 === 0 && <span className={styles.weekLabel}>Sem {d / 7 + 1}</span>}
                            {scheduleEngine.WEEKDAY_SHORT[d % 7].slice(0, 1)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map((team) => {
                        const offs = new Map((preview.daysOff[String(team.id)] ?? []).map((o) => [o.day, o.kind]));
                        return (
                          <tr key={team.id}>
                            <td className={styles.pgSticky}>{team.code}</td>
                            {Array.from({ length: preview.cycleWeeks * 7 }, (_, d) => {
                              const kind = offs.get(d);
                              return (
                                <td key={d} className={`${d % 7 === 0 ? styles.weekStart : ""} ${d % 7 >= 5 ? styles.weekendCol : ""}`}>
                                  <DayCell
                                    status={kind === "compensatoria" ? "compensatoria" : kind ? "folga" : "trabalho"}
                                    className={styles.pgCell}
                                    onClick={() =>
                                      setPreview({ ...preview, daysOff: scheduleEngine.toggleOff(preview.daysOff, team.id, d) })
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      <tr className={styles.pgCov}>
                        <td className={styles.pgSticky}>Campo</td>
                        {coverage.map((c, d) => (
                          <td key={d} className={`${c < effMinCoverage[d % 7] ? styles.bad : styles.good} ${d % 7 === 0 ? styles.weekStart : ""}`}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className={styles.muted}>Clique numa célula para trocar trabalho ↔ folga. A escala se repete a cada {preview.cycleWeeks} semanas.</p>

                {previewMetrics && (
                  <div className={styles.metrics}>
                    <div className={styles.metric}>
                      <span className={styles.metricVal}>{previewMetrics.weeklyHours}h</span>
                      <span className={styles.metricLabel}>por semana</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricVal}>{previewMetrics.offDaysPerMonth}</span>
                      <span className={styles.metricLabel}>folgas/mês</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricVal}>{previewMetrics.sundaysOffPerCycle}</span>
                      <span className={styles.metricLabel}>domingos livres/ciclo</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={`${styles.metricVal} ${previewMetrics.maxConsecutiveFound > maxConsecutive ? styles.bad : ""}`}>
                        {previewMetrics.maxConsecutiveFound}
                      </span>
                      <span className={styles.metricLabel}>máx. dias seguidos</span>
                    </div>
                    <div className={styles.metric}>
                      <span className={`${styles.metricVal} ${previewMetrics.daysBelowMin > 0 ? styles.bad : ""}`}>{previewMetrics.daysBelowMin}</span>
                      <span className={styles.metricLabel}>dias abaixo do mínimo</span>
                    </div>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <ul className={styles.warnings}>
                    {preview.warnings.map((w, i) => (
                      <li key={i}>
                        <AlertTriangle size={14} /> {w}
                      </li>
                    ))}
                  </ul>
                )}

                <div className={styles.saveBox}>
                  <div className={styles.saveFields}>
                    <div>
                      <label className={styles.label}>Nome da escala</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div>
                      <label className={styles.label}>Começa em (segunda-feira)</label>
                      <DateField value={startDate} onChange={setStartDate} mondaysOnly />
                    </div>
                  </div>
                  <div className={styles.paramActions}>
                    {editingId && (
                      <Button onClick={() => save(false)} disabled={savePattern.isPending}>
                        <Save size={16} /> Atualizar escala
                      </Button>
                    )}
                    <Button variant={editingId ? "outline" : "primary"} onClick={() => save(true)} disabled={savePattern.isPending}>
                      <Save size={16} /> Salvar como nova escala
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Escalas cadastradas */}
      <section className={styles.section}>
        <h2 className={styles.h2}>Escalas cadastradas</h2>
        <p className={styles.muted}>Em cada data vale a escala do setor com o início mais recente. Programe a 5x2 para a data da transição.</p>
        <div className={styles.patternList}>
          {!data && <Skeleton className={styles.skel} />}
          {data?.patterns
            .slice()
            .sort((a, b) => a.sector.localeCompare(b.sector) || a.startDate.localeCompare(b.startDate))
            .map((p) => {
              const st = patternStatus(p);
              return (
                <div key={p.id} className={styles.patternRow}>
                  <span className={styles.patternScale}>{p.scaleType}</span>
                  <div className={styles.patternInfo}>
                    <div className={styles.patternName}>{p.name}</div>
                    <div className={styles.muted}>
                      {labels.sector[p.sector]} · início {scheduleEngine.formatDate(p.startDate)} · ciclo de {p.cycleWeeks} semana(s)
                    </div>
                  </div>
                  <Badge variant={st.variant}>{st.label}</Badge>
                  <Button variant="ghost" size="icon-md" onClick={() => loadPattern(p)} aria-label="Editar escala">
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label="Excluir escala"
                    onClick={() => {
                      if (window.confirm(`Excluir a escala "${p.name}"?`)) deletePattern.mutate({ id: p.id });
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
          {data && data.patterns.length === 0 && <p className={styles.muted}>Nenhuma escala cadastrada ainda.</p>}
        </div>
      </section>
    </div>
  );
}
