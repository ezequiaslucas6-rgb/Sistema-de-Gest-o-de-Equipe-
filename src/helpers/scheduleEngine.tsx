/**
 * Motor de escalas: gera ciclos de folga 6x1 / 5x2 respeitando cobertura mínima
 * por dia da semana, limite de dias consecutivos e rodízio de domingo / fim de semana.
 * Todas as datas são strings "YYYY-MM-DD" tratadas em UTC para evitar problemas de fuso.
 */

export type Sector = "suporte" | "infraestrutura";
export type ScaleType = "6x1" | "5x2";
export type OffKind = "regular" | "compensatoria";
export type PatternOff = { day: number; kind: OffKind };
/** Chave = id da equipe (string). day = índice dentro do ciclo (0 = segunda da semana 1). */
export type PatternDays = Record<string, PatternOff[]>;

export type DayStatus =
  | "trabalho"
  | "plantao"
  | "folga"
  | "folga_plantao"
  | "feriado"
  | "compensatoria"
  | "desfalcada"
  | "ausente"
  | "viagem"
  | "sem_escala";

export interface PatternLike {
  id: number;
  sector: Sector;
  scaleType: ScaleType;
  startDate: string;
  cycleWeeks: number;
  daysOff: PatternDays;
}

export interface AbsenceLike {
  id: number;
  technicianId: number;
  startDate: string;
  endDate: string;
  kind: string;
}

export interface TeamLike {
  id: number;
  sector: Sector;
  memberIds: number[];
}

export interface OnCallLike {
  id: number;
  teamId: number;
  /** sábado do fim de semana de plantão */
  weekendStart: string;
  /** dias de folga para compensar (padrão: sexta e sábado seguintes) */
  compDates: string[];
}

export interface HolidayLike {
  id: number;
  date: string;
  name: string;
  /** true = folga geral (escala base não trabalha); false = só marcação (ex.: ponto facultativo trabalhado) */
  dayOff: boolean;
  /** duplas escaladas de plantão no feriado */
  onCallTeamIds: number[];
  onCallHours: string;
  /** folga de quem fez plantão no feriado (padrão: próximo dia útil) */
  compDate: string | null;
}

export interface TripLike {
  id: number;
  technicianIds: number[];
  /** "YYYY-MM-DDTHH:MM" */
  departAt: string;
  /** retorno previsto */
  returnAt: string;
  /** retorno real, quando já voltou */
  returnedAt: string | null;
  destination?: string;
  /** diária: null/undefined = automática pelo destino, true = sempre, false = nunca */
  perDiem?: boolean | null;
}

export interface TripSettingsLike {
  /** valor da diária cheia (por pernoite) */
  fullValue: number;
  /** valor da meia diária */
  halfValue: number;
  /** horas mínimas fora para ganhar meia diária quando volta no mesmo dia */
  minHoursHalf: number;
  /** o dia do retorno, após pernoite, conta como meia diária */
  halfOnReturn: boolean;
  /** destinos (sentido) que geram diária; lista vazia = todas as viagens geram */
  paidDestinations?: string[];
}

export interface TripAllowance {
  /** pernoites */
  nights: number;
  /** horas fora */
  hours: number;
  full: number;
  half: number;
  /** valor por técnico */
  perTechnician: number;
  /** valor total da viagem (todos os técnicos) */
  total: number;
  /** a viagem gera diária (destino da lista ou marcada manualmente) */
  eligible: boolean;
}

export interface GenerateInput {
  teamIds: number[];
  scaleType: ScaleType;
  /** 7 posições, 0 = segunda ... 6 = domingo */
  minCoverage: number[];
  maxConsecutive: number;
  cycleWeeks?: number;
  /**
   * "rodizio": folgas distribuídas na semana com rodízio de domingo/fim de semana.
   * "plantao": folga fixa no fim de semana (6x1 = domingo, 5x2 = sábado + domingo) e o
   * fim de semana é coberto pelo rodízio de plantão.
   */
  weekendMode?: "rodizio" | "plantao";
}

export interface GenerateResult {
  cycleWeeks: number;
  daysOff: PatternDays;
  warnings: string[];
}

