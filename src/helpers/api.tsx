/**
 * Acesso aos dados no Supabase (tabelas escala_*). Mesmas operações e validações dos
 * endpoints da versão Floot, para as telas funcionarem sem alteração.
 */
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { scheduleEngine, PatternDays } from "./scheduleEngine";
import { AbsenceKindArrayValues, HolidayKindArrayValues, ScaleTypeArrayValues, SectorArrayValues } from "./schema";
import type { OutputType } from "../endpoints/data_GET.schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const hourRanges = z
  .string()
  .trim()
  .regex(/^(\d{2}:\d{2}-\d{2}:\d{2})(,\s*\d{2}:\d{2}-\d{2}:\d{2})*$/, "Use o formato 08:00-12:00,14:00-18:00");

function isWeekday(date: string, jsDay: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === jsDay;
}

/** Converte erros do banco em mensagens em português. */
function fail(error: PostgrestError | null, duplicateMessage?: string): void {
  if (!error) return;
  if (error.code === "23505" && duplicateMessage) throw new Error(duplicateMessage);
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    throw new Error("Seu usuário não tem permissão para alterar o sistema de escalas.");
  }
  throw new Error(error.message);
}

// ---------- leitura ----------

export async function getData(): Promise<OutputType> {
  const [teams, technicians, absences, settings, patterns, onCall, holidays] = await Promise.all([
    supabase.from("escala_teams").select("id,name,code,sector,vehicle,notes").order("sector", { ascending: false }).order("code"),
    supabase.from("escala_technicians").select("id,name,phone,role,team_id").order("name"),
    supabase.from("escala_absences").select("id,technician_id,start_date,end_date,kind,notes").order("start_date"),
    supabase.from("escala_sector_settings").select("*"),
    supabase.from("escala_schedule_patterns").select("id,sector,scale_type,name,start_date,cycle_weeks,days_off").order("start_date"),
    supabase.from("escala_on_call_shifts").select("id,team_id,weekend_start,comp_dates,notes").order("weekend_start"),
    supabase.from("escala_holidays").select("id,date,name,kind,day_off,on_call_team_ids,on_call_hours,comp_date").order("date"),
  ]);
  for (const r of [teams, technicians, absences, settings, patterns, onCall, holidays]) fail(r.error);
  return {
    teams: (teams.data ?? []).map((t) => ({ ...t, id: Number(t.id) })),
    technicians: (technicians.data ?? []).map((t) => ({
      id: Number(t.id),
      name: t.name,
      phone: t.phone,
      role: t.role,
      teamId: t.team_id === null ? null : Number(t.team_id),
    })),
    absences: (absences.data ?? []).map((a) => ({
      id: Number(a.id),
      technicianId: Number(a.technician_id),
      startDate: a.start_date,
      endDate: a.end_date,
      kind: a.kind,
      notes: a.notes,
    })),
    settings: (settings.data ?? []).map((s) => ({
      sector: s.sector,
      minCoverage: (s.min_coverage as number[]).map(Number),
      maxConsecutive: s.max_consecutive,
      hoursSixOne: Number(s.hours_six_one),
      hoursSixOneSaturday: Number(s.hours_six_one_saturday),
      hoursFiveTwo: Number(s.hours_five_two),
      shiftStart: s.shift_start,
      shiftEnd: s.shift_end,
      onCallTeams: s.on_call_teams,
      onCallSaturday: s.on_call_saturday,
      onCallSunday: s.on_call_sunday,
    })),
    patterns: (patterns.data ?? []).map((p) => ({
      id: Number(p.id),
      sector: p.sector,
      scaleType: p.scale_type,
      name: p.name,
      startDate: p.start_date,
      cycleWeeks: p.cycle_weeks,
      daysOff: p.days_off as PatternDays,
    })),
    onCallShifts: (onCall.data ?? []).map((s) => ({
      id: Number(s.id),
      teamId: Number(s.team_id),
      weekendStart: s.weekend_start,
      compDates: s.comp_dates as string[],
      notes: s.notes,
    })),
    holidays: (holidays.data ?? []).map((h) => ({
      id: Number(h.id),
      date: h.date,
      name: h.name,
      kind: h.kind,
      dayOff: h.day_off,
      onCallTeamIds: (h.on_call_team_ids as number[]).map(Number),
      onCallHours: h.on_call_hours,
      compDate: h.comp_date,
    })),
  };
}

