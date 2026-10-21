// Tipos dos dados carregados pelo app (mesmo formato da versão Floot; a leitura agora é feita em helpers/api.tsx).
import type { AbsenceKind, HolidayKind, ScaleType, Sector } from "../helpers/schema";
import type { PatternDays } from "../helpers/scheduleEngine";

export type TeamDTO = {
  id: number;
  name: string;
  code: string;
  sector: Sector;
  vehicle: string | null;
  notes: string | null;
};

export type TechnicianDTO = {
  id: number;
  name: string;
  phone: string | null;
  role: string | null;
  teamId: number | null;
};

export type AbsenceDTO = {
  id: number;
  technicianId: number;
  startDate: string;
  endDate: string;
  kind: AbsenceKind;
  notes: string | null;
};

export type SectorSettingsDTO = {
  sector: Sector;
  minCoverage: number[];
  maxConsecutive: number;
  hoursSixOne: number;
  /** horas do sábado no 6x1 (meio período) */
  hoursSixOneSaturday: number;
  hoursFiveTwo: number;
  shiftStart: string;
  shiftEnd: string;
  onCallTeams: number;
  onCallSaturday: string;
  onCallSunday: string;
};

export type OnCallShiftDTO = {
  id: number;
  teamId: number;
  weekendStart: string;
  compDates: string[];
  notes: string | null;
};

export type HolidayDTO = {
  id: number;
  date: string;
  name: string;
  kind: HolidayKind;
  dayOff: boolean;
  onCallTeamIds: number[];
  onCallHours: string;
  compDate: string | null;
};

export type PatternDTO = {
  id: number;
  sector: Sector;
  scaleType: ScaleType;
  name: string;
  startDate: string;
  cycleWeeks: number;
  daysOff: PatternDays;
};

export type OutputType = {
  teams: TeamDTO[];
  technicians: TechnicianDTO[];
  absences: AbsenceDTO[];
  settings: SectorSettingsDTO[];
  patterns: PatternDTO[];
  onCallShifts: OnCallShiftDTO[];
  holidays: HolidayDTO[];
};
