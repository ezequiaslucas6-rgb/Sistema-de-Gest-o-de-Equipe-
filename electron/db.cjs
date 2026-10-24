/**
 * Banco de dados local (SQLite via sql.js, sem dependências nativas).
 * O arquivo fica no computador do usuário; cada gravação salva o arquivo inteiro de forma atômica.
 * As regras de negócio (escala, plantão, feriados) ficam no app; aqui só leitura e gravação.
 */
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");

const SCHEMA_VERSION = 4; // 2: mapa dos armários; 3: viagens e diárias; 4: destinos que geram diária

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('suporte', 'infraestrutura')),
  vehicle TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technician_id INTEGER NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ferias', 'atestado', 'folga_extra', 'treinamento', 'outro')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS sector_settings (
  sector TEXT PRIMARY KEY CHECK (sector IN ('suporte', 'infraestrutura')),
  min_coverage TEXT NOT NULL,
  max_consecutive INTEGER NOT NULL DEFAULT 6,
  hours_six_one REAL NOT NULL DEFAULT 8,
  hours_six_one_saturday REAL NOT NULL DEFAULT 4,
  hours_five_two REAL NOT NULL DEFAULT 8.8,
  shift_start TEXT NOT NULL DEFAULT '08:00',
  shift_end TEXT NOT NULL DEFAULT '17:48',
  on_call_teams INTEGER NOT NULL DEFAULT 1,
  on_call_saturday TEXT NOT NULL DEFAULT '14:00-18:00',
  on_call_sunday TEXT NOT NULL DEFAULT '08:00-12:00,14:00-18:00'
);

CREATE TABLE IF NOT EXISTS schedule_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT NOT NULL CHECK (sector IN ('suporte', 'infraestrutura')),
  scale_type TEXT NOT NULL CHECK (scale_type IN ('6x1', '5x2')),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  cycle_weeks INTEGER NOT NULL CHECK (cycle_weeks > 0),
  days_off TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sector, start_date)
);

CREATE TABLE IF NOT EXISTS on_call_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  weekend_start TEXT NOT NULL,
  comp_dates TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (team_id, weekend_start)
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('nacional', 'estadual', 'municipal', 'ponto_facultativo')),
  day_off INTEGER NOT NULL DEFAULT 1,
  on_call_team_ids TEXT NOT NULL DEFAULT '[]',
  on_call_hours TEXT NOT NULL DEFAULT '08:00-12:00,14:00-18:00',
  comp_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Mapa dos armários: porta "01".."24"; só existe linha para porta ocupada
CREATE TABLE IF NOT EXISTS lockers (
  id TEXT PRIMARY KEY CHECK (length(id) = 2),
  name TEXT NOT NULL,
  sector TEXT,
  since TEXT,
  note TEXT,
  technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Viagens da equipe (diárias calculadas no app a partir das datas/horas)
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technician_ids TEXT NOT NULL DEFAULT '[]',
  destination TEXT NOT NULL,
  reason TEXT,
  vehicle TEXT,
  depart_at TEXT NOT NULL,
  return_at TEXT NOT NULL,
  returned_at TEXT,
  status TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'em_viagem', 'retornou', 'prestacao', 'paga')),
  advance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  -- diária: NULL = automática pelo destino, 1 = sempre, 0 = nunca
  per_diem INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (return_at >= depart_at)
);

