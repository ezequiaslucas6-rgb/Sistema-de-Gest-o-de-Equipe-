import type { OutputType } from "../endpoints/data_GET.schema";
import { scheduleEngine, Sector } from "./scheduleEngine";
import { labels } from "./labels";

/** "08:00-12:00,14:00-18:00" → [[480, 720], [840, 1080]] (minutos do dia) */
export function parseRanges(ranges: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of ranges.split(",")) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (m) out.push([Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])]);
  }
  return out;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fmtMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface LiveStatus {
  kind: "expediente" | "plantao" | "intervalo" | "fora";
  title: string;
  detail: string;
  /** 0..1 quando há um turno em andamento */
  progress: number | null;
  range: [number, number] | null;
}

/** Situação do momento: expediente, plantão de fim de semana/feriado ou fora do horário. */
export function liveStatus(now: Date, data: OutputType): LiveStatus {
  const today = scheduleEngine.todayIso();
  const wd = scheduleEngine.weekdayIndex(today);
  const hm = now.getHours() * 60 + now.getMinutes();
  const s = data.settings.find((x) => x.sector === "suporte") ?? data.settings[0];
  const holiday = data.holidays.find((h) => h.date === today && h.dayOff);
  const shiftStart = toMin(s?.shiftStart ?? "08:00");
  const shiftEnd = toMin(s?.shiftEnd ?? "18:00");

  const inRange = (r: [number, number][], label: string): LiveStatus | null => {
    const cur = r.find(([a, b]) => hm >= a && hm < b);
    if (cur) return { kind: "plantao", title: `${label} em andamento`, detail: `${fmtMin(cur[0])} → ${fmtMin(cur[1])}`, progress: (hm - cur[0]) / (cur[1] - cur[0]), range: cur };
    const next = r.find(([a]) => a > hm);
    if (next) return { kind: "intervalo", title: `${label} — próximo turno às ${fmtMin(next[0])}`, detail: r.map(([a, b]) => `${fmtMin(a)}–${fmtMin(b)}`).join(" · "), progress: null, range: null };
    return null;
  };

  if (holiday) {
    return inRange(parseRanges(holiday.onCallHours), `Plantão de feriado (${holiday.name})`) ?? {
      kind: "fora", title: `Feriado — ${holiday.name}`, detail: "Plantão do dia encerrado", progress: null, range: null,
    };
  }
  if (wd === 5) {
    // sábado: no 6x1 há expediente até 12h, depois o plantão
    const sixOne = labels.sectors.some((sec) => scheduleEngine.patternForDate(data.patterns, sec, today)?.scaleType === "6x1");
    if (sixOne && hm >= shiftStart && hm < 12 * 60) {
      return { kind: "expediente", title: "Expediente de sábado (6x1)", detail: `${fmtMin(shiftStart)} → 12:00`, progress: (hm - shiftStart) / (12 * 60 - shiftStart), range: [shiftStart, 12 * 60] };
    }
  }
  if (wd >= 5) {
    return inRange(parseRanges(wd === 5 ? s?.onCallSaturday ?? "" : s?.onCallSunday ?? ""), "Plantão") ?? {
      kind: "fora", title: "Fim de semana — fora do plantão", detail: "Equipes de folga", progress: null, range: null,
    };
  }
  if (hm >= shiftStart && hm < shiftEnd) {
    return { kind: "expediente", title: "Expediente em andamento", detail: `${fmtMin(shiftStart)} → ${fmtMin(shiftEnd)}`, progress: (hm - shiftStart) / (shiftEnd - shiftStart), range: [shiftStart, shiftEnd] };
  }
  if (hm < shiftStart) return { kind: "fora", title: `Expediente começa às ${fmtMin(shiftStart)}`, detail: "Antes do horário", progress: null, range: null };
  return { kind: "fora", title: "Expediente encerrado", detail: `Volta amanhã às ${fmtMin(shiftStart)}`, progress: null, range: null };
}

/** Sábado do fim de semana que contém (ou segue) a data. */
export function weekendOf(date: string): string {
  const wd = scheduleEngine.weekdayIndex(date);
  return wd === 6 ? scheduleEngine.addDays(date, -1) : scheduleEngine.addDays(date, 5 - wd);
}

export type EventKind = "plantao" | "feriado" | "viagem" | "retorno" | "ausencia" | "compensacao" | "escala";

export interface DashEvent {
  date: string;
  time?: string;
  kind: EventKind;
  text: string;
  sectors: Sector[];
}

