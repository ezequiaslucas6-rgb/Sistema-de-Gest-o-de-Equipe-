/**
 * Banco na nuvem (Supabase, tabelas escala_*): as mesmas operações que o banco local (electron/db.cjs) fazia.
 * A validação das entradas continua em helpers/api.tsx; aqui só leitura e gravação.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { OutputType } from "../endpoints/data_GET.schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Op = (input: any) => Promise<unknown>;

const TABLES = {
  teams: "escala_teams",
  technicians: "escala_technicians",
  absences: "escala_absences",
  settings: "escala_sector_settings",
  patterns: "escala_schedule_patterns",
  shifts: "escala_on_call_shifts",
  holidays: "escala_holidays",
  lockers: "escala_lockers",
  trips: "escala_trips",
  tripSettings: "escala_trip_settings",
  meta: "escala_meta",
  overrides: "escala_day_overrides",
} as const;

/** Erro do banco em português (duplicidade vira a mensagem da operação). */
function fail(error: PostgrestError | null, duplicate?: string): void {
  if (!error) return;
  if (error.code === "23505" && duplicate) throw new Error(duplicate);
  if (error.code === "42501" || /row-level security/i.test(error.message)) throw new Error("Sem permissão para alterar os dados. Entre com um usuário liberado.");
  if (/Failed to fetch|NetworkError|fetch failed/i.test(error.message)) throw new Error("Sem conexão com a internet (Supabase).");
  throw new Error(error.message);
}

async function rows<T = Row>(q: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>): Promise<T[]> {
  const { data, error } = await q;
  fail(error);
  return data ?? [];
}

async function upsert(table: string, id: number | undefined, values: Row, duplicate?: string): Promise<{ id: number }> {
  if (id) {
    const { data, error } = await supabase.from(table).update(values).eq("id", id).select("id");
    fail(error, duplicate);
    if (!data?.length) throw new Error("Registro não encontrado");
    return { id };
  }
  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  fail(error, duplicate);
  return { id: Number(data!.id) };
}

async function remove(table: string, id: number) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  fail(error);
  return { ok: true as const };
}

const uniqSorted = (a: string[]) => [...new Set(a)].sort();
const num = (v: unknown) => Number(v);