/** Grava (insere ou atualiza pelo id) e devolve o id. */
async function upsertRow(table: string, id: number | undefined, values: Record<string, unknown>, duplicateMessage?: string) {
  if (id) {
    const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id").maybeSingle();
    fail(error, duplicateMessage);
    if (!data) throw new Error("Registro não encontrado");
    return { id: Number(data.id) };
  }
  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  fail(error, duplicateMessage);
  return { id: Number(data!.id) };
}

async function deleteRow(table: string, id: number) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  fail(error);
  return { ok: true as const };
}

const idSchema = z.object({ id: z.number().int() });

// ---------- equipes ----------

export const teamSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1, "Informe o nome da equipe"),
  code: z.string().trim().min(1, "Informe o código").max(8),
  sector: z.enum(SectorArrayValues),
  vehicle: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveTeam(body: z.infer<typeof teamSchema>) {
  const input = teamSchema.parse(body);
  return upsertRow("escala_teams", input.id, {
    name: input.name,
    code: input.code.toUpperCase(),
    sector: input.sector,
    vehicle: input.vehicle || null,
    notes: input.notes || null,
  });
}

export async function deleteTeam(body: z.infer<typeof idSchema>) {
  const { id } = idSchema.parse(body);
  // técnicos ficam sem equipe (ON DELETE SET NULL) e plantões saem junto (CASCADE);
  // aqui tiramos a equipe das escalas e dos plantões de feriado
  const { data: patterns, error } = await supabase.from("escala_schedule_patterns").select("id,days_off");
  fail(error);
  for (const p of patterns ?? []) {
    const days = { ...(p.days_off as Record<string, unknown>) };
    if (String(id) in days) {
      delete days[String(id)];
      fail((await supabase.from("escala_schedule_patterns").update({ days_off: days }).eq("id", p.id)).error);
    }
  }
  const { data: hols, error: hErr } = await supabase.from("escala_holidays").select("id,on_call_team_ids");
  fail(hErr);
  for (const h of hols ?? []) {
    const ids = (h.on_call_team_ids as number[]).map(Number);
    if (ids.includes(id)) {
      fail((await supabase.from("escala_holidays").update({ on_call_team_ids: ids.filter((x) => x !== id) }).eq("id", h.id)).error);
    }
  }
  return deleteRow("escala_teams", id);
}

// ---------- técnicos ----------

export const technicianSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1, "Informe o nome do técnico"),
  phone: z.string().trim().nullable(),
  role: z.string().trim().nullable(),
  teamId: z.number().int().nullable(),
});

export async function saveTechnician(body: z.infer<typeof technicianSchema>) {
  const input = technicianSchema.parse(body);
  if (input.teamId !== null) {
    const { data, error } = await supabase
      .from("escala_technicians")
      .select("id")
      .eq("team_id", input.teamId)
      .neq("id", input.id ?? -1);
    fail(error);
    if ((data ?? []).length >= 2) throw new Error("Essa equipe já tem uma dupla completa (2 técnicos).");
  }
  return upsertRow("escala_technicians", input.id, {
    name: input.name,
    phone: input.phone || null,
    role: input.role || null,
    team_id: input.teamId,
  });
}

export async function deleteTechnician(body: z.infer<typeof idSchema>) {
  return deleteRow("escala_technicians", idSchema.parse(body).id);
}

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

export async function saveAbsence(body: z.infer<typeof absenceSchema>) {
  const input = absenceSchema.parse(body);
  return upsertRow("escala_absences", input.id, {
    technician_id: input.technicianId,
    start_date: input.startDate,
    end_date: input.endDate,
    kind: input.kind,
    notes: input.notes || null,
  });
}

export async function deleteAbsence(body: z.infer<typeof idSchema>) {
  return deleteRow("escala_absences", idSchema.parse(body).id);
}

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

export async function saveSettings(body: z.infer<typeof settingsSchema>) {
  const s = settingsSchema.parse(body);
  const { error } = await supabase.from("escala_sector_settings").upsert(
    {
      sector: s.sector,
      min_coverage: s.minCoverage,
      max_consecutive: s.maxConsecutive,
      hours_six_one: s.hoursSixOne,
      hours_six_one_saturday: s.hoursSixOneSaturday,
      hours_five_two: s.hoursFiveTwo,
      shift_start: s.shiftStart,
      shift_end: s.shiftEnd,
      on_call_teams: s.onCallTeams,
      on_call_saturday: s.onCallSaturday,
      on_call_sunday: s.onCallSunday,
    },
    { onConflict: "sector" },
  );
  fail(error);
  return { ok: true as const };
}

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

