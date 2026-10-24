import type { OutputType } from "../endpoints/data_GET.schema";
import { scheduleEngine, Sector } from "./scheduleEngine";
import { labels } from "./labels";

/**
 * Motor de plantão: gera o rodízio de fim de semana dos dois setores, os plantões de feriado
 * e as folgas de compensação (banco de horas) até o fim da escala 6x1.
 *
 * Regras:
 * - 1 dupla por setor por fim de semana, em rodízio fixo (ordem cadastrada), começando pela dupla escolhida.
 * - Quem faz o plantão folga sexta + sábado da semana seguinte (6x1); domingo já é folga e não conta.
 *   Se a semana seguinte já for 5x2, a folga vira quinta + sexta.
 * - Feriado em dia de semana: faz o plantão a dupla do fim de semana da mesma semana
 *   (feriado na segunda: fim de semana anterior, "emenda", ou seguinte — configurável)
 *   e folga no próximo dia útil.
 * - Dupla com técnico ausente (férias, atestado, viagem) no plantão troca com a próxima da fila,
 *   que devolve a vez no fim de semana seguinte.
 */

export type MondayRule = "anterior" | "seguinte";

export interface MotorInput {
  data: OutputType;
  /** primeiro sábado do rodízio */
  from: string;
  /** último dia da escala 6x1 (inclusive) */
  to: string;
  order: Record<Sector, number[]>;
  /** dupla que abre o rodízio em cada setor */
  startTeam: Record<Sector, number | null>;
  mondayRule: MondayRule;
  respectAbsences: boolean;
}

export interface MotorShift {
  sector: Sector;
  saturday: string;
  teamId: number;
  compDates: string[];
  /** troca automática: dupla que deveria estar e o motivo */
  swap?: { expectedTeamId: number; reason: string };
}

export interface MotorHoliday {
  holidayId: number;
  date: string;
  name: string;
  teamIds: number[];
  compDate: string | null;
  note?: string;
}

export interface MotorBank {
  teamId: number;
  sector: Sector;
  shifts: number;
  holidays: number;
  credit: number;
  debit: number;
  balance: number;
  dates: string[];
}