// ---------- leitura ----------
export async function cloudGetData(): Promise<OutputType> {
  const [teams, technicians, absences, settings, patterns, shifts, holidays, lockers, trips, tripSettings, meta, overrides] = await Promise.all([
    rows(supabase.from(TABLES.teams).select("id, name, code, sector, vehicle, notes").order("sector", { ascending: false }).order("code")),
    rows(supabase.from(TABLES.technicians).select("id, name, phone, role, team_id").order("name")),
    rows(supabase.from(TABLES.absences).select("id, technician_id, start_date, end_date, kind, notes").order("start_date")),
    rows(supabase.from(TABLES.settings).select("*")),
    rows(supabase.from(TABLES.patterns).select("id, sector, scale_type, name, start_date, cycle_weeks, days_off").order("start_date")),
    rows(supabase.from(TABLES.shifts).select("id, team_id, weekend_start, comp_dates, notes").order("weekend_start")),
    rows(supabase.from(TABLES.holidays).select("id, date, name, kind, day_off, on_call_team_ids, on_call_hours, comp_date").order("date")),
    rows(supabase.from(TABLES.lockers).select("id, name, sector, since, note, technician_id").order("id")),
    rows(supabase.from(TABLES.trips).select("*").order("depart_at", { ascending: false })),
    rows(supabase.from(TABLES.tripSettings).select("*").eq("id", 1)),
    rows(supabase.from(TABLES.meta).select("key, value").in("key", ["motor_config", "alertas_ignorados"])),
    rows(supabase.from(TABLES.overrides).select("id, team_id, date, status, note").order("date")),
  ]);
  const ts = tripSettings[0] ?? { full_value: 120, half_value: 60, min_hours_half: 6, half_on_return: true, paid_destinations: [] };
  return {
    teams: teams.map((t) => ({ id: num(t.id), name: t.name, code: t.code, sector: t.sector, vehicle: t.vehicle, notes: t.notes })),
    technicians: technicians.map((t) => ({ id: num(t.id), name: t.name, phone: t.phone, role: t.role, teamId: t.team_id == null ? null : num(t.team_id) })),
    absences: absences.map((a) => ({ id: num(a.id), technicianId: num(a.technician_id), startDate: a.start_date, endDate: a.end_date, kind: a.kind, notes: a.notes })),
    settings: settings.map((s) => ({
      sector: s.sector,
      minCoverage: (s.min_coverage ?? [0, 0, 0, 0, 0, 0, 0]).map(Number),
      maxConsecutive: s.max_consecutive,
      hoursSixOne: num(s.hours_six_one),
      hoursSixOneSaturday: num(s.hours_six_one_saturday),
      hoursFiveTwo: num(s.hours_five_two),
      shiftStart: s.shift_start,
      shiftEnd: s.shift_end,
      onCallTeams: s.on_call_teams,
      onCallSaturday: s.on_call_saturday,
      onCallSunday: s.on_call_sunday,
    })),
    patterns: patterns.map((p) => ({ id: num(p.id), sector: p.sector, scaleType: p.scale_type, name: p.name, startDate: p.start_date, cycleWeeks: p.cycle_weeks, daysOff: p.days_off ?? {} })),
    onCallShifts: shifts.map((s) => ({ id: num(s.id), teamId: num(s.team_id), weekendStart: s.weekend_start, compDates: s.comp_dates ?? [], notes: s.notes })),
    holidays: holidays.map((h) => ({
      id: num(h.id),
      date: h.date,
      name: h.name,
      kind: h.kind,
      dayOff: !!h.day_off,
      onCallTeamIds: (h.on_call_team_ids ?? []).map(Number),
      onCallHours: h.on_call_hours,
      compDate: h.comp_date,
    })),
    lockers: lockers.map((l) => ({ id: l.id, name: l.name, sector: l.sector, since: l.since, note: l.note, technicianId: l.technician_id == null ? null : num(l.technician_id) })),
    trips: trips.map((t) => ({
      id: num(t.id),
      technicianIds: (t.technician_ids ?? []).map(Number),
      destination: t.destination,
      reason: t.reason,
      vehicle: t.vehicle,
      departAt: t.depart_at,
      returnAt: t.return_at,
      returnedAt: t.returned_at,
      status: t.status,
      advance: num(t.advance),
      notes: t.notes,
      perDiem: t.per_diem ?? null,
    })),
    tripSettings: {
      fullValue: num(ts.full_value),
      halfValue: num(ts.half_value),
      minHoursHalf: num(ts.min_hours_half),
      halfOnReturn: !!ts.half_on_return,
      paidDestinations: ts.paid_destinations ?? [],
    },
    motorConfig: (meta.find((m) => m.key === "motor_config")?.value as OutputType["motorConfig"]) ?? null,
    ignoredAlerts: (meta.find((m) => m.key === "alertas_ignorados")?.value as string[]) ?? [],
    overrides: overrides.map((o) => ({ id: num(o.id), teamId: num(o.team_id), date: o.date, status: o.status, note: o.note })),
  };
}

// ---------- plantões em lote ----------
/** Substitui os plantões dos setores no intervalo: apaga os que saem e grava os novos (upsert por dupla + fim de semana). */
async function replaceShifts(sectors: { sector: string; shifts: { teamId: number; weekendStart: string; compDates: string[]; notes?: string | null }[] }[], from: string, to: string) {
  const teams = await rows(supabase.from(TABLES.teams).select("id, sector"));
  let created = 0;
  for (const sec of sectors) {
    const teamIds = teams.filter((t) => t.sector === sec.sector).map((t) => num(t.id));
    if (sec.shifts.some((s) => !teamIds.includes(s.teamId))) throw new Error("Equipe não pertence ao setor");
    if (teamIds.length === 0) continue;
    const existing = await rows(supabase.from(TABLES.shifts).select("id, team_id, weekend_start").in("team_id", teamIds).gte("weekend_start", from).lte("weekend_start", to));
    const keep = new Set(sec.shifts.map((s) => `${s.teamId}|${s.weekendStart}`));
    const drop = existing.filter((e) => !keep.has(`${num(e.team_id)}|${e.weekend_start}`)).map((e) => num(e.id));
    if (drop.length) {
      const { error } = await supabase.from(TABLES.shifts).delete().in("id", drop);
      fail(error);
    }
    if (sec.shifts.length) {
      const { error } = await supabase.from(TABLES.shifts).upsert(
        sec.shifts.map((s) => ({ team_id: s.teamId, weekend_start: s.weekendStart, comp_dates: uniqSorted(s.compDates), notes: s.notes || null })),
        { onConflict: "team_id,weekend_start" },
      );
      fail(error);
    }
    created += sec.shifts.length;
  }
  return created;
}