export interface PatternMetrics {
  workDaysPerWeek: number;
  weeklyHours: number;
  offDaysPerMonth: number;
  sundaysOffPerCycle: number;
  weekendsOffPerCycle: number;
  compensatoryPerCycle: number;
  avgCoverageByWeekday: number[];
  minCoverageByWeekday: number[];
  daysBelowMin: number;
  maxConsecutiveFound: number;
}

export interface ResolvedDay {
  status: DayStatus;
  pattern: PatternLike | null;
  absentMemberIds: number[];
  availableMemberIds: number[];
  onCall: OnCallLike | null;
  holiday: HolidayLike | null;
  trip: TripLike | null;
}

const DAY_MS = 86400000;
const WEEKDAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const WEEKDAY_LONG = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}

function diffDays(a: string, b: string): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}

/** 0 = segunda ... 6 = domingo */
function weekdayIndex(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}

function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function generatePattern(input: GenerateInput): GenerateResult {
  const { teamIds, scaleType, minCoverage, maxConsecutive } = input;
  const n = teamIds.length;
  const warnings: string[] = [];
  if (n === 0) {
    return { cycleWeeks: 1, daysOff: {}, warnings: ["Nenhuma equipe no setor."] };
  }
  if (input.weekendMode === "plantao") {
    // folga fixa no fim de semana para todas as duplas; plantão cobre sáb à tarde e domingo
    const offIdx = scaleType === "5x2" ? [5, 6] : [6];
    const daysOff: PatternDays = {};
    for (const t of teamIds) daysOff[String(t)] = offIdx.map((day) => ({ day, kind: "regular" as OffKind }));
    for (let d = 0; d < 5; d++) {
      if (n < minCoverage[d]) {
        warnings.push(`${WEEKDAY_LONG[d]}: só ${n} dupla(s) no setor (mínimo ${minCoverage[d]}).`);
      }
    }
    return { cycleWeeks: 1, daysOff, warnings };
  }
  const weeks = Math.max(1, input.cycleWeeks ?? n);
  const totalDays = weeks * 7;
  const coverage = new Array<number>(totalDays).fill(n);
  const off = new Map<number, Map<number, OffKind>>();
  teamIds.forEach((t) => off.set(t, new Map()));
  const lastOff = new Map<number, number>();
  teamIds.forEach((t) => lastOff.set(t, -1));

  const slack = (day: number) => coverage[day] - 1 - minCoverage[day % 7];
  const take = (team: number, day: number, kind: OffKind = "regular") => {
    const teamOff = off.get(team)!;
    if (teamOff.has(day)) return;
    teamOff.set(day, kind);
    coverage[day] -= 1;
    lastOff.set(team, Math.max(lastOff.get(team)!, day));
  };

  const candidatesFor = (base: number): number[][] => {
    const list: number[][] = [];
    if (scaleType === "5x2") {
      for (let a = 0; a < 7; a++) {
        for (let b = a + 1; b < 7; b++) {
          if (a === 5 && b === 6) continue; // fim de semana completo é do rodízio
          list.push([base + a, base + b]);
        }
      }
    } else {
      for (let d = 0; d < 7; d++) list.push([base + d]);
    }
    return list;
  };

  // Pontua uma combinação de folgas da semana: limite de dias seguidos > cobertura > equilíbrio
  const scoreCombo = (
    assign: Array<[number, number[]]>,
    nextRot: number,
    nextRotDay: number,
  ): number => {
    const delta = new Map<number, number>();
    let score = 0;
    for (const [team, days] of assign) {
      const gap = days[0] - lastOff.get(team)! - 1;
      if (gap > maxConsecutive) score -= 10000 * (gap - maxConsecutive);
      // olha a semana seguinte: se a equipe pega o rodízio, evita sequência longa até lá
      if (team === nextRot) {
        const gapNext = nextRotDay - days[days.length - 1] - 1;
        if (gapNext > maxConsecutive) score -= 400 * (gapNext - maxConsecutive);
      }
      if (days.length === 2 && days[1] - days[0] !== 1) score -= 30; // prefere folgas emendadas
      score += (days[days.length - 1] % 7) * 0.5; // folga mais tarde reduz risco na semana seguinte
      for (const d of days) delta.set(d, (delta.get(d) ?? 0) + 1);
    }
    for (const [d, k] of delta) {
      const s = coverage[d] - k - minCoverage[d % 7];
      if (s < 0) score += s * 1000;
      score -= k * k * 2; // evita concentrar folgas no mesmo dia
    }
    return score;
  };

  const runWeeks = () => {
    for (let w = 0; w < weeks; w++) {
      const base = w * 7;
      const rotTeam = teamIds[w % n];
      // Rodízio: uma equipe por semana ganha o domingo (6x1) ou o fim de semana completo (5x2)
      if (scaleType === "5x2") {
        take(rotTeam, base + 5);
        take(rotTeam, base + 6);
      } else {
        take(rotTeam, base + 6);
      }
      const others = teamIds
        .map((_, i) => teamIds[(w + 1 + i) % n])
        .filter((t) => t !== rotTeam);
      const cands = candidatesFor(base);
      const nextRot = teamIds[(w + 1) % n];
      const nextRotDay = base + 7 + (scaleType === "5x2" ? 5 : 6);
      const combos = Math.pow(cands.length, others.length);
      if (combos <= 60000) {
        // busca exaustiva da melhor combinação para a semana
        let best: Array<[number, number[]]> = [];
        let bestScore = -Infinity;
        const cur: Array<[number, number[]]> = [];
        const rec = (i: number) => {
          if (i === others.length) {
            const s = scoreCombo(cur, nextRot, nextRotDay);
            if (s > bestScore) {
              bestScore = s;
              best = cur.map(([t, d]) => [t, d]);
            }
            return;
          }
          for (const c of cands) {
            cur.push([others[i], c]);
            rec(i + 1);
            cur.pop();
          }
        };
        rec(0);
        best.forEach(([t, days]) => days.forEach((d) => take(t, d)));
      } else {
        // muitas equipes: escolha gulosa equipe a equipe
        for (const team of others) {
          let best = cands[0];
          let bestScore = -Infinity;
          for (const c of cands) {
            const s = scoreCombo([[team, c]], nextRot, nextRotDay);
            if (s > bestScore) {
              bestScore = s;
              best = c;
            }
          }
          best.forEach((d) => take(team, d));
        }
      }
    }
  };

  // 1ª passada só para descobrir a última folga de cada equipe e considerar a virada do ciclo
  runWeeks();
  const wrapLast = new Map(lastOff);
  teamIds.forEach((t) => {
    off.get(t)!.clear();
    lastOff.set(t, wrapLast.get(t)! - totalDays);
  });
  coverage.fill(n);
  runWeeks();

  // Reparo cíclico: garante que nenhuma sequência de trabalho passe do limite (inclusive na virada do ciclo)
  let compensatory = 0;
  for (const team of teamIds) {
    const teamOff = off.get(team)!;
    let guard = 0;
    let changed = true;
    while (changed && guard++ < totalDays) {
      changed = false;
      const offDays = [...teamOff.keys()].sort((a, b) => a - b);
      if (offDays.length === 0) {
        take(team, 6, "compensatoria");
        compensatory++;
        changed = true;
        continue;
      }
      for (let i = 0; i < offDays.length; i++) {
        const cur = offDays[i];
        const next = i + 1 < offDays.length ? offDays[i + 1] : offDays[0] + totalDays;
        const run = next - cur - 1;
        if (run > maxConsecutive) {
          // escolhe dia dentro da janela permitida com maior folga de cobertura (preferindo o mais tarde)
          let pick = cur + maxConsecutive + 1;
          let pickScore = -Infinity;
          for (let d = cur + 1; d <= cur + maxConsecutive + 1; d++) {
            const real = d % totalDays;
            const s = slack(real) * 10 + (d - cur) * 0.5;
            if (s > pickScore) {
              pickScore = s;
              pick = d;
            }
          }
          take(team, pick % totalDays, "compensatoria");
          compensatory++;
          changed = true;
          break;
        }
      }
    }
  }
  if (compensatory > 0) {
    warnings.push(
      `${compensatory} folga(s) compensatória(s) adicionada(s) para respeitar o limite de ${maxConsecutive} dias seguidos de trabalho.`,
    );
  }

  for (let d = 0; d < totalDays; d++) {
    if (coverage[d] < minCoverage[d % 7]) {
      warnings.push(
        `Semana ${Math.floor(d / 7) + 1}, ${WEEKDAY_LONG[d % 7]}: ${coverage[d]} equipe(s) em campo (mínimo ${minCoverage[d % 7]}).`,
      );
    }
  }

  const daysOff: PatternDays = {};
  for (const team of teamIds) {
    daysOff[String(team)] = [...off.get(team)!.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, kind]) => ({ day, kind }));
  }
  return { cycleWeeks: weeks, daysOff, warnings };
}

