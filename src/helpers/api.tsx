/**
 * Acesso aos dados (Supabase, via helpers/cloud.tsx). Valida as entradas aqui,
 * com as mesmas regras dos endpoints originais, antes de gravar.
 */
import { z } from "zod";
import { dbCall } from "./desktop";
import { scheduleEngine } from "./scheduleEngine";
import { AbsenceKindArrayValues, HolidayKindArrayValues, ScaleTypeArrayValues, SectorArrayValues, TripStatusArrayValues } from "./schema";
import type { OutputType } from "../endpoints/data_GET.schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const hourRanges = z
  .string()
  .trim()
  .regex(/^(\d{2}:\d{2}-\d{2}:\d{2})(,\s*\d{2}:\d{2}-\d{2}:\d{2})*$/, "Use o formato 08:00-12:00,14:00-18:00");
const idSchema = z.object({ id: z.number().int() });

type Saved = { id: number };
type Ok = { ok: true };

function isWeekday(date: string, jsDay: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === jsDay;
}

export function getData(): Promise<OutputType> {
  return dbCall<OutputType>("getData");
}

// ---------- equipes ----------

export const teamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1, "Informe o nome da equipe"),
  code: z.string().trim().min(1, "Informe o código").max(8),
  sector: z.enum(SectorArrayValues),
  vehicle: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
});
export const saveTeam = (body: z.infer<typeof teamSchema>) => dbCall<Saved>("saveTeam", teamSchema.parse(body));
export const deleteTeam = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteTeam", idSchema.parse(body));

// ---------- técnicos ----------

export const technicianSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1, "Informe o nome do técnico"),
  phone: z.string().trim().nullable(),
  role: z.string().trim().nullable(),
  teamId: z.number().int().nullable(),
});
export const saveTechnician = (body: z.infer<typeof technicianSchema>) => dbCall<Saved>("saveTechnician", technicianSchema.parse(body));
export const deleteTechnician = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteTechnician", idSchema.parse(body));

// ---------- ausências ----------

export const absenceSchema = z
  .object({
    id: z.number().int().optional(),
    technicianId: z.number().int(),
    startDate: isoDate,
    endDate: isoDate,
    kind: z.enum(AbsenceKindArrayValues),
    notes: z.string().trim().nullable(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "A data final deve ser igual ou posterior à inicial", path: ["endDate"] });
export const saveAbsence = (body: z.infer<typeof absenceSchema>) => dbCall<Saved>("saveAbsence", absenceSchema.parse(body));
export const deleteAbsence = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteAbsence", idSchema.parse(body));

// ---------- parâmetros do setor ----------

export const settingsSchema = z.object({
  sector: z.enum(SectorArrayValues),
  minCoverage: z.array(z.number().int().min(0).max(50)).length(7),
  maxConsecutive: z.number().int().min(1).max(13),
  hoursSixOne: z.number().min(1).max(12),
  hoursSixOneSaturday: z.number().min(0).max(12),
  hoursFiveTwo: z.number().min(1).max(12),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/, "Horário inválido"),
  onCallTeams: z.number().int().min(0).max(10),
  onCallSaturday: hourRanges.or(z.literal("")),
  onCallSunday: hourRanges.or(z.literal("")),
});
export const saveSettings = (body: z.infer<typeof settingsSchema>) => dbCall<Ok>("saveSettings", settingsSchema.parse(body));

// ---------- escalas-base ----------

const offSchema = z.object({ day: z.number().int().min(0), kind: z.enum(["regular", "compensatoria"]) });

export const patternSchema = z
  .object({
    id: z.number().int().optional(),
    sector: z.enum(SectorArrayValues),
    scaleType: z.enum(ScaleTypeArrayValues),
    name: z.string().trim().min(1, "Dê um nome à escala"),
    startDate: isoDate,
    cycleWeeks: z.number().int().min(1).max(12),
    daysOff: z.record(z.string(), z.array(offSchema)),
  })
  .refine((v) => isWeekday(v.startDate, 1), { message: "A escala deve começar numa segunda-feira", path: ["startDate"] });