export const cloudOps: Record<string, Op> = {
  getData: () => cloudGetData(),

  // equipes e técnicos
  saveTeam: (i) => upsert(TABLES.teams, i.id, { name: i.name, code: i.code.toUpperCase(), sector: i.sector, vehicle: i.vehicle || null, notes: i.notes || null }),
  deleteTeam: async ({ id }) => {
    // tira a dupla das escalas e dos feriados; técnicos ficam sem dupla; plantões saem (CASCADE)
    for (const p of await rows(supabase.from(TABLES.patterns).select("id, days_off"))) {
      const days = { ...(p.days_off ?? {}) };
      if (String(id) in days) {
        delete days[String(id)];
        fail((await supabase.from(TABLES.patterns).update({ days_off: days }).eq("id", p.id)).error);
      }
    }
    for (const h of await rows(supabase.from(TABLES.holidays).select("id, on_call_team_ids"))) {
      const ids = (h.on_call_team_ids ?? []).map(Number);
      if (ids.includes(id)) fail((await supabase.from(TABLES.holidays).update({ on_call_team_ids: ids.filter((x: number) => x !== id) }).eq("id", h.id)).error);
    }
    return remove(TABLES.teams, id);
  },
  saveTechnician: async (i) => {
    if (i.teamId !== null) {
      const { count, error } = await supabase.from(TABLES.technicians).select("id", { count: "exact", head: true }).eq("team_id", i.teamId).neq("id", i.id ?? -1);
      fail(error);
      if ((count ?? 0) >= 2) throw new Error("Essa equipe já tem uma dupla completa (2 técnicos).");
    }
    return upsert(TABLES.technicians, i.id, { name: i.name, phone: i.phone || null, role: i.role || null, team_id: i.teamId });
  },
  deleteTechnician: ({ id }) => remove(TABLES.technicians, id),

  // ausências e regras do setor
  saveAbsence: (i) => upsert(TABLES.absences, i.id, { technician_id: i.technicianId, start_date: i.startDate, end_date: i.endDate, kind: i.kind, notes: i.notes || null }),
  deleteAbsence: ({ id }) => remove(TABLES.absences, id),
  saveSettings: async (s) => {
    const { error } = await supabase.from(TABLES.settings).upsert(
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
    return { ok: true };
  },

  // escalas
  savePattern: (i) =>
    upsert(
      TABLES.patterns,
      i.id,
      { sector: i.sector, scale_type: i.scaleType, name: i.name, start_date: i.startDate, cycle_weeks: i.cycleWeeks, days_off: i.daysOff },
      "Já existe uma escala deste setor começando nessa data. Escolha outra data ou edite a existente.",
    ),
  deletePattern: ({ id }) => remove(TABLES.patterns, id),

  // plantões
  bulkOnCall: async (i) => ({ created: await replaceShifts([{ sector: i.sector, shifts: i.shifts }], i.fromDate, i.toDate) }),
  applyOnCallPlan: async (i) => {
    const created = await replaceShifts(i.sectors, i.fromDate, i.toDate);
    for (const h of i.holidays) {
      fail((await supabase.from(TABLES.holidays).update({ on_call_team_ids: [...new Set(h.onCallTeamIds)], comp_date: h.compDate }).eq("id", h.id)).error);
    }
    for (const b of i.basePatterns) {
      const teams = await rows(supabase.from(TABLES.teams).select("id").eq("sector", b.sector));
      const { error } = await supabase.from(TABLES.patterns).upsert(
        {
          sector: b.sector,
          scale_type: "6x1",
          name: "Escala 6x1 (seg–sáb, domingo folga) — motor de plantão",
          start_date: b.startDate,
          cycle_weeks: 1,
          days_off: Object.fromEntries(teams.map((t) => [String(t.id), [{ day: 6, kind: "regular" }]])),
        },
        { onConflict: "sector,start_date", ignoreDuplicates: true },
      );
      fail(error);
    }
    return { created };
  },
  applyOnCallAdjust: async (i) => {
    for (const u of i.shifts) fail((await supabase.from(TABLES.shifts).update({ team_id: u.teamId, notes: u.notes || null }).eq("id", u.id)).error);
    for (const h of i.holidays) fail((await supabase.from(TABLES.holidays).update({ on_call_team_ids: [...new Set(h.onCallTeamIds)] }).eq("id", h.id)).error);
    return { changed: i.shifts.length + i.holidays.length };
  },
  saveIgnoredAlerts: async ({ keys }) => {
    fail((await supabase.from(TABLES.meta).upsert({ key: "alertas_ignorados", value: keys }, { onConflict: "key" })).error);
    return { ok: true };
  },
  saveMotorConfig: async (i) => {
    fail((await supabase.from(TABLES.meta).upsert({ key: "motor_config", value: i }, { onConflict: "key" })).error);
    return { ok: true };
  },
  saveOnCall: (i) =>
    upsert(
      TABLES.shifts,
      i.id,
      { team_id: i.teamId, weekend_start: i.weekendStart, comp_dates: uniqSorted(i.compDates), notes: i.notes || null },
      "Essa dupla já está de plantão nesse fim de semana.",
    ),
  deleteOnCall: ({ id }) => remove(TABLES.shifts, id),

  // ajustes de um dia (tabela da escala)
  saveOverride: async (i) => {
    const { error } = await supabase
      .from(TABLES.overrides)
      .upsert({ team_id: i.teamId, date: i.date, status: i.status, note: i.note || null }, { onConflict: "team_id,date" });
    fail(error);
    return { ok: true };
  },
  deleteOverride: async ({ teamId, date }) => {
    fail((await supabase.from(TABLES.overrides).delete().eq("team_id", teamId).eq("date", date)).error);
    return { ok: true };
  },

  // feriados
  saveHoliday: (i) =>
    upsert(
      TABLES.holidays,
      i.id,
      {
        date: i.date,
        name: i.name,
        kind: i.kind,
        day_off: i.dayOff,
        on_call_team_ids: [...new Set(i.onCallTeamIds)],
        on_call_hours: i.onCallHours,
        comp_date: i.compDate,
      },
      "Já existe um feriado nessa data.",
    ),
  deleteHoliday: ({ id }) => remove(TABLES.holidays, id),
  insertHolidays: async ({ holidays }) => {
    const { data, error } = await supabase
      .from(TABLES.holidays)
      .upsert(
        holidays.map((h: Row) => ({ date: h.date, name: h.name, kind: h.kind, day_off: h.dayOff, on_call_team_ids: [] })),
        { onConflict: "date", ignoreDuplicates: true },
      )
      .select("id");
    fail(error);
    return { created: data?.length ?? 0 };
  },

  // armários
  saveLocker: async (i) => {
    const { error } = await supabase.from(TABLES.lockers).upsert(
      { id: i.id, name: i.name, sector: i.sector || null, since: i.since || null, note: i.note || null, technician_id: i.technicianId ?? null, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    fail(error);
    return { ok: true };
  },
  freeLocker: async ({ id }) => {
    fail((await supabase.from(TABLES.lockers).delete().eq("id", id)).error);
    return { ok: true };
  },

  // viagens
  saveTrip: (i) =>
    upsert(TABLES.trips, i.id, {
      technician_ids: [...new Set(i.technicianIds)],
      destination: i.destination,
      reason: i.reason || null,
      vehicle: i.vehicle || null,
      depart_at: i.departAt,
      return_at: i.returnAt,
      returned_at: i.returnedAt || null,
      status: i.status,
      advance: i.advance,
      per_diem: i.perDiem ?? null,
      notes: i.notes || null,
    }),
  setTripStatus: async ({ id, status }) => {
    const { data, error } = await supabase.from(TABLES.trips).update({ status }).eq("id", id).select("id");
    fail(error);
    if (!data?.length) throw new Error("Viagem não encontrada");
    return { ok: true };
  },
  deleteTrip: ({ id }) => remove(TABLES.trips, id),
  saveTripSettings: async (t) => {
    const { error } = await supabase.from(TABLES.tripSettings).upsert(
      { id: 1, full_value: t.fullValue, half_value: t.halfValue, min_hours_half: t.minHoursHalf, half_on_return: t.halfOnReturn, paid_destinations: t.paidDestinations },
      { onConflict: "id" },
    );
    fail(error);
    return { ok: true };
  },
};

// ---------- envio dos dados do computador para a nuvem ----------
/**
 * Substitui tudo na nuvem pelos dados do banco local. Os ids mudam na nuvem, então todas as referências
 * (dupla do técnico, plantões, feriados, escalas, armários, viagens, configuração do motor) são remapeadas.
 */
export async function replaceCloudWith(local: OutputType, onStep?: (msg: string) => void): Promise<void> {
  const step = (m: string) => onStep?.(m);
  step("Limpando os dados antigos da nuvem…");
  for (const table of [TABLES.lockers, TABLES.trips, TABLES.absences, TABLES.shifts, TABLES.holidays, TABLES.patterns, TABLES.technicians, TABLES.teams]) {
    // o Supabase exige um filtro no DELETE: "id não vazio" pega todas as linhas
    const q = supabase.from(table).delete();
    fail((await (table === TABLES.lockers ? q.neq("id", "") : q.gte("id", 0))).error);
  }

  step("Enviando duplas e técnicos…");
  const teamMap = new Map<number, number>();
  for (const t of local.teams) {
    const { data, error } = await supabase.from(TABLES.teams).insert({ name: t.name, code: t.code, sector: t.sector, vehicle: t.vehicle, notes: t.notes }).select("id").single();
    fail(error);
    teamMap.set(t.id, num(data!.id));
  }
  const techMap = new Map<number, number>();
  for (const t of local.technicians) {
    const { data, error } = await supabase
      .from(TABLES.technicians)
      .insert({ name: t.name, phone: t.phone, role: t.role, team_id: t.teamId == null ? null : (teamMap.get(t.teamId) ?? null) })
      .select("id")
      .single();
    fail(error);
    techMap.set(t.id, num(data!.id));
  }
  const team = (id: number) => teamMap.get(id);
  const tech = (id: number) => techMap.get(id);

  step("Enviando regras, escalas e ausências…");
  for (const s of local.settings) await cloudOps.saveSettings(s);
  if (local.patterns.length) {
    fail(
      (
        await supabase.from(TABLES.patterns).insert(
          local.patterns.map((p) => ({
            sector: p.sector,
            scale_type: p.scaleType,
            name: p.name,
            start_date: p.startDate,
            cycle_weeks: p.cycleWeeks,
            days_off: Object.fromEntries(Object.entries(p.daysOff).filter(([k]) => team(Number(k))).map(([k, v]) => [String(team(Number(k))), v])),
          })),
        )
      ).error,
    );
  }
  const absences = local.absences.filter((a) => tech(a.technicianId));
  if (absences.length) {
    fail(
      (
        await supabase
          .from(TABLES.absences)
          .insert(absences.map((a) => ({ technician_id: tech(a.technicianId), start_date: a.startDate, end_date: a.endDate, kind: a.kind, notes: a.notes })))
      ).error,
    );
  }

  step("Enviando plantões e feriados…");
  const shifts = local.onCallShifts.filter((s) => team(s.teamId));
  for (let k = 0; k < shifts.length; k += 200) {
    fail(
      (
        await supabase
          .from(TABLES.shifts)
          .insert(shifts.slice(k, k + 200).map((s) => ({ team_id: team(s.teamId), weekend_start: s.weekendStart, comp_dates: s.compDates, notes: s.notes })))
      ).error,
    );
  }
  if (local.holidays.length) {
    fail(
      (
        await supabase.from(TABLES.holidays).insert(
          local.holidays.map((h) => ({
            date: h.date,
            name: h.name,
            kind: h.kind,
            day_off: h.dayOff,
            on_call_team_ids: h.onCallTeamIds.map(team).filter(Boolean),
            on_call_hours: h.onCallHours,
            comp_date: h.compDate,
          })),
        )
      ).error,
    );
  }

  step("Enviando armários e viagens…");
  if (local.lockers.length) {
    fail(
      (
        await supabase
          .from(TABLES.lockers)
          .insert(local.lockers.map((l) => ({ id: l.id, name: l.name, sector: l.sector, since: l.since, note: l.note, technician_id: l.technicianId == null ? null : (tech(l.technicianId) ?? null) })))
      ).error,
    );
  }
  if (local.trips.length) {
    fail(
      (
        await supabase.from(TABLES.trips).insert(
          local.trips.map((t) => ({
            technician_ids: t.technicianIds.map(tech).filter(Boolean),
            destination: t.destination,
            reason: t.reason,
            vehicle: t.vehicle,
            depart_at: t.departAt,
            return_at: t.returnAt,
            returned_at: t.returnedAt,
            status: t.status,
            advance: t.advance,
            notes: t.notes,
            per_diem: t.perDiem ?? null,
          })),
        )
      ).error,
    );
  }
  await cloudOps.saveTripSettings({ ...local.tripSettings, paidDestinations: local.tripSettings.paidDestinations ?? [] });
  if (local.motorConfig) {
    const c = local.motorConfig;
    const mapIds = (ids: number[]) => ids.map(team).filter((x): x is number => !!x);
    await cloudOps.saveMotorConfig({
      ...c,
      order: { suporte: mapIds(c.order.suporte), infraestrutura: mapIds(c.order.infraestrutura) },
      excluded: mapIds(c.excluded),
    });
  }
  step("Pronto.");
}

/** Assina as mudanças nas tabelas da escala (outro computador gravou) e chama `onChange`. */
export function subscribeCloudChanges(onChange: () => void): () => void {
  let timer: number | undefined;
  const fire = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, 400);
  };
  const channel = supabase.channel("escala-mudancas");
  for (const table of Object.values(TABLES)) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, fire);
  }
  channel.subscribe();
  return () => {
    window.clearTimeout(timer);
    void supabase.removeChannel(channel);
  };
}