function patternCoverage(daysOff: PatternDays, teamIds: number[], cycleWeeks: number): number[] {
  const total = cycleWeeks * 7;
  const cov = new Array<number>(total).fill(teamIds.length);
  for (const t of teamIds) {
    for (const o of daysOff[String(t)] ?? []) {
      if (o.day < total) cov[o.day] -= 1;
    }
  }
  return cov;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function computeMetrics(
  daysOff: PatternDays,
  teamIds: number[],
  cycleWeeks: number,
  minCoverage: number[],
  /** horas por dia trabalhado; ou 7 valores (seg..dom) quando o sábado é meio período */
  hoursPerDay: number | number[],
): PatternMetrics {
  const total = cycleWeeks * 7;
  const n = Math.max(teamIds.length, 1);
  const hoursByWd = Array.isArray(hoursPerDay) ? hoursPerDay : new Array<number>(7).fill(hoursPerDay);
  let workedHours = 0;
  let offCount = 0;
  let sundays = 0;
  let weekends = 0;
  let comp = 0;
  let maxRun = 0;
  for (const t of teamIds) {
    const list = (daysOff[String(t)] ?? []).filter((o) => o.day < total);
    const set = new Set(list.map((o) => o.day));
    for (let d = 0; d < total; d++) if (!set.has(d)) workedHours += hoursByWd[d % 7];
    offCount += list.length;
    comp += list.filter((o) => o.kind === "compensatoria").length;
    for (let w = 0; w < cycleWeeks; w++) {
      if (set.has(w * 7 + 6)) sundays++;
      if (set.has(w * 7 + 5) && set.has(w * 7 + 6)) weekends++;
    }
    // maior sequência de trabalho (cíclica)
    let run = 0;
    for (let i = 0; i < total * 2; i++) {
      if (set.has(i % total)) run = 0;
      else run++;
      maxRun = Math.max(maxRun, Math.min(run, total));
    }
  }
  const cov = patternCoverage(daysOff, teamIds, cycleWeeks);
  const avgByWd = new Array<number>(7).fill(0);
  const minByWd = new Array<number>(7).fill(Infinity);
  let below = 0;
  cov.forEach((c, d) => {
    avgByWd[d % 7] += c / cycleWeeks;
    minByWd[d % 7] = Math.min(minByWd[d % 7], c);
    if (c < minCoverage[d % 7]) below++;
  });
  const offPerTeamPerWeek = offCount / n / cycleWeeks;
  const workDays = 7 - offPerTeamPerWeek;
  return {
    workDaysPerWeek: round1(workDays),
    weeklyHours: round1(workedHours / n / cycleWeeks),
    offDaysPerMonth: round1(offPerTeamPerWeek * (30 / 7)),
    sundaysOffPerCycle: round1(sundays / n),
    weekendsOffPerCycle: round1(weekends / n),
    compensatoryPerCycle: comp,
    avgCoverageByWeekday: avgByWd.map(round1),
    minCoverageByWeekday: minByWd.map((v) => (v === Infinity ? 0 : v)),
    daysBelowMin: below,
    maxConsecutiveFound: maxRun,
  };
}

/** Escala vigente do setor na data (a de maior data de início <= data). */
function patternForDate<P extends PatternLike>(patterns: P[], sector: Sector, date: string): P | null {
  let found: P | null = null;
  for (const p of patterns) {
    if (p.sector !== sector) continue;
    if (p.startDate > date) continue;
    if (!found || p.startDate > found.startDate) found = p;
  }
  return found;
}

function cycleDayIndex(pattern: PatternLike, date: string): number {
  const total = pattern.cycleWeeks * 7;
  const diff = diffDays(date, pattern.startDate);
  return ((diff % total) + total) % total;
}

function isAbsent<A extends AbsenceLike>(absences: A[], technicianId: number, date: string): A | null {
  for (const a of absences) {
    if (a.technicianId === technicianId && a.startDate <= date && a.endDate >= date) return a;
  }
  return null;
}

function resolveTeamDay(
  team: TeamLike,
  date: string,
  patterns: PatternLike[],
  absences: AbsenceLike[],
  onCall: OnCallLike[] = [],
  holidays: HolidayLike[] = [],
  trips: TripLike[] = [],
): ResolvedDay {
  const pattern = patternForDate(patterns, team.sector, date);
  const absentMemberIds = team.memberIds.filter((m) => isAbsent(absences, m, date));
  const availableMemberIds = team.memberIds.filter((m) => !absentMemberIds.includes(m));
  const holiday = holidays.find((h) => h.date === date) ?? null;
  const base = { pattern, absentMemberIds, availableMemberIds, holiday, trip: null as TripLike | null };
  // viagem: a dupla inteira fora da base sai da cobertura local; só um técnico viajando deixa a dupla desfalcada
  const traveling = team.memberIds.filter((m) => tripForTechnician(trips, m, date));
  if (traveling.length > 0) {
    const trip = tripForTechnician(trips, traveling[0], date);
    const away = new Set([...absentMemberIds, ...traveling]);
    const remaining = team.memberIds.filter((m) => !away.has(m));
    if (remaining.length === 0) {
      return { ...base, trip, status: "viagem", absentMemberIds: [...away], availableMemberIds: [], onCall: null };
    }
    return { ...base, trip, status: "desfalcada", absentMemberIds: [...away], availableMemberIds: remaining, onCall: null };
  }
  // plantão de fim de semana tem prioridade sobre a escala base
  const shift = onCall.find(
    (s) => s.teamId === team.id && (s.weekendStart === date || addDays(s.weekendStart, 1) === date),
  );
  if (shift) {
    if (team.memberIds.length > 0 && availableMemberIds.length === 0) return { ...base, status: "ausente", onCall: shift };
    if (absentMemberIds.length > 0) return { ...base, status: "desfalcada", onCall: shift };
    return { ...base, status: "plantao", onCall: shift };
  }
  // plantão de feriado
  if (holiday && holiday.onCallTeamIds.includes(team.id)) {
    if (team.memberIds.length > 0 && availableMemberIds.length === 0) return { ...base, status: "ausente", onCall: null };
    if (absentMemberIds.length > 0) return { ...base, status: "desfalcada", onCall: null };
    return { ...base, status: "plantao", onCall: null };
  }
  // folga de compensação do plantão de feriado
  if (holidays.some((h) => h.compDate === date && h.onCallTeamIds.includes(team.id))) {
    return { ...base, status: "folga_plantao", onCall: null };
  }
  if (holiday?.dayOff) return { ...base, status: "feriado", onCall: null };
  const comp = onCall.find((s) => s.teamId === team.id && s.compDates.includes(date));
  if (comp) return { ...base, status: "folga_plantao", onCall: comp };
  if (!pattern) return { ...base, status: "sem_escala", onCall: null };
  const idx = cycleDayIndex(pattern, date);
  const offEntry = (pattern.daysOff[String(team.id)] ?? []).find((o) => o.day === idx);
  if (offEntry) {
    return {
      ...base,
      status: offEntry.kind === "compensatoria" ? "compensatoria" : "folga",
      onCall: null,
    };
  }
  if (team.memberIds.length > 0 && availableMemberIds.length === 0) {
    return { ...base, status: "ausente", onCall: null };
  }
  if (absentMemberIds.length > 0 || team.memberIds.length < 2) {
    return { ...base, status: "desfalcada", onCall: null };
  }
  return { ...base, status: "trabalho", onCall: null };
}

/** Dia de trabalho pela escala base (sem considerar plantão e ausências). */
function isBaseWorkday(teamId: number, sector: Sector, date: string, patterns: PatternLike[], holidays: HolidayLike[] = []): boolean {
  if (holidays.some((h) => h.date === date && h.dayOff)) return false;
  const pattern = patternForDate(patterns, sector, date);
  if (!pattern) return false;
  const idx = cycleDayIndex(pattern, date);
  return !(pattern.daysOff[String(teamId)] ?? []).some((o) => o.day === idx);
}

/** "08:00-12:00,14:00-18:00" -> 8 */
function parseHours(ranges: string): number {
  let total = 0;
  for (const part of ranges.split(",")) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    if (end > start) total += (end - start) / 60;
  }
  return round1(total);
}

