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
  /** escala vigente no fim de semana (define a folga: 6x1 sex+sáb, 5x2 qui+sex) */
  scale: string | null;
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
        scale: scheduleEngine.patternForDate(data.patterns, sector, sat)?.scaleType ?? null,
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
          `${labels.sectorShort[sector]}: o plantão já cadastrado em ${scheduleEngine.formatDate(after).slice(0, 5)} é de ${code(next.teamId)}, que também fecha o 6x1 em ${scheduleEngine.formatDate(lastSat).slice(0, 5)} — dois fins de semana seguidos. Ajuste em "Escala salva (editar)" ou estenda o período.`,
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
  const holidayCount = new Map<number, number>();
  // dupla fora do plantão do fim de semana e sem folga de compensação no dia (para feriado de sexta)
  const freeForFriday = (sector: Sector, date: string, weekendTeam: number | null, prevTeam: number | null) => {
    const busyComp = (id: number) =>
      shifts.some((x) => x.teamId === id && x.compDates.includes(date)) ||
      data.onCallShifts.some((x) => x.teamId === id && x.compDates.includes(date));
    const ok = order[sector].filter((id) => teamById.get(id)?.sector === sector && id !== weekendTeam && !busyComp(id) && !blocker(id, [date]));
    // evita também a dupla do plantão anterior (está na semana da folga de compensação)
    const rest = ok.filter((id) => id !== prevTeam);
    return (rest.length ? rest : ok).sort((a, b) => (holidayCount.get(a) ?? 0) - (holidayCount.get(b) ?? 0))[0];
  };
  const lastDay = scheduleEngine.addDays(saturdays[saturdays.length - 1] ?? to, 1);
  for (const h of data.holidays) {
    if (!h.dayOff || h.date < from || h.date > lastDay) continue;
    const wd = scheduleEngine.weekdayIndex(h.date);
    const sat = holidayWeekend(h.date, mondayRule);
    const teamIds: number[] = [];
    const notes: string[] = [];
    for (const sector of labels.sectors) {
      let teamId = knownShift(sector, sat);
      // plantão é só sábado e domingo: feriado na sexta fica com outra dupla (nem a do fim de semana, nem quem está de folga)
      if (wd === 4) {
        const alt = freeForFriday(sector, h.date, teamId, knownShift(sector, scheduleEngine.addDays(sat, -7)));
        if (alt !== undefined) {
          teamId = alt;
        } else {
          notes.push(`${labels.sectorShort[sector]}: nenhuma dupla livre na sexta além da do plantão`);
        }
      }
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
      holidayCount.set(teamId, (holidayCount.get(teamId) ?? 0) + 1);
    }
    let compDate: string | null = null;
    if (wd < 5) {
      // folga no próximo dia útil que não seja dia de plantão nem folga já marcada da mesma dupla
      const busy = new Set<string>();
      for (const id of teamIds) {
        for (const s of shifts.filter((x) => x.teamId === id)) {
          busy.add(s.saturday);
          busy.add(scheduleEngine.addDays(s.saturday, 1));
        }
      }
      // não empilha com a folga de compensação de outra dupla (derrubaria o mínimo do setor)
      for (const s of shifts) s.compDates.forEach((d) => busy.add(d));
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

export interface OnCallAdjustment {
  shifts: { id: number; teamId: number; notes: string | null }[];
  holidays: { id: number; onCallTeamIds: number[] }[];
  /** frases para mostrar ao usuário */
  messages: string[];
}

/**
 * Ajuste automático do plantão quando técnicos ficam fora (viagem): a dupla afetada troca o fim de semana
 * com a próxima dupla do setor que estiver livre, e assume o próximo plantão dela (o rodízio continua justo).
 * Feriados que a dupla faria passam para quem assumiu o fim de semana.
 */
export function planOnCallAdjustment(
  data: OutputType,
  away: { technicianIds: number[]; start: string; end: string; label: string },
  today = scheduleEngine.todayIso(),
): OnCallAdjustment {
  const out: OnCallAdjustment = { shifts: [], holidays: [], messages: [] };
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const code = (id: number) => teamById.get(id)?.code ?? `#${id}`;
  const fmt = (d: string) => scheduleEngine.formatDate(d).slice(0, 5);
  const inAway = (d: string) => d >= away.start && d <= away.end;
  const affectedTeams = [...new Set(away.technicianIds.map((id) => data.technicians.find((t) => t.id === id)?.teamId).filter((x): x is number => x != null))];
  const membersOf = (teamId: number) => data.technicians.filter((t) => t.teamId === teamId).map((t) => t.id);
  const busy = (teamId: number, dates: string[]) =>
    membersOf(teamId).some((m) =>
      dates.some(
        (d) =>
          (away.technicianIds.includes(m) && inAway(d)) ||
          scheduleEngine.isAbsent(data.absences, m, d) ||
          scheduleEngine.tripForTechnician(data.trips, m, d),
      ),
    );
  // plantões depois das trocas já planejadas (para não trocar duas vezes o mesmo fim de semana)
  const shifts = data.onCallShifts.map((s) => ({ ...s }));
  const shiftsOf = (teamId: number) => shifts.filter((s) => s.teamId === teamId);
  const weekend = (sat: string) => [sat, scheduleEngine.addDays(sat, 1)];

  for (const teamA of affectedTeams) {
    const sector = teamById.get(teamA)?.sector;
    if (!sector) continue;
    const conflicts = shiftsOf(teamA).filter((s) => s.weekendStart >= scheduleEngine.addDays(today, -1) && weekend(s.weekendStart).some(inAway));
    for (const shift of conflicts) {
      const W = shift.weekendStart;
      const satsOf = (teamId: number) => shiftsOf(teamId).map((x) => x.weekendStart);
      // depois da troca ninguém pode ficar com dois fins de semana seguidos
      const noBackToBack = (sats: string[], changed: string) =>
        !sats.includes(scheduleEngine.addDays(changed, -7)) && !sats.includes(scheduleEngine.addDays(changed, 7));
      const candidates = data.teams
        .filter((t) => t.sector === sector && t.id !== teamA && !affectedTeams.includes(t.id))
        .filter((t) => !busy(t.id, weekend(W)) && !satsOf(t.id).includes(W))
        .map((t) => {
          const bSats = satsOf(t.id);
          const aSats = satsOf(teamA).filter((x) => x !== W);
          // próximo plantão da candidata que a dupla afetada pode assumir em troca
          const next = shiftsOf(t.id)
            .filter((x) => x.weekendStart > W)
            .sort((a, b) => a.weekendStart.localeCompare(b.weekendStart))
            .find(
              (x) =>
                !busy(teamA, weekend(x.weekendStart)) &&
                noBackToBack([...bSats.filter((b) => b !== x.weekendStart)], W) &&
                noBackToBack(aSats, x.weekendStart),
            );
          const ok = next ? true : noBackToBack(bSats, W);
          return { team: t, next, ok };
        })
        .filter((c) => c.ok)
        .sort((a, b) => (a.next?.weekendStart ?? "9999").localeCompare(b.next?.weekendStart ?? "9999"));
      const pick = candidates[0];
      if (!pick) {
        out.messages.push(`${code(teamA)} está de plantão em ${fmt(W)} durante ${away.label}, mas nenhuma outra dupla do setor está livre — ajuste em Escala de plantão.`);
        continue;
      }
      const B = pick.team.id;
      shift.teamId = B;
      out.shifts.push({ id: shift.id, teamId: B, notes: `Troca automática: ${code(teamA)} fora (${away.label}); ${code(B)} assumiu` });
      if (pick.next) {
        const other = shifts.find((x) => x.id === pick.next!.id)!;
        other.teamId = teamA;
        out.shifts.push({ id: other.id, teamId: teamA, notes: `Troca automática com ${code(B)} (${fmt(W)})` });
        out.messages.push(`Plantão de ${fmt(W)}: ${code(B)} assume no lugar de ${code(teamA)}, que fica com o plantão de ${fmt(other.weekendStart)}.`);
      } else {
        out.messages.push(`Plantão de ${fmt(W)}: ${code(B)} assume no lugar de ${code(teamA)}.`);
      }
      // feriado no sábado/domingo é coberto pelo próprio plantão: acompanha a troca
      const followWeekend = (sat: string, fromTeam: number, toTeam: number) => {
        for (const h of data.holidays) {
          if (!weekend(sat).includes(h.date) || !h.onCallTeamIds.includes(fromTeam)) continue;
          const cur = out.holidays.find((x) => x.id === h.id);
          const ids = (cur?.onCallTeamIds ?? h.onCallTeamIds).map((id) => (id === fromTeam ? toTeam : id));
          if (cur) cur.onCallTeamIds = ids;
          else out.holidays.push({ id: h.id, onCallTeamIds: ids });
          out.messages.push(`Feriado ${h.name} (${fmt(h.date)}) acompanha o plantão: ${code(toTeam)}.`);
        }
      };
      followWeekend(W, teamA, B);
      if (pick.next) followWeekend(pick.next.weekendStart, B, teamA);
      // feriado ligado a este fim de semana que estava com a dupla afetada
      for (const h of data.holidays) {
        if (!h.onCallTeamIds.includes(teamA) || !inAway(h.date) || h.date < today) continue;
        if (out.holidays.some((x) => x.id === h.id)) continue;
        out.holidays.push({ id: h.id, onCallTeamIds: h.onCallTeamIds.map((id) => (id === teamA ? B : id)) });
        out.messages.push(`Feriado ${h.name} (${fmt(h.date)}): plantão passa de ${code(teamA)} para ${code(B)}.`);
      }
    }
    // feriado em dia útil durante a ausência, sem fim de semana em conflito
    for (const h of data.holidays) {
      if (!h.onCallTeamIds.includes(teamA) || !inAway(h.date) || h.date < today || out.holidays.some((x) => x.id === h.id)) continue;
      const alt = data.teams.find((t) => t.sector === sector && t.id !== teamA && !affectedTeams.includes(t.id) && !busy(t.id, [h.date]));
      if (!alt) continue;
      out.holidays.push({ id: h.id, onCallTeamIds: h.onCallTeamIds.map((id) => (id === teamA ? alt.id : id)) });
      out.messages.push(`Feriado ${h.name} (${fmt(h.date)}): plantão passa de ${code(teamA)} para ${code(alt.id)}.`);
    }
  }
  return out;
}
