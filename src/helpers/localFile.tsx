/**
 * Lê o arquivo do banco local das versões anteriores (escala-tecnica.sqlite) direto no navegador,
 * no mesmo formato de getData, para enviar à nuvem. Aceita bancos de qualquer versão (colunas novas podem faltar).
 */
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { OutputType } from "../endpoints/data_GET.schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const parse = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

function all(db: Database, sql: string): Row[] {
  const stmt = db.prepare(sql);
  const out: Row[] = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export async function readLocalDbFile(file: File): Promise<OutputType> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let db: Database;
  try {
    db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    all(db, "SELECT name FROM sqlite_master LIMIT 1");
  } catch {
    throw new Error("Esse arquivo não é um banco do Escala Técnica (.sqlite).");
  }
  const tables = new Set(all(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)));
  if (!tables.has("teams") || !tables.has("technicians")) throw new Error("Esse arquivo não é um banco do Escala Técnica (.sqlite).");
  const rows = (t: string, order = "") => (tables.has(t) ? all(db, `SELECT * FROM ${t}${order}`) : []);
  const meta = rows("meta");
  const ts = rows("trip_settings")[0];

  const data: OutputType = {
    teams: rows("teams", " ORDER BY sector DESC, code").map((t) => ({ id: t.id, name: t.name, code: t.code, sector: t.sector, vehicle: t.vehicle, notes: t.notes })),
    technicians: rows("technicians", " ORDER BY name").map((t) => ({ id: t.id, name: t.name, phone: t.phone, role: t.role, teamId: t.team_id ?? null })),
    absences: rows("absences").map((a) => ({ id: a.id, technicianId: a.technician_id, startDate: a.start_date, endDate: a.end_date, kind: a.kind, notes: a.notes })),
    settings: rows("sector_settings").map((s) => ({
      sector: s.sector,
      minCoverage: parse<number[]>(s.min_coverage, [0, 0, 0, 0, 0, 0, 0]).map(Number),
      maxConsecutive: s.max_consecutive,
      hoursSixOne: Number(s.hours_six_one),
      hoursSixOneSaturday: Number(s.hours_six_one_saturday ?? 4),
      hoursFiveTwo: Number(s.hours_five_two),
      shiftStart: s.shift_start,
      shiftEnd: s.shift_end,
      onCallTeams: s.on_call_teams,
      onCallSaturday: s.on_call_saturday,
      onCallSunday: s.on_call_sunday,
    })),
    patterns: rows("schedule_patterns", " ORDER BY start_date").map((p) => ({
      id: p.id,
      sector: p.sector,
      scaleType: p.scale_type,
      name: p.name,
      startDate: p.start_date,
      cycleWeeks: p.cycle_weeks,
      daysOff: parse(p.days_off, {}),
    })),
    onCallShifts: rows("on_call_shifts", " ORDER BY weekend_start").map((s) => ({
      id: s.id,
      teamId: s.team_id,
      weekendStart: s.weekend_start,
      compDates: parse<string[]>(s.comp_dates, []),
      notes: s.notes ?? null,
    })),
    holidays: rows("holidays", " ORDER BY date").map((h) => ({
      id: h.id,
      date: h.date,
      name: h.name,
      kind: h.kind,
      dayOff: h.day_off === 1,
      onCallTeamIds: parse<number[]>(h.on_call_team_ids, []).map(Number),
      onCallHours: h.on_call_hours ?? "08:00-12:00,14:00-18:00",
      compDate: h.comp_date ?? null,
    })),
    trips: rows("trips", " ORDER BY depart_at DESC").map((t) => ({
      id: t.id,
      technicianIds: parse<number[]>(t.technician_ids, []).map(Number),
      destination: t.destination,
      reason: t.reason,
      vehicle: t.vehicle,
      departAt: t.depart_at,
      returnAt: t.return_at,
      returnedAt: t.returned_at,
      status: t.status,
      advance: Number(t.advance),
      notes: t.notes,
      perDiem: t.per_diem == null ? null : t.per_diem === 1,
    })),
    tripSettings: {
      fullValue: Number(ts?.full_value ?? 120),
      halfValue: Number(ts?.half_value ?? 60),
      minHoursHalf: Number(ts?.min_hours_half ?? 6),
      halfOnReturn: (ts?.half_on_return ?? 1) === 1,
      paidDestinations: parse<string[]>(ts?.paid_destinations, ["Rondolândia", "Fazenda Castanhal", "Fazenda Peralta"]),
    },
    lockers: rows("lockers", " ORDER BY id").map((l) => ({ id: l.id, name: l.name, sector: l.sector, since: l.since, note: l.note, technicianId: l.technician_id ?? null })),
    motorConfig: parse(meta.find((m) => m.key === "motor_config")?.value, null),
    overrides: [],
    ignoredAlerts: [],
  };
  db.close();
  return data;
}
