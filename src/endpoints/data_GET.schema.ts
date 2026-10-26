// Tipos dos dados carregados pelo app (mesmo formato da versão Floot; a leitura agora é feita em helpers/api.tsx).
import type { AbsenceKind, HolidayKind, ScaleType, Sector, TripStatus } from "../helpers/schema";
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

/** Porta ocupada do armário ("01".."24"); portas livres não têm registro. */
export type LockerDTO = {
  id: string;
  name: string;
  sector: string | null;
  since: string | null;
  note: string | null;
  technicianId: number | null;
};

export type TripDTO = {
  id: number;
  technicianIds: number[];
  destination: string;
  reason: string | null;
  vehicle: string | null;
  /** "YYYY-MM-DDTHH:MM" */
  departAt: string;
  returnAt: string;
  returnedAt: string | null;
  status: TripStatus;
  /** adiantamento total da viagem */
  advance: number;
  notes: string | null;
  /** diária: null = automática pelo destino, true = sempre, false = nunca */
  perDiem: boolean | null;
};

export type TripSettingsDTO = {
  fullValue: number;
  halfValue: number;
  minHoursHalf: number;
  halfOnReturn: boolean;
  /** destinos (sentido) que geram diária */
  paidDestinations: string[];
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

/** Ajuste de um dia só para a dupla (feito clicando na tabela da escala); vence a escala base. */
export type DayOverrideDTO = {
  id: number;
  teamId: number;
  date: string;
  status: "trabalho" | "folga" | "plantao";
  note: string | null;
};

export type MotorConfigDTO = {
  order: { suporte: number[]; infraestrutura: number[] };
  excluded: number[];
  mondayRule: "anterior" | "seguinte";
  respectAbsences: boolean;
};

export type OutputType = {
  teams: TeamDTO[];
  technicians: TechnicianDTO[];
  absences: AbsenceDTO[];
  settings: SectorSettingsDTO[];
  patterns: PatternDTO[];
  onCallShifts: OnCallShiftDTO[];
  holidays: HolidayDTO[];
  lockers: LockerDTO[];
  trips: TripDTO[];
  tripSettings: TripSettingsDTO;
  /** preferências salvas do motor de plantão (null até a primeira gravação) */
  motorConfig: MotorConfigDTO | null;
  overrides: DayOverrideDTO[];
};