/** Agenda dos próximos dias: plantões, folgas de compensação, feriados, viagens, ausências e mudanças de escala. */
export function buildEvents(data: OutputType, from: string, days: number): DashEvent[] {
  const to = scheduleEngine.addDays(from, days - 1);
  const inRange = (d: string) => d >= from && d <= to;
  const team = new Map(data.teams.map((t) => [t.id, t]));
  const tech = new Map(data.technicians.map((t) => [t.id, t]));
  const sectorsOfTeams = (ids: number[]) => [...new Set(ids.map((id) => team.get(id)?.sector).filter(Boolean))] as Sector[];
  const sectorsOfTechs = (ids: number[]) => sectorsOfTeams(ids.map((id) => tech.get(id)?.teamId ?? -1));
  const codes = (ids: number[]) => ids.map((id) => team.get(id)?.code ?? "?").join(" + ");
  const ev: DashEvent[] = [];

  const byWeekend = new Map<string, number[]>();
  for (const s of data.onCallShifts) byWeekend.set(s.weekendStart, [...(byWeekend.get(s.weekendStart) ?? []), s.teamId]);
  for (const [sat, ids] of byWeekend) {
    if (inRange(sat) || inRange(scheduleEngine.addDays(sat, 1))) {
      ev.push({ date: inRange(sat) ? sat : scheduleEngine.addDays(sat, 1), kind: "plantao", text: `Plantão ${codes(ids)}`, sectors: sectorsOfTeams(ids) });
    }
  }
  const comp = new Map<string, number[]>();
  for (const s of data.onCallShifts) for (const d of s.compDates) if (inRange(d)) comp.set(d, [...(comp.get(d) ?? []), s.teamId]);
  for (const h of data.holidays) if (h.compDate && inRange(h.compDate)) comp.set(h.compDate, [...(comp.get(h.compDate) ?? []), ...h.onCallTeamIds]);
  for (const [d, ids] of comp) ev.push({ date: d, kind: "compensacao", text: `Folga compensatória ${codes([...new Set(ids)])}`, sectors: sectorsOfTeams(ids) });

  for (const h of data.holidays) {
    if (!inRange(h.date)) continue;
    const pl = h.onCallTeamIds.length ? ` · plantão ${codes(h.onCallTeamIds)}` : "";
    ev.push({ date: h.date, kind: "feriado", text: `Feriado · ${h.name}${pl}`, sectors: [...labels.sectors] });
  }
  for (const t of data.trips) {
    const who = sectorsOfTechs(t.technicianIds);
    const teamCodes = [...new Set(t.technicianIds.map((id) => team.get(tech.get(id)?.teamId ?? -1)?.code).filter(Boolean))].join(" + ");
    const dep = t.departAt.slice(0, 10);
    if (inRange(dep)) ev.push({ date: dep, time: t.departAt.slice(11), kind: "viagem", text: `Viagem ${teamCodes || "equipe"} → ${t.destination}`, sectors: who });
    const end = scheduleEngine.tripEnd(t);
    if (inRange(end.slice(0, 10)) && end.slice(0, 10) !== dep) {
      ev.push({ date: end.slice(0, 10), time: end.slice(11), kind: "retorno", text: `Retorno ${teamCodes || "equipe"} — ${t.destination}`, sectors: who });
    }
  }
  for (const a of data.absences) {
    if (!inRange(a.startDate)) continue;
    const name = tech.get(a.technicianId)?.name ?? "Técnico";
    ev.push({
      date: a.startDate,
      kind: "ausencia",
      text: `${labels.absenceKind[a.kind]} · ${name}${a.endDate !== a.startDate ? ` até ${scheduleEngine.formatDate(a.endDate).slice(0, 5)}` : ""}`,
      sectors: sectorsOfTechs([a.technicianId]),
    });
  }
  for (const p of data.patterns) {
    if (inRange(p.startDate)) ev.push({ date: p.startDate, kind: "escala", text: `${labels.sectorShort[p.sector]} passa para ${p.scaleType}`, sectors: [p.sector] });
  }
  const order: EventKind[] = ["escala", "feriado", "plantao", "viagem", "retorno", "compensacao", "ausencia"];
  return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** "hoje", "amanhã", "ontem", "em 3 dias", "há 2 dias" */
export function relativeDay(date: string, today: string): string {
  const d = scheduleEngine.diffDays(date, today);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d === -1) return "ontem";
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
}

export function longDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