export interface MotorResult {
  saturdays: string[];
  shifts: MotorShift[];
  holidays: MotorHoliday[];
  bank: MotorBank[];
  warnings: string[];
  /** setores sem escala 6x1 cadastrada que cubra o início do período */
  missingBase: Sector[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Primeiro sábado em ou depois da data (o fim de semana em andamento conta a partir do sábado). */
export function saturdayOnOrBefore(date: string) {
  const wd = scheduleEngine.weekdayIndex(date);
  return wd === 6 ? scheduleEngine.addDays(date, -1) : scheduleEngine.addDays(date, 5 - wd);
}

/** Último dia da escala 6x1: véspera do primeiro 5x2 cadastrado depois de `from`, ou 31/12. */
export function defaultSixOneEnd(data: OutputType, from: string): string {
  const next = data.patterns
    .filter((p) => p.scaleType === "5x2" && p.startDate > from)
    .map((p) => p.startDate)
    .sort()[0];
  return next ? scheduleEngine.addDays(next, -1) : `${from.slice(0, 4)}-12-31`;
}

/** Sábado do fim de semana responsável pelo feriado. */
export function holidayWeekend(date: string, rule: MondayRule): string {
  const wd = scheduleEngine.weekdayIndex(date);
  if (wd === 5) return date;
  if (wd === 6) return scheduleEngine.addDays(date, -1);
  if (wd === 0 && rule === "anterior") return scheduleEngine.addDays(date, -2);
  return scheduleEngine.addDays(date, 5 - wd);
}

export function runMotor(input: MotorInput): MotorResult {
  const { data, from, to, order, startTeam, mondayRule, respectAbsences } = input;
  const warnings: string[] = [];
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const members = (teamId: number) => data.technicians.filter((t) => t.teamId === teamId);
  const code = (id: number) => teamById.get(id)?.code ?? `#${id}`;

  const saturdays: string[] = [];
  for (let s = from; s <= to; s = scheduleEngine.addDays(s, 7)) saturdays.push(s);

  /** motivo de a dupla não poder trabalhar no dia (null = disponível) */
  const blocker = (teamId: number, dates: string[]): string | null => {
    if (!respectAbsences) return null;
    for (const m of members(teamId)) {
      for (const d of dates) {
        const a = scheduleEngine.isAbsent(data.absences, m.id, d);
        if (a) return `${m.name} — ${labels.absenceKind[a.kind].toLowerCase()} até ${scheduleEngine.formatDate(a.endDate).slice(0, 5)}`;
        const t = scheduleEngine.tripForTechnician(data.trips, m.id, d);
        if (t) return `${m.name} em viagem (${t.destination})`;
      }
    }
    return null;
  };

  // ---------- rodízio de fim de semana ----------
  const shifts: MotorShift[] = [];
  for (const sector of labels.sectors) {
    const ids = order[sector].filter((id) => teamById.get(id)?.sector === sector);
    if (ids.length === 0) {
      warnings.push(`${labels.sector[sector]}: nenhuma dupla cadastrada.`);
      continue;
    }
    if (ids.length === 1) warnings.push(`${labels.sector[sector]}: só uma dupla — ela faria todos os plantões.`);
    const first = startTeam[sector] && ids.includes(startTeam[sector]!) ? startTeam[sector]! : ids[0];
    const start = ids.indexOf(first);
    const queue = [...ids.slice(start), ...ids.slice(0, start)];
    let previous: number | null = null;

    for (const sat of saturdays) {
      const weekend = [sat, scheduleEngine.addDays(sat, 1)];
      const expected = queue[0];
      let chosen = -1;
      let reason = "";
      for (let i = 0; i < queue.length; i++) {
        const cand = queue[i];
        if (cand === previous && queue.length > 1) continue; // nunca dois fins de semana seguidos
        const why = blocker(cand, weekend);
        if (why) {
          if (i === 0) reason = why;
          continue;
        }
        chosen = i;
        break;
      }
      if (chosen === -1) {
        // ninguém livre: mantém a vez e avisa
        chosen = 0;
        warnings.push(`${scheduleEngine.formatDate(sat).slice(0, 5)} · ${labels.sectorShort[sector]}: nenhuma dupla completa disponível — ${code(queue[0])} mantida (${blocker(queue[0], weekend)}).`);
      }
      const teamId = queue[chosen];
      queue.splice(chosen, 1);
      queue.push(teamId);
      previous = teamId;
      shifts.push({
        sector,
        saturday: sat,
        teamId,
        compDates: scheduleEngine.defaultCompDates(sat, sector, data.patterns, data.holidays),
        swap: teamId !== expected ? { expectedTeamId: expected, reason: reason || "evitar plantão em fins de semana seguidos" } : undefined,
      });
    }
  }

  // plantão já cadastrado logo depois do período não pode repetir a última dupla gerada
  const lastSat = saturdays[saturdays.length - 1];
  if (lastSat) {
    const after = scheduleEngine.addDays(lastSat, 7);
    for (const sector of labels.sectors) {
      const last = shifts.find((s) => s.sector === sector && s.saturday === lastSat);
      const next = data.onCallShifts.find((s) => s.weekendStart === after && teamById.get(s.teamId)?.sector === sector);
      if (last && next && next.teamId === last.teamId) {
        warnings.push(
          `${labels.sectorShort[sector]}: o plantão já cadastrado em ${scheduleEngine.formatDate(after).slice(0, 5)} é de ${code(next.teamId)}, que também fecha o 6x1 em ${scheduleEngine.formatDate(lastSat).slice(0, 5)} — dois fins de semana seguidos. Ajuste em Plantões ou estenda o período.`,
        );
      }
    }
  }

  // ---------- feriados ----------
  const shiftOf = (sector: Sector, sat: string) => shifts.find((s) => s.sector === sector && s.saturday === sat);
  const knownShift = (sector: Sector, sat: string) =>
    shiftOf(sector, sat)?.teamId ??
    data.onCallShifts.find((s) => s.weekendStart === sat && teamById.get(s.teamId)?.sector === sector)?.teamId ??
    null;

  const holidays: MotorHoliday[] = [];
  const lastDay = scheduleEngine.addDays(saturdays[saturdays.length - 1] ?? to, 1);
  for (const h of data.holidays) {
    if (!h.dayOff || h.date < from || h.date > lastDay) continue;
    const wd = scheduleEngine.weekdayIndex(h.date);
    const sat = holidayWeekend(h.date, mondayRule);
    const teamIds: number[] = [];
    const notes: string[] = [];
    for (const sector of labels.sectors) {
      let teamId = knownShift(sector, sat);
      if (teamId === null) {
        notes.push(`${labels.sectorShort[sector]} sem plantão definido no fim de semana ${scheduleEngine.formatDate(sat).slice(0, 5)}`);
        continue;
      }
      // feriado no fim de semana já é coberto pelo próprio plantão
      if (wd < 5) {
        const why = blocker(teamId, [h.date]);
        if (why) {
          const alt = order[sector].find((id) => id !== teamId && teamById.get(id)?.sector === sector && !blocker(id, [h.date]));
          notes.push(`${code(teamId)} indisponível (${why})${alt ? ` — feriado com ${code(alt)}` : ""}`);
          if (alt) teamId = alt;
        }
      }
      teamIds.push(teamId);
    }
    let compDate: string | null = null;
    if (wd < 5) {
      // folga no próximo dia útil que não seja dia de plantão nem folga já marcada da mesma dupla
      const busy = new Set<string>();
      for (const id of teamIds) {
        for (const s of shifts.filter((x) => x.teamId === id)) {
          busy.add(s.saturday);
          busy.add(scheduleEngine.addDays(s.saturday, 1));
          s.compDates.forEach((d) => busy.add(d));
        }
      }
      let d = scheduleEngine.holidayCompDate(h.date, "suporte", data.patterns, data.holidays);
      for (let guard = 0; busy.has(d) && guard < 10; guard++) {
        d = scheduleEngine.holidayCompDate(d, "suporte", data.patterns, data.holidays);
      }
      compDate = d;
    }
    holidays.push({
      holidayId: h.id,
      date: h.date,
      name: h.name,
      teamIds,
      compDate,
      note: [wd >= 5 ? "cai no fim de semana — coberto pelo plantão" : "", ...notes].filter(Boolean).join(" · ") || undefined,
    });
  }

  // ---------- banco de horas projetado ----------
  const settings = new Map(data.settings.map((s) => [s.sector, s]));
  const weekendHours = (sector: Sector) => {
    const s = settings.get(sector);
    return s ? scheduleEngine.parseHours(s.onCallSaturday) + scheduleEngine.parseHours(s.onCallSunday) : 0;
  };
  const dayHours = (sector: Sector, date: string) => {
    const s = settings.get(sector);
    const p = scheduleEngine.patternForDate(data.patterns, sector, date);
    if (!s) return 8;
    if (p?.scaleType === "5x2") return s.hoursFiveTwo;
    return scheduleEngine.weekdayIndex(date) === 5 ? s.hoursSixOneSaturday : s.hoursSixOne;
  };
  const bank: MotorBank[] = data.teams
    .filter((t) => order[t.sector].includes(t.id))
    .map((t) => {
      const mine = shifts.filter((s) => s.teamId === t.id);
      const hol = holidays.filter((h) => h.teamIds.includes(t.id) && scheduleEngine.weekdayIndex(h.date) < 5);
      const holHours = (date: string) => scheduleEngine.parseHours(data.holidays.find((x) => x.date === date)?.onCallHours ?? "");
      const credit = mine.length * weekendHours(t.sector) + hol.reduce((a, h) => a + holHours(h.date), 0);
      const debit =
        mine.reduce((a, s) => a + s.compDates.reduce((b, d) => b + dayHours(t.sector, d), 0), 0) +
        hol.reduce((a, h) => a + (h.compDate ? dayHours(t.sector, h.compDate) : 0), 0);
      return {
        teamId: t.id,
        sector: t.sector,
        shifts: mine.length,
        holidays: hol.length,
        credit: round1(credit),
        debit: round1(debit),
        balance: round1(credit - debit),
        dates: mine.map((s) => s.saturday),
      };
    });

  const missingBase = labels.sectors.filter((s) => scheduleEngine.patternForDate(data.patterns, s, from)?.scaleType !== "6x1");

  return { saturdays, shifts, holidays, bank, warnings, missingBase };
}