export async function savePattern(body: z.infer<typeof patternSchema>) {
  const input = patternSchema.parse(body);
  const total = input.cycleWeeks * 7;
  const daysOff = Object.fromEntries(Object.entries(input.daysOff).map(([team, list]) => [team, list.filter((o) => o.day < total)]));
  return upsertRow(
    "escala_schedule_patterns",
    input.id,
    {
      sector: input.sector,
      scale_type: input.scaleType,
      name: input.name,
      start_date: input.startDate,
      cycle_weeks: input.cycleWeeks,
      days_off: daysOff,
    },
    "Já existe uma escala deste setor começando nessa data. Escolha outra data ou edite a existente.",
  );
}

export async function deletePattern(body: z.infer<typeof idSchema>) {
  return deleteRow("escala_schedule_patterns", idSchema.parse(body).id);
}

// ---------- plantões de fim de semana ----------

export const onCallBulkSchema = z.object({
  sector: z.enum(SectorArrayValues),
  fromDate: isoDate,
  toDate: isoDate,
  shifts: z.array(z.object({ teamId: z.number().int(), weekendStart: isoDate, compDates: z.array(isoDate).max(5) })),
});

/** Substitui os plantões do setor no intervalo (função escala_replace_on_call no banco, atômica). */
export async function bulkOnCall(body: z.infer<typeof onCallBulkSchema>) {
  const input = onCallBulkSchema.parse(body);
  const { data, error } = await supabase.rpc("escala_replace_on_call", {
    p_sector: input.sector,
    p_from: input.fromDate,
    p_to: input.toDate,
    p_shifts: input.shifts,
  });
  fail(error);
  return { created: Number(data ?? input.shifts.length) };
}

export const onCallSchema = z
  .object({
    id: z.number().int().optional(),
    teamId: z.number().int(),
    weekendStart: isoDate,
    compDates: z.array(isoDate).max(5),
    notes: z.string().trim().nullable(),
  })
  .refine((v) => isWeekday(v.weekendStart, 6), { message: "O plantão começa num sábado", path: ["weekendStart"] });

export async function saveOnCall(body: z.infer<typeof onCallSchema>) {
  const input = onCallSchema.parse(body);
  return upsertRow(
    "escala_on_call_shifts",
    input.id,
    {
      team_id: input.teamId,
      weekend_start: input.weekendStart,
      comp_dates: [...new Set(input.compDates)].sort(),
      notes: input.notes || null,
    },
    "Essa dupla já está de plantão nesse fim de semana.",
  );
}

export async function deleteOnCall(body: z.infer<typeof idSchema>) {
  return deleteRow("escala_on_call_shifts", idSchema.parse(body).id);
}

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

export async function saveHoliday(body: z.infer<typeof holidaySchema>) {
  const input = holidaySchema.parse(body);
  return upsertRow(
    "escala_holidays",
    input.id,
    {
      date: input.date,
      name: input.name,
      kind: input.kind,
      day_off: input.dayOff,
      on_call_team_ids: [...new Set(input.onCallTeamIds)],
      on_call_hours: input.onCallHours,
      comp_date: input.compDate,
    },
    "Já existe um feriado nessa data.",
  );
}

export async function deleteHoliday(body: z.infer<typeof idSchema>) {
  return deleteRow("escala_holidays", idSchema.parse(body).id);
}

/** Importa os feriados nacionais do ano, sem sobrescrever datas já cadastradas. */
export async function importHolidays(body: { year: number }) {
  const { year } = z.object({ year: z.number().int().min(2000).max(2100) }).parse(body);
  const list = scheduleEngine.brazilNationalHolidays(year);
  const { data, error } = await supabase
    .from("escala_holidays")
    .upsert(
      list.map((h) => ({ date: h.date, name: h.name, kind: h.kind, day_off: h.dayOff, on_call_team_ids: [] })),
      { onConflict: "date", ignoreDuplicates: true },
    )
    .select("id");
  fail(error);
  return { created: (data ?? []).length };
}