export interface OnCallGenerateInput {
  teamIds: number[];
  /** primeiro sábado do rodízio */
  firstSaturday: string;
  weekends: number;
  perWeekend: number;
  /** plantões já existentes (para continuar o rodízio de forma justa) */
  history: OnCallLike[];
  /** true se a dupla não pode pegar o plantão naquele fim de semana (ausência, etc.) */
  isUnavailable: (teamId: number, saturday: string) => boolean;
  /** dias de compensação do plantão que começa no sábado informado */
  compDatesFor?: (saturday: string) => string[];
}

/**
 * Regra de compensação do plantão, conforme a escala vigente na semana seguinte:
 * 6x1 → sexta + sábado seguintes; 5x2 → quinta + sexta seguintes (sábado já é folga).
 */
function defaultCompDates(saturday: string, sector: Sector, patterns: PatternLike[], holidays: HolidayLike[] = []): string[] {
  const nextFriday = addDays(saturday, 6);
  const pattern = patternForDate(patterns, sector, nextFriday);
  const base = pattern?.scaleType === "5x2" ? [addDays(saturday, 5), nextFriday] : [nextFriday, addDays(saturday, 7)];
  // folga que cair em feriado (já é folga) passa para o próximo dia útil
  const isHoliday = (d: string) => holidays.some((h) => h.date === d && h.dayOff);
  // domingo nunca é dia útil; no 5x2 o sábado também não
  const notWorkday = (d: string) => {
    const wd = weekdayIndex(d);
    return wd === 6 || (wd === 5 && pattern?.scaleType === "5x2") || isHoliday(d);
  };
  const out: string[] = [];
  for (const d of base) {
    let cur = d;
    let guard = 0;
    while ((notWorkday(cur) || out.includes(cur)) && guard++ < 14) cur = addDays(cur, 1);
    out.push(cur);
  }
  return out.sort();
}