-- Regras das diárias (linha única)
CREATE TABLE IF NOT EXISTS trip_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_value REAL NOT NULL DEFAULT 120,
  half_value REAL NOT NULL DEFAULT 60,
  min_hours_half REAL NOT NULL DEFAULT 6,
  half_on_return INTEGER NOT NULL DEFAULT 1,
  -- destinos (ou sentido) que geram diária; viagens para outros lugares não geram
  paid_destinations TEXT NOT NULL DEFAULT '["Rondolândia","Fazenda Castanhal","Fazenda Peralta"]'
);
INSERT OR IGNORE INTO trip_settings (id) VALUES (1);
`;

class EscalaDb {
  constructor(SQL, file, bytes) {
    this.SQL = SQL;
    this.file = file;
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run("PRAGMA foreign_keys = ON;");
  }

  static async open(file, seedFile) {
    const wasmBinary = fs.readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"));
    const SQL = await initSqlJs({ wasmBinary });
    const exists = fs.existsSync(file);
    const store = new EscalaDb(SQL, file, exists ? fs.readFileSync(file) : null);
    store.db.run(SCHEMA);
    store.migrate();
    if (!exists && seedFile && fs.existsSync(seedFile)) store.seed(JSON.parse(fs.readFileSync(seedFile, "utf8")));
    // banco novo ou de versão anterior: grava a estrutura atual (tabelas novas já foram criadas acima)
    const version = store.get("SELECT value FROM meta WHERE key = 'schema_version'");
    if (!exists || Number(version?.value ?? 0) < SCHEMA_VERSION) {
      store.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
      store.persist();
    }
    return store;
  }

  /** Colunas novas em bancos antigos (CREATE TABLE IF NOT EXISTS não altera tabelas existentes). */
  migrate() {
    const addColumn = (table, column, definition) => {
      const cols = this.all(`PRAGMA table_info(${table})`).map((c) => c.name);
      if (!cols.includes(column)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn("trips", "per_diem", "INTEGER");
    addColumn("trip_settings", "paid_destinations", `TEXT NOT NULL DEFAULT '["Rondolândia","Fazenda Castanhal","Fazenda Peralta"]'`);
  }

  /** Grava o arquivo de forma atômica (arquivo temporário + rename). */
  persist() {
    const data = this.db.export();
    // export() reabre o banco e zera os PRAGMAs
    this.db.run("PRAGMA foreign_keys = ON;");
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.file);
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] ?? null;
  }

  run(sql, params = []) {
    this.db.run(sql, params);
  }

  lastId() {
    return Number(this.get("SELECT last_insert_rowid() AS id").id);
  }

  changes() {
    return this.db.getRowsModified();
  }

  /** Executa várias gravações numa transação e salva o arquivo ao final. */
  write(fn) {
    this.run("BEGIN");
    try {
      const result = fn();
      this.run("COMMIT");
      this.persist();
      return result;
    } catch (err) {
      try {
        this.run("ROLLBACK");
      } catch {
        // transação já encerrada
      }
      throw friendlyError(err);
    }
  }

  seed(data) {
    const j = (v) => JSON.stringify(v);
    this.run("BEGIN");
    for (const t of data.teams) this.run("INSERT INTO teams (id, name, code, sector, vehicle, notes) VALUES (?,?,?,?,?,?)", [t.id, t.name, t.code, t.sector, t.vehicle, t.notes]);
    for (const t of data.technicians) this.run("INSERT INTO technicians (id, name, phone, role, team_id) VALUES (?,?,?,?,?)", [t.id, t.name, t.phone, t.role, t.teamId]);
    for (const a of data.absences) this.run("INSERT INTO absences (id, technician_id, start_date, end_date, kind, notes) VALUES (?,?,?,?,?,?)", [a.id, a.technicianId, a.startDate, a.endDate, a.kind, a.notes]);
    for (const s of data.settings) {
      this.run(
        "INSERT INTO sector_settings (sector, min_coverage, max_consecutive, hours_six_one, hours_six_one_saturday, hours_five_two, shift_start, shift_end, on_call_teams, on_call_saturday, on_call_sunday) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [s.sector, j(s.minCoverage), s.maxConsecutive, s.hoursSixOne, s.hoursSixOneSaturday, s.hoursFiveTwo, s.shiftStart, s.shiftEnd, s.onCallTeams, s.onCallSaturday, s.onCallSunday],
      );
    }
    for (const p of data.patterns) this.run("INSERT INTO schedule_patterns (id, sector, scale_type, name, start_date, cycle_weeks, days_off) VALUES (?,?,?,?,?,?,?)", [p.id, p.sector, p.scaleType, p.name, p.startDate, p.cycleWeeks, j(p.daysOff)]);
    for (const s of data.onCallShifts) this.run("INSERT INTO on_call_shifts (id, team_id, weekend_start, comp_dates, notes) VALUES (?,?,?,?,?)", [s.id, s.teamId, s.weekendStart, j(s.compDates), s.notes]);
    for (const h of data.holidays) this.run("INSERT INTO holidays (id, date, name, kind, day_off, on_call_team_ids, on_call_hours, comp_date) VALUES (?,?,?,?,?,?,?,?)", [h.id, h.date, h.name, h.kind, h.dayOff ? 1 : 0, j(h.onCallTeamIds), h.onCallHours, h.compDate]);
    this.run("COMMIT");
  }
}

function friendlyError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/FOREIGN KEY/i.test(msg)) return new Error("Registro relacionado não encontrado.");
  return err instanceof Error ? err : new Error(msg);
}

/** Lança mensagem amigável quando a gravação viola um UNIQUE. */
function unique(fn, message) {
  try {
    return fn();
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err && err.message))) throw new Error(message);
    throw err;
  }
}

const parse = (v, fallback) => {
  try {
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};

/** Operações chamadas pelo app (mesmo contrato da versão Supabase). */
function createOperations(store) {
  const upsert = (table, id, values, duplicateMessage) =>
    store.write(() =>
      unique(() => {
        const cols = Object.keys(values);
        const params = cols.map((c) => values[c]);
        if (id) {
          store.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...params, id]);
          if (store.changes() === 0) throw new Error("Registro não encontrado");
          return { id };
        }
        store.run(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params);
        return { id: store.lastId() };
      }, duplicateMessage),
    );
  const remove = (table, id) =>
    store.write(() => {
      store.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      return { ok: true };
    });

  return {
    getData() {
      return {
        teams: store.all("SELECT id, name, code, sector, vehicle, notes FROM teams ORDER BY sector DESC, code"),
        technicians: store
          .all("SELECT id, name, phone, role, team_id FROM technicians ORDER BY name")
          .map((t) => ({ id: t.id, name: t.name, phone: t.phone, role: t.role, teamId: t.team_id })),
        absences: store
          .all("SELECT id, technician_id, start_date, end_date, kind, notes FROM absences ORDER BY start_date")
          .map((a) => ({ id: a.id, technicianId: a.technician_id, startDate: a.start_date, endDate: a.end_date, kind: a.kind, notes: a.notes })),
        settings: store.all("SELECT * FROM sector_settings").map((s) => ({
          sector: s.sector,
          minCoverage: parse(s.min_coverage, [0, 0, 0, 0, 0, 0, 0]).map(Number),
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
        patterns: store
          .all("SELECT id, sector, scale_type, name, start_date, cycle_weeks, days_off FROM schedule_patterns ORDER BY start_date")
          .map((p) => ({ id: p.id, sector: p.sector, scaleType: p.scale_type, name: p.name, startDate: p.start_date, cycleWeeks: p.cycle_weeks, daysOff: parse(p.days_off, {}) })),
        onCallShifts: store
          .all("SELECT id, team_id, weekend_start, comp_dates, notes FROM on_call_shifts ORDER BY weekend_start")
          .map((s) => ({ id: s.id, teamId: s.team_id, weekendStart: s.weekend_start, compDates: parse(s.comp_dates, []), notes: s.notes })),
        holidays: store
          .all("SELECT id, date, name, kind, day_off, on_call_team_ids, on_call_hours, comp_date FROM holidays ORDER BY date")
          .map((h) => ({
            id: h.id,
            date: h.date,
            name: h.name,
            kind: h.kind,
            dayOff: h.day_off === 1,
            onCallTeamIds: parse(h.on_call_team_ids, []).map(Number),
            onCallHours: h.on_call_hours,
            compDate: h.comp_date,
          })),
        trips: store
          .all("SELECT id, technician_ids, destination, reason, vehicle, depart_at, return_at, returned_at, status, advance, notes, per_diem FROM trips ORDER BY depart_at DESC")
          .map((t) => ({
            id: t.id,
            technicianIds: parse(t.technician_ids, []).map(Number),
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
        tripSettings: (() => {
          const t = store.get("SELECT * FROM trip_settings WHERE id = 1");
          return {
            fullValue: Number(t.full_value),
            halfValue: Number(t.half_value),
            minHoursHalf: Number(t.min_hours_half),
            halfOnReturn: t.half_on_return === 1,
            paidDestinations: parse(t.paid_destinations, []),
          };
        })(),
        lockers: store
          .all("SELECT id, name, sector, since, note, technician_id FROM lockers ORDER BY id")
          .map((l) => ({ id: l.id, name: l.name, sector: l.sector, since: l.since, note: l.note, technicianId: l.technician_id })),
        motorConfig: parse(store.get("SELECT value FROM meta WHERE key = 'motor_config'")?.value, null),
      };
    },

    saveTeam(i) {
      return upsert("teams", i.id, { name: i.name, code: i.code.toUpperCase(), sector: i.sector, vehicle: i.vehicle || null, notes: i.notes || null });
    },
    deleteTeam({ id }) {
      return store.write(() => {
        // tira a equipe das escalas e dos plantões de feriado; técnicos ficam sem equipe; plantões saem (CASCADE)
        for (const p of store.all("SELECT id, days_off FROM schedule_patterns")) {
          const days = parse(p.days_off, {});
          if (String(id) in days) {
            delete days[String(id)];
            store.run("UPDATE schedule_patterns SET days_off = ? WHERE id = ?", [JSON.stringify(days), p.id]);
          }
        }
        for (const h of store.all("SELECT id, on_call_team_ids FROM holidays")) {
          const ids = parse(h.on_call_team_ids, []).map(Number);
          if (ids.includes(id)) store.run("UPDATE holidays SET on_call_team_ids = ? WHERE id = ?", [JSON.stringify(ids.filter((x) => x !== id)), h.id]);
        }
        store.run("DELETE FROM teams WHERE id = ?", [id]);
        return { ok: true };
      });
    },

    saveTechnician(i) {
      if (i.teamId !== null) {
        const n = store.get("SELECT COUNT(*) AS n FROM technicians WHERE team_id = ? AND id != ?", [i.teamId, i.id ?? -1]).n;
        if (n >= 2) throw new Error("Essa equipe já tem uma dupla completa (2 técnicos).");
      }
      return upsert("technicians", i.id, { name: i.name, phone: i.phone || null, role: i.role || null, team_id: i.teamId });
    },
    deleteTechnician({ id }) {
      return remove("technicians", id);
    },

    saveAbsence(i) {
      return upsert("absences", i.id, { technician_id: i.technicianId, start_date: i.startDate, end_date: i.endDate, kind: i.kind, notes: i.notes || null });
    },
    deleteAbsence({ id }) {
      return remove("absences", id);
    },

    saveSettings(s) {
      return store.write(() => {
        store.run(
          `INSERT INTO sector_settings (sector, min_coverage, max_consecutive, hours_six_one, hours_six_one_saturday, hours_five_two, shift_start, shift_end, on_call_teams, on_call_saturday, on_call_sunday)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(sector) DO UPDATE SET min_coverage = excluded.min_coverage, max_consecutive = excluded.max_consecutive,
             hours_six_one = excluded.hours_six_one, hours_six_one_saturday = excluded.hours_six_one_saturday, hours_five_two = excluded.hours_five_two,
             shift_start = excluded.shift_start, shift_end = excluded.shift_end, on_call_teams = excluded.on_call_teams,
             on_call_saturday = excluded.on_call_saturday, on_call_sunday = excluded.on_call_sunday`,
          [s.sector, JSON.stringify(s.minCoverage), s.maxConsecutive, s.hoursSixOne, s.hoursSixOneSaturday, s.hoursFiveTwo, s.shiftStart, s.shiftEnd, s.onCallTeams, s.onCallSaturday, s.onCallSunday],
        );
        return { ok: true };
      });
    },

    savePattern(i) {
      return upsert(
        "schedule_patterns",
        i.id,
        { sector: i.sector, scale_type: i.scaleType, name: i.name, start_date: i.startDate, cycle_weeks: i.cycleWeeks, days_off: JSON.stringify(i.daysOff) },
        "Já existe uma escala deste setor começando nessa data. Escolha outra data ou edite a existente.",
      );
    },
    deletePattern({ id }) {
      return remove("schedule_patterns", id);
    },

    /** Substitui os plantões do setor no intervalo (transação única). */
    bulkOnCall(i) {
      return store.write(() => {
        const teamIds = store.all("SELECT id FROM teams WHERE sector = ?", [i.sector]).map((t) => t.id);
        if (i.shifts.some((s) => !teamIds.includes(s.teamId))) throw new Error("Equipe não pertence ao setor");
        if (teamIds.length > 0) {
          store.run(
            `DELETE FROM on_call_shifts WHERE team_id IN (${teamIds.map(() => "?").join(",")}) AND weekend_start BETWEEN ? AND ?`,
            [...teamIds, i.fromDate, i.toDate],
          );
        }
        for (const s of i.shifts) {
          store.run("INSERT INTO on_call_shifts (team_id, weekend_start, comp_dates) VALUES (?,?,?)", [s.teamId, s.weekendStart, JSON.stringify(s.compDates)]);
        }
        return { created: i.shifts.length };
      });
    },
    /** Preferências do motor de plantão (ordem do rodízio, duplas fora do rodízio, regra do feriado de segunda). */
    saveMotorConfig(i) {
      return store.write(() => {
        store.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('motor_config', ?)", [JSON.stringify(i)]);
        return { ok: true };
      });
    },
    /** Ajuste pontual do plantão (troca de duplas por viagem/ausência) numa transação. */
    applyOnCallAdjust(i) {
      return store.write(() => {
        for (const u of i.shifts) {
          store.run("UPDATE on_call_shifts SET team_id = ?, notes = ? WHERE id = ?", [u.teamId, u.notes || null, u.id]);
        }
        for (const h of i.holidays) {
          store.run("UPDATE holidays SET on_call_team_ids = ? WHERE id = ?", [JSON.stringify([...new Set(h.onCallTeamIds)]), h.id]);
        }
        return { changed: i.shifts.length + i.holidays.length };
      });
    },
    /** Motor de plantão: grava o rodízio dos dois setores, os plantões de feriado e a escala base 6x1 numa transação. */
    applyOnCallPlan(i) {
      return store.write(() => {
        let created = 0;
        for (const sec of i.sectors) {
          const teamIds = store.all("SELECT id FROM teams WHERE sector = ?", [sec.sector]).map((t) => t.id);
          if (sec.shifts.some((s) => !teamIds.includes(s.teamId))) throw new Error("Equipe não pertence ao setor");
          if (teamIds.length > 0) {
            store.run(
              `DELETE FROM on_call_shifts WHERE team_id IN (${teamIds.map(() => "?").join(",")}) AND weekend_start BETWEEN ? AND ?`,
              [...teamIds, i.fromDate, i.toDate],
            );
          }
          for (const s of sec.shifts) {
            store.run("INSERT INTO on_call_shifts (team_id, weekend_start, comp_dates, notes) VALUES (?,?,?,?)", [
              s.teamId,
              s.weekendStart,
              JSON.stringify([...new Set(s.compDates)].sort()),
              s.notes || null,
            ]);
            created++;
          }
        }
        for (const h of i.holidays) {
          store.run("UPDATE holidays SET on_call_team_ids = ?, comp_date = ? WHERE id = ?", [JSON.stringify([...new Set(h.onCallTeamIds)]), h.compDate, h.id]);
        }
        for (const b of i.basePatterns) {
          const exists = store.get("SELECT id FROM schedule_patterns WHERE sector = ? AND start_date = ?", [b.sector, b.startDate]);
          if (exists) continue;
          const teamIds = store.all("SELECT id FROM teams WHERE sector = ?", [b.sector]).map((t) => t.id);
          const daysOff = Object.fromEntries(teamIds.map((id) => [String(id), [{ day: 6, kind: "regular" }]]));
          store.run("INSERT INTO schedule_patterns (sector, scale_type, name, start_date, cycle_weeks, days_off) VALUES (?,?,?,?,?,?)", [
            b.sector,
            "6x1",
            "Escala 6x1 (seg–sáb, domingo folga) — motor de plantão",
            b.startDate,
            1,
            JSON.stringify(daysOff),
          ]);
        }
        return { created };
      });
    },
    saveOnCall(i) {
      return upsert(
        "on_call_shifts",
        i.id,
        { team_id: i.teamId, weekend_start: i.weekendStart, comp_dates: JSON.stringify([...new Set(i.compDates)].sort()), notes: i.notes || null },
        "Essa dupla já está de plantão nesse fim de semana.",
      );
    },
    deleteOnCall({ id }) {
      return remove("on_call_shifts", id);
    },

    saveHoliday(i) {
      return upsert(
        "holidays",
        i.id,
        {
          date: i.date,
          name: i.name,
          kind: i.kind,
          day_off: i.dayOff ? 1 : 0,
          on_call_team_ids: JSON.stringify([...new Set(i.onCallTeamIds)]),
          on_call_hours: i.onCallHours,
          comp_date: i.compDate,
        },
        "Já existe um feriado nessa data.",
      );
    },
    deleteHoliday({ id }) {
      return remove("holidays", id);
    },
    /** Insere feriados ignorando datas já cadastradas; a lista vem pronta do app. */
    insertHolidays({ holidays }) {
      return store.write(() => {
        let created = 0;
        for (const h of holidays) {
          store.run("INSERT OR IGNORE INTO holidays (date, name, kind, day_off, on_call_team_ids) VALUES (?,?,?,?, '[]')", [h.date, h.name, h.kind, h.dayOff ? 1 : 0]);
          created += store.changes();
        }
        return { created };
      });
    },

    /** Registra (ou troca) o ocupante de uma porta do armário. */
    saveLocker(i) {
      return store.write(() => {
        store.run(
          `INSERT INTO lockers (id, name, sector, since, note, technician_id, updated_at) VALUES (?,?,?,?,?,?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, sector = excluded.sector, since = excluded.since,
             note = excluded.note, technician_id = excluded.technician_id, updated_at = CURRENT_TIMESTAMP`,
          [i.id, i.name, i.sector || null, i.since || null, i.note || null, i.technicianId ?? null],
        );
        return { ok: true };
      });
    },
    saveTrip(i) {
      return upsert("trips", i.id, {
        technician_ids: JSON.stringify([...new Set(i.technicianIds)]),
        destination: i.destination,
        reason: i.reason || null,
        vehicle: i.vehicle || null,
        depart_at: i.departAt,
        return_at: i.returnAt,
        returned_at: i.returnedAt || null,
        status: i.status,
        advance: i.advance,
        per_diem: i.perDiem == null ? null : i.perDiem ? 1 : 0,
        notes: i.notes || null,
      });
    },
    setTripStatus({ id, status }) {
      return store.write(() => {
        store.run("UPDATE trips SET status = ? WHERE id = ?", [status, id]);
        if (store.changes() === 0) throw new Error("Viagem não encontrada");
        return { ok: true };
      });
    },
    deleteTrip({ id }) {
      return remove("trips", id);
    },
    saveTripSettings(t) {
      return store.write(() => {
        store.run("UPDATE trip_settings SET full_value = ?, half_value = ?, min_hours_half = ?, half_on_return = ?, paid_destinations = ? WHERE id = 1", [
          t.fullValue,
          t.halfValue,
          t.minHoursHalf,
          t.halfOnReturn ? 1 : 0,
          JSON.stringify(t.paidDestinations),
        ]);
        return { ok: true };
      });
    },

    /** Libera a porta (apaga o ocupante). */
    freeLocker({ id }) {
      return store.write(() => {
        store.run("DELETE FROM lockers WHERE id = ?", [id]);
        return { ok: true };
      });
    },
  };
}

module.exports = { EscalaDb, createOperations };
