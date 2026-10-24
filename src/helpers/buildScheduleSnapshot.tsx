import type { OutputType } from "../endpoints/data_GET.schema";
import { scheduleEngine, DayStatus, Sector } from "./scheduleEngine";
import { labels } from "./labels";

export interface TeamDayView {
  teamId: number;
  status: DayStatus;
  absentMemberIds: number[];
  availableMemberIds: number[];
  patternId: number | null;
  cycleDay: number | null;
  onCallId: number | null;
  /** viagem que tirou a dupla (ou um técnico) da base neste dia */
  tripId: number | null;
}

export interface SectorDayView {
  sector: Sector;
  date: string;
  teams: TeamDayView[];
  /** duplas completas em campo */
  coverage: number;
  /** duplas desfalcadas (1 técnico) */
  partial: number;
  min: number;
  scaleType: string | null;
  suggestions: string[];
  holiday: { name: string; dayOff: boolean } | null;
}

export interface Alert {
  date: string;
  /** último dia quando o mesmo alerta se repete em dias seguidos */
  endDate: string;
  sector: Sector;
  severity: "critico" | "atencao";
  message: string;
}

/** Monta a visão diária (status de cada equipe, cobertura e sugestões) para um intervalo de datas. */
export function buildScheduleSnapshot(data: OutputType, startDate: string, days: number) {
  const techName = new Map(data.technicians.map((t) => [t.id, t.name]));
  const teamCode = new Map(data.teams.map((t) => [t.id, t.code]));
  const membersByTeam = new Map<number, number[]>();
  for (const t of data.technicians) {
    if (t.teamId === null) continue;
    membersByTeam.set(t.teamId, [...(membersByTeam.get(t.teamId) ?? []), t.id]);
  }
  const settings = new Map(data.settings.map((s) => [s.sector, s]));
  const result: Record<Sector, SectorDayView[]> = { suporte: [], infraestrutura: [] };
  const alerts: Alert[] = [];

  for (let i = 0; i < days; i++) {
    const date = scheduleEngine.addDays(startDate, i);
    const wd = scheduleEngine.weekdayIndex(date);
    for (const sector of labels.sectors) {
      const teams = data.teams.filter((t) => t.sector === sector);
      const views: TeamDayView[] = teams.map((team) => {
        const r = scheduleEngine.resolveTeamDay(
          { id: team.id, sector, memberIds: membersByTeam.get(team.id) ?? [] },
          date,
          data.patterns,
          data.absences,
          data.onCallShifts,
          data.holidays,
          data.trips,
        );
        return {
          teamId: team.id,
          status: r.status,
          absentMemberIds: r.absentMemberIds,
          availableMemberIds: r.availableMemberIds,
          patternId: r.pattern?.id ?? null,
          cycleDay: r.pattern ? scheduleEngine.cycleDayIndex(r.pattern, date) : null,
          onCallId: r.onCall?.id ?? null,
          tripId: r.trip?.id ?? null,
        };
      });
      const coverage = views.filter((v) => v.status === "trabalho" || v.status === "plantao").length;
      const partialViews = views.filter((v) => v.status === "desfalcada");
      const holiday = data.holidays.find((h) => h.date === date) ?? null;
      // feriado com folga geral: só o plantão do feriado é exigido
      const min = holiday?.dayOff ? Math.min(1, settings.get(sector)?.minCoverage[wd] ?? 0) : settings.get(sector)?.minCoverage[wd] ?? 0;
      const pattern = scheduleEngine.patternForDate(data.patterns, sector, date);
      const suggestions: string[] = [];

      if (holiday?.dayOff && teams.length > 0 && !teams.some((t) => holiday.onCallTeamIds.includes(t.id)) && wd < 5) {
        alerts.push({
          date,
          endDate: date,
          sector,
          severity: "atencao",
          message: `${holiday.name}: ${labels.sectorShort[sector]} sem dupla de plantão no feriado.`,
        });
        suggestions.push(`Feriado ${holiday.name}: escalar plantão do ${labels.sectorShort[sector]} em Feriados.`);
      }

      // Plantão com dupla desfalcada/ausente: sugere quem pode substituir
      const shiftsToday = views.filter((v) => v.onCallId !== null && (v.status === "desfalcada" || v.status === "ausente"));
      for (const v of shiftsToday) {
        const substitutes = views.filter(
          (o) => o.teamId !== v.teamId && o.onCallId === null && o.absentMemberIds.length === 0 && o.availableMemberIds.length >= 2,
        );
        if (wd >= 5) {
          alerts.push({
            date,
            endDate: date,
            sector,
            severity: "critico",
            message: `Plantão de ${teamCode.get(v.teamId)} comprometido — ${v.absentMemberIds.map((m) => techName.get(m)).join(", ")} ausente.`,
          });
          if (substitutes.length > 0) {
            suggestions.push(
              `Plantão: substituir ${teamCode.get(v.teamId)} por ${substitutes.map((s) => teamCode.get(s.teamId)).join(" ou ")} (ajuste em Plantões).`,
            );
          }
        }
      }

      // Duas equipes desfalcadas no mesmo dia: os técnicos restantes formam uma dupla temporária
      const loose = partialViews.flatMap((v) => v.availableMemberIds.map((m) => ({ m, team: v.teamId })));
      for (let k = 0; k + 1 < loose.length; k += 2) {
        suggestions.push(
          `Formar dupla temporária: ${techName.get(loose[k].m)} (${teamCode.get(loose[k].team)}) + ${techName.get(loose[k + 1].m)} (${teamCode.get(loose[k + 1].team)}).`,
        );
      }
      const effective = coverage + Math.floor(loose.length / 2);
      if (effective < min && pattern) {
        const offTeams = views.filter(
          (v) => (v.status === "folga" || v.status === "compensatoria") && v.absentMemberIds.length === 0,
        );
        if (offTeams.length > 0) {
          suggestions.push(
            `Antecipar/trocar folga de ${offTeams.map((v) => teamCode.get(v.teamId)).join(" ou ")} para recompor o mínimo.`,
          );
        }
        alerts.push({
          date,
          endDate: date,
          sector,
          severity: "critico",
          message: `${labels.sectorShort[sector]}: ${coverage} dupla(s) em campo, mínimo ${min}.`,
        });
      }
      for (const v of views.filter((x) => x.status === "viagem")) {
        const trip = data.trips.find((t) => t.id === v.tripId);
        alerts.push({
          date,
          endDate: date,
          sector,
          severity: "atencao",
          message: `${teamCode.get(v.teamId)} em viagem${trip ? ` para ${trip.destination}` : ""} — fora da cobertura local.`,
        });
      }
      for (const v of partialViews) {
        const trip = v.tripId ? data.trips.find((t) => t.id === v.tripId) : null;
        if (trip) {
          const away = v.absentMemberIds.map((m) => techName.get(m)).join(", ");
          alerts.push({
            date,
            endDate: date,
            sector,
            severity: "atencao",
            message: `${teamCode.get(v.teamId)} desfalcada — ${away} em viagem para ${trip.destination}.`,
          });
          continue;
        }
        const absent = v.absentMemberIds.map((m) => techName.get(m)).join(", ");
        alerts.push({
          date,
          endDate: date,
          sector,
          severity: "atencao",
          message: absent
            ? `${teamCode.get(v.teamId)} desfalcada — ${absent} ausente.`
            : `${teamCode.get(v.teamId)} sem dupla completa cadastrada.`,
        });
      }
      result[sector].push({
        sector,
        date,
        teams: views,
        coverage,
        partial: partialViews.length,
        min,
        scaleType: pattern?.scaleType ?? null,
        suggestions,
        holiday: holiday ? { name: holiday.name, dayOff: holiday.dayOff } : null,
      });
    }
  }
  // agrupa o mesmo alerta em dias consecutivos num único intervalo
  const grouped: Alert[] = [];
  const open = new Map<string, Alert>();
  for (const a of alerts) {
    const key = `${a.sector}|${a.severity}|${a.message}`;
    const prev = open.get(key);
    if (prev && scheduleEngine.addDays(prev.endDate, 1) === a.date) {
      prev.endDate = a.date;
    } else {
      const item = { ...a };
      grouped.push(item);
      open.set(key, item);
    }
  }
  grouped.sort((a, b) => a.date.localeCompare(b.date) || (a.severity === "critico" ? -1 : 1));
  return { bySector: result, alerts: grouped };
}