export function savePattern(body: z.infer<typeof patternSchema>) {
  const input = patternSchema.parse(body);
  const total = input.cycleWeeks * 7;
  // descarta dias fora do ciclo
  const daysOff = Object.fromEntries(Object.entries(input.daysOff).map(([team, list]) => [team, list.filter((o) => o.day < total)]));
  return dbCall<Saved>("savePattern", { ...input, daysOff });
}
export const deletePattern = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deletePattern", idSchema.parse(body));

// ---------- plantões de fim de semana ----------

export const onCallBulkSchema = z.object({
  sector: z.enum(SectorArrayValues),
  fromDate: isoDate,
  toDate: isoDate,
  shifts: z.array(z.object({ teamId: z.number().int(), weekendStart: isoDate, compDates: z.array(isoDate).max(5) })),
});
/** Substitui os plantões do setor no intervalo (uma única transação no banco). */
export const bulkOnCall = (body: z.infer<typeof onCallBulkSchema>) => dbCall<{ created: number }>("bulkOnCall", onCallBulkSchema.parse(body));

export const onCallPlanSchema = z.object({
  fromDate: isoDate,
  toDate: isoDate,
  sectors: z.array(
    z.object({
      sector: z.enum(SectorArrayValues),
      shifts: z.array(z.object({ teamId: z.number().int(), weekendStart: isoDate, compDates: z.array(isoDate).max(5), notes: z.string().nullable() })),
    }),
  ),
  holidays: z.array(z.object({ id: z.number().int(), onCallTeamIds: z.array(z.number().int()), compDate: isoDate.nullable() })),
  basePatterns: z.array(z.object({ sector: z.enum(SectorArrayValues), startDate: isoDate })),
});
/** Motor de plantão: grava rodízio + feriados + escala base numa única transação. */
export const applyOnCallPlan = (body: z.infer<typeof onCallPlanSchema>) => dbCall<{ created: number }>("applyOnCallPlan", onCallPlanSchema.parse(body));

export const motorConfigSchema = z.object({
  order: z.object({ suporte: z.array(z.number().int()), infraestrutura: z.array(z.number().int()) }),
  excluded: z.array(z.number().int()),
  mondayRule: z.enum(["anterior", "seguinte"]),
  respectAbsences: z.boolean(),
});
export const saveMotorConfig = (body: z.infer<typeof motorConfigSchema>) => dbCall<Ok>("saveMotorConfig", motorConfigSchema.parse(body));

export const onCallAdjustSchema = z.object({
  shifts: z.array(z.object({ id: z.number().int(), teamId: z.number().int(), notes: z.string().nullable() })),
  holidays: z.array(z.object({ id: z.number().int(), onCallTeamIds: z.array(z.number().int()) })),
});
/** Troca de duplas no plantão (ex.: quando uma viagem cai no fim de semana de plantão). */
export const applyOnCallAdjust = (body: z.infer<typeof onCallAdjustSchema>) => dbCall<{ changed: number }>("applyOnCallAdjust", onCallAdjustSchema.parse(body));

export const overrideSchema = z.object({
  teamId: z.number().int(),
  date: isoDate,
  status: z.enum(["trabalho", "folga", "plantao"]),
  note: z.string().trim().max(200).nullable(),
});
/** Ajuste de um dia só para a dupla (clique na tabela da escala). */
export const saveOverride = (body: z.infer<typeof overrideSchema>) => dbCall<Ok>("saveOverride", overrideSchema.parse(body));
export const deleteOverride = (body: { teamId: number; date: string }) =>
  dbCall<Ok>("deleteOverride", z.object({ teamId: z.number().int(), date: isoDate }).parse(body));

/** Alertas do painel marcados como "Ignorar" (lista completa de chaves). */
export const saveIgnoredAlerts = (body: { keys: string[] }) =>
  dbCall<Ok>("saveIgnoredAlerts", z.object({ keys: z.array(z.string().max(400)).max(2000) }).parse(body));

export const onCallSchema = z
  .object({
    id: z.number().int().optional(),
    teamId: z.number().int(),
    weekendStart: isoDate,
    compDates: z.array(isoDate).max(5),
    notes: z.string().trim().nullable(),
  })
  .refine((v) => isWeekday(v.weekendStart, 6), { message: "O plantão começa num sábado", path: ["weekendStart"] });