/** Folga de quem trabalha no feriado: próximo dia útil da escala base (6x1 inclui sábado). */
function holidayCompDate(holidayDate: string, sector: Sector, patterns: PatternLike[], holidays: HolidayLike[] = []): string {
  let d = addDays(holidayDate, 1);
  for (let guard = 0; guard < 14; guard++) {
    const wd = weekdayIndex(d);
    const pattern = patternForDate(patterns, sector, d);
    const isHoliday = holidays.some((h) => h.date === d && h.dayOff);
    const off = wd === 6 || (wd === 5 && pattern?.scaleType !== "6x1") || isHoliday;
    if (!off) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Rodízio justo: quem tem menos plantões vai primeiro, sem repetir fins de semana seguidos. */
function generateOnCall(input: OnCallGenerateInput): { teamId: number; weekendStart: string; compDates: string[] }[] {
  const { teamIds, firstSaturday, weekends, perWeekend, history, isUnavailable } = input;
  const count = new Map(teamIds.map((t) => [t, 0]));
  const last = new Map<number, string>();
  for (const h of history) {
    if (!count.has(h.teamId) || h.weekendStart >= firstSaturday) continue;
    count.set(h.teamId, count.get(h.teamId)! + 1);
    if (!last.has(h.teamId) || last.get(h.teamId)! < h.weekendStart) last.set(h.teamId, h.weekendStart);
  }
  const out: { teamId: number; weekendStart: string; compDates: string[] }[] = [];
  const per = Math.min(perWeekend, teamIds.length);
  for (let w = 0; w < weekends; w++) {
    const sat = addDays(firstSaturday, w * 7);
    const prevSat = addDays(sat, -7);
    const ranked = [...teamIds].sort((a, b) => {
      const score = (t: number) =>
        count.get(t)! * 10 +
        (last.get(t) === prevSat ? 100 : 0) + // evita fim de semana seguido (está compensando)
        (isUnavailable(t, sat) ? 1000 : 0);
      const diff = score(a) - score(b);
      if (diff !== 0) return diff;
      return (last.get(a) ?? "").localeCompare(last.get(b) ?? ""); // quem fez há mais tempo
    });
    for (const t of ranked.slice(0, per)) {
      out.push({ teamId: t, weekendStart: sat, compDates: input.compDatesFor?.(sat) ?? [addDays(sat, 6), addDays(sat, 7)] });
      count.set(t, count.get(t)! + 1);
      last.set(t, sat);
    }
  }
  return out;
}

export interface HourBankRow {
  teamId: number;
  shifts: number;
  holidayShifts: number;
  credit: number;
  debit: number;
  balance: number;
  /** dias de compensação que já eram folga na escala base (não abatem horas) */
  wastedCompDays: number;
}

/** Banco de horas por dupla: plantão credita horas, dia de compensação que seria trabalhado debita. */
function computeHourBank(params: {
  teams: { id: number; sector: Sector }[];
  shifts: OnCallLike[];
  patterns: PatternLike[];
  holidays?: HolidayLike[];
  onCallHours: (sector: Sector) => number;
  hoursPerDay: (sector: Sector, scaleType: ScaleType, date: string) => number;
  until?: string;
}): HourBankRow[] {
  const holidays = params.holidays ?? [];
  return params.teams.map((team) => {
    let credit = 0;
    let debit = 0;
    let wasted = 0;
    let shifts = 0;
    let holidayShifts = 0;
    for (const h of holidays) {
      if (!h.onCallTeamIds.includes(team.id)) continue;
      if (params.until && h.date > params.until) continue;
      holidayShifts++;
      credit += parseHours(h.onCallHours);
      if (h.compDate) {
        const pattern = patternForDate(params.patterns, team.sector, h.compDate);
        if (pattern && isBaseWorkday(team.id, team.sector, h.compDate, params.patterns, holidays)) {
          debit += params.hoursPerDay(team.sector, pattern.scaleType, h.compDate);
        } else {
          wasted++;
        }
      }
    }
    for (const s of params.shifts) {
      if (s.teamId !== team.id) continue;
      if (!params.until || s.weekendStart <= params.until) {
        shifts++;
        credit += params.onCallHours(team.sector);
      }
      for (const d of s.compDates) {
        if (params.until && d > params.until) continue;
        const pattern = patternForDate(params.patterns, team.sector, d);
        if (pattern && isBaseWorkday(team.id, team.sector, d, params.patterns, holidays)) {
          debit += params.hoursPerDay(team.sector, pattern.scaleType, d);
        } else {
          wasted++;
        }
      }
    }
    return {
      teamId: team.id,
      shifts,
      holidayShifts,
      credit: round1(credit),
      debit: round1(debit),
      balance: round1(credit - debit),
      wastedCompDays: wasted,
    };
  });
}

/** Domingo de Páscoa (algoritmo de Meeus/Butcher). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type NationalHoliday = { date: string; name: string; kind: "nacional" | "ponto_facultativo"; dayOff: boolean };

/** Feriados nacionais do Brasil + pontos facultativos federais mais comuns. */
function brazilNationalHolidays(year: number): NationalHoliday[] {
  const e = easter(year);
  const fixed: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Dia Nacional de Zumbi e da Consciência Negra"],
    ["12-25", "Natal"],
  ];
  const list: NationalHoliday[] = fixed.map(([md, name]) => ({ date: `${year}-${md}`, name, kind: "nacional", dayOff: true }));
  list.push({ date: addDays(e, -2), name: "Sexta-feira Santa", kind: "nacional", dayOff: true });
  list.push({ date: addDays(e, -48), name: "Carnaval (segunda)", kind: "ponto_facultativo", dayOff: false });
  list.push({ date: addDays(e, -47), name: "Carnaval (terça)", kind: "ponto_facultativo", dayOff: false });
  list.push({ date: addDays(e, 60), name: "Corpus Christi", kind: "ponto_facultativo", dayOff: false });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Data (YYYY-MM-DD) do retorno efetivo: real se já voltou, senão o previsto. */
function tripEnd(trip: TripLike): string {
  return trip.returnedAt ?? trip.returnAt;
}

/** Viagem em que o técnico está fora da base na data (do dia da saída ao dia do retorno). */
function tripForTechnician<T extends TripLike>(trips: T[], technicianId: number, date: string): T | null {
  for (const t of trips) {
    if (!t.technicianIds.includes(technicianId)) continue;
    if (t.departAt.slice(0, 10) <= date && tripEnd(t).slice(0, 10) >= date) return t;
  }
  return null;
}

function minutesOf(dt: string): number {
  const [d, time = "00:00"] = dt.split("T");
  const [h, m] = time.split(":").map(Number);
  return (toUtc(d) / 60000) + h * 60 + m;
}

/**
 * Diárias de uma viagem, por técnico:
 * - cada pernoite = 1 diária cheia;
 * - com pernoite, o dia do retorno vale meia diária (se configurado);
 * - sem pernoite, meia diária quando ficou fora pelo menos as horas mínimas.
 */
/** Texto sem acento e em minúsculas, para comparar destinos ("Rondolândia" = "rondolandia"). */
function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** A viagem gera diária? Marcação manual vence; senão, o destino precisa citar um dos destinos da lista. */
function tripEligible(trip: TripLike, settings: TripSettingsLike): boolean {
  if (trip.perDiem === true || trip.perDiem === false) return trip.perDiem;
  const list = settings.paidDestinations ?? [];
  if (list.length === 0) return true;
  const dest = normalizeText(trip.destination ?? "");
  return list.some((d) => normalizeText(d) && dest.includes(normalizeText(d)));
}

function tripAllowance(trip: TripLike, settings: TripSettingsLike): TripAllowance {
  const end = tripEnd(trip);
  const eligible = tripEligible(trip, settings);
  const hours = Math.max(0, (minutesOf(end) - minutesOf(trip.departAt)) / 60);
  const nights = Math.max(0, diffDays(end.slice(0, 10), trip.departAt.slice(0, 10)));
  let full = 0;
  let half = 0;
  if (nights > 0) {
    full = nights;
    if (settings.halfOnReturn) half = 1;
  } else if (hours >= settings.minHoursHalf) {
    half = 1;
  }
  if (!eligible) {
    full = 0;
    half = 0;
  }
  const perTechnician = round2(full * settings.fullValue + half * settings.halfValue);
  return {
    nights,
    hours: round1(hours),
    full,
    half,
    perTechnician,
    total: round2(perTechnician * trip.technicianIds.length),
    eligible,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function formatMoney(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Alterna folga de uma equipe num dia do ciclo (edição manual da escala). */
function toggleOff(daysOff: PatternDays, teamId: number, day: number): PatternDays {
  const key = String(teamId);
  const list = daysOff[key] ?? [];
  const exists = list.some((o) => o.day === day);
  const next = exists
    ? list.filter((o) => o.day !== day)
    : [...list, { day, kind: "regular" as OffKind }].sort((a, b) => a.day - b.day);
  return { ...daysOff, [key]: next };
}

export const scheduleEngine = {
  WEEKDAY_SHORT,
  WEEKDAY_LONG,
  generatePattern,
  computeMetrics,
  patternCoverage,
  patternForDate,
  cycleDayIndex,
  resolveTeamDay,
  isBaseWorkday,
  parseHours,
  generateOnCall,
  defaultCompDates,
  holidayCompDate,
  computeHourBank,
  brazilNationalHolidays,
  toggleOff,
  isAbsent,
  addDays,
  diffDays,
  weekdayIndex,
  mondayOf,
  todayIso,
  formatDate,
  tripForTechnician,
  tripAllowance,
  tripEligible,
  normalizeText,
  tripEnd,
  formatMoney,
};