export const saveOnCall = (body: z.infer<typeof onCallSchema>) => dbCall<Saved>("saveOnCall", onCallSchema.parse(body));
export const deleteOnCall = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteOnCall", idSchema.parse(body));

// ---------- feriados ----------

export const holidaySchema = z.object({
  id: z.number().int().optional(),
  date: isoDate,
  name: z.string().trim().min(1, "Informe o nome do feriado"),
  kind: z.enum(HolidayKindArrayValues),
  dayOff: z.boolean(),
  onCallTeamIds: z.array(z.number().int()).max(20),
  onCallHours: hourRanges,
  compDate: isoDate.nullable(),
});
export const saveHoliday = (body: z.infer<typeof holidaySchema>) => dbCall<Saved>("saveHoliday", holidaySchema.parse(body));
export const deleteHoliday = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteHoliday", idSchema.parse(body));

/** Importa os feriados nacionais do ano, sem sobrescrever datas já cadastradas. */
export function importHolidays(body: { year: number }) {
  const { year } = z.object({ year: z.number().int().min(2000).max(2100) }).parse(body);
  return dbCall<{ created: number }>("insertHolidays", { holidays: scheduleEngine.brazilNationalHolidays(year) });
}

// ---------- armários ----------

export const LOCKER_COUNT = 24;

export const lockerSchema = z.object({
  id: z.string().regex(/^\d{2}$/, "Porta inválida").refine((v) => Number(v) >= 1 && Number(v) <= LOCKER_COUNT, "Porta inválida"),
  name: z.string().trim().min(1, "Informe o nome do ocupante para salvar.").max(80),
  sector: z.string().trim().max(60).nullable(),
  since: isoDate.nullable(),
  note: z.string().trim().max(300).nullable(),
  technicianId: z.number().int().nullable(),
});
export const saveLocker = (body: z.infer<typeof lockerSchema>) => dbCall<Ok>("saveLocker", lockerSchema.parse(body));
export const freeLocker = (body: { id: string }) => dbCall<Ok>("freeLocker", { id: lockerSchema.shape.id.parse(body.id) });

// ---------- viagens e diárias ----------

const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data e hora inválidas");

export const tripSchema = z
  .object({
    id: z.number().int().optional(),
    technicianIds: z.array(z.number().int()).min(1, "Escolha pelo menos um técnico"),
    destination: z.string().trim().min(1, "Informe o destino").max(120),
    reason: z.string().trim().max(200).nullable(),
    vehicle: z.string().trim().max(60).nullable(),
    departAt: dateTime,
    returnAt: dateTime,
    returnedAt: dateTime.nullable(),
    status: z.enum(TripStatusArrayValues),
    advance: z.number().min(0).max(1_000_000),
    notes: z.string().trim().max(500).nullable(),
    perDiem: z.boolean().nullable(),
  })
  .refine((v) => v.returnAt >= v.departAt, { message: "O retorno previsto deve ser depois da saída", path: ["returnAt"] })
  .refine((v) => !v.returnedAt || v.returnedAt >= v.departAt, { message: "O retorno real deve ser depois da saída", path: ["returnedAt"] });
export const saveTrip = (body: z.infer<typeof tripSchema>) => dbCall<Saved>("saveTrip", tripSchema.parse(body));
export const setTripStatus = (body: { id: number; status: z.infer<typeof tripSchema>["status"] }) =>
  dbCall<Ok>("setTripStatus", z.object({ id: z.number().int(), status: z.enum(TripStatusArrayValues) }).parse(body));
export const deleteTrip = (body: z.infer<typeof idSchema>) => dbCall<Ok>("deleteTrip", idSchema.parse(body));

export const tripSettingsSchema = z.object({
  fullValue: z.number().min(0).max(100_000),
  halfValue: z.number().min(0).max(100_000),
  minHoursHalf: z.number().min(0).max(24),
  halfOnReturn: z.boolean(),
  paidDestinations: z.array(z.string().trim().min(1).max(80)).max(30),
});
export const saveTripSettings = (body: z.infer<typeof tripSettingsSchema>) => dbCall<Ok>("saveTripSettings", tripSettingsSchema.parse(body));
