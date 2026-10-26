import { useMemo, useState } from "react";
import { AlertTriangle, PartyPopper, Pencil, Plane, UserX } from "lucide-react";
import type { HolidayDTO, OnCallShiftDTO, OutputType } from "../endpoints/data_GET.schema";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import { useAppMutations } from "../helpers/useAppMutations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Button } from "./Button";
import { Input } from "./Input";
import styles from "./OnCallEditor.module.css";

interface Props {
  data: OutputType;
  /** primeiro sábado mostrado */
  from: string;
  weeks: number;
}

const NONE = "__none";
const short = (d: string) => `${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(d)]} ${d.slice(8)}/${d.slice(5, 7)}`;

/**
 * Escala de plantão salva, editável direto na tabela: trocar a dupla do fim de semana,
 * mudar os dias de folga e definir quem faz o feriado. Cada alteração grava na hora.
 */
export const OnCallEditor = ({ data, from, weeks }: Props) => {
  const { saveOnCall, deleteOnCall, saveHoliday } = useAppMutations();
  const teamById = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data]);
  const members = (teamId: number) => data.technicians.filter((t) => t.teamId === teamId);
  const names = (teamId: number) => members(teamId).map((t) => t.name).join(" + ") || "sem técnicos";
  const saturdays = Array.from({ length: weeks }, (_, i) => scheduleEngine.addDays(from, i * 7));
  const shiftOf = (sector: Sector, sat: string) => data.onCallShifts.find((s) => s.weekendStart === sat && teamById.get(s.teamId)?.sector === sector);

  // quem está fora (férias, atestado, viagem) no fim de semana
  const awayReason = (teamId: number, sat: string) => {
    for (const m of members(teamId)) {
      for (const d of [sat, scheduleEngine.addDays(sat, 1)]) {
        const a = scheduleEngine.isAbsent(data.absences, m.id, d);
        if (a) return { icon: "abs" as const, text: `${m.name}: ${labels.absenceKind[a.kind].toLowerCase()}` };
        const t = scheduleEngine.tripForTechnician(data.trips, m.id, d);
        if (t) return { icon: "trip" as const, text: `${m.name} em viagem (${t.destination})` };
      }
    }
    return null;
  };

  // feriados da semana (segunda a domingo) desse fim de semana
  const holidaysOfWeekend = (sat: string) =>
    data.holidays.filter((h) => h.dayOff && h.date >= scheduleEngine.addDays(sat, -5) && h.date <= scheduleEngine.addDays(sat, 1));

  const changeTeam = (sector: Sector, sat: string, value: string) => {
    const cur = shiftOf(sector, sat);
    if (value === NONE) {
      if (cur) deleteOnCall.mutate({ id: cur.id });
      return;
    }
    const teamId = Number(value);
    saveOnCall.mutate({
      id: cur?.id,
      teamId,
      weekendStart: sat,
      compDates: cur?.compDates ?? scheduleEngine.defaultCompDates(sat, sector, data.patterns, data.holidays),
      notes: "Ajuste manual",
    });
    // feriado no sábado/domingo acompanha a dupla do plantão
    if (cur) {
      for (const h of data.holidays) {
        if ((h.date === sat || h.date === scheduleEngine.addDays(sat, 1)) && h.onCallTeamIds.includes(cur.teamId)) {
          saveHoliday.mutate({ ...h, onCallTeamIds: h.onCallTeamIds.map((id) => (id === cur.teamId ? teamId : id)) });
        }
      }
    }
  };

  // contagem de plantões por dupla no período mostrado
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of data.onCallShifts) {
      if (s.weekendStart >= from && s.weekendStart <= saturdays[saturdays.length - 1]) map.set(s.teamId, (map.get(s.teamId) ?? 0) + 1);
    }
    return map;
  }, [data, from, weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className={styles.counts}>
        {labels.sectors.map((sector) => (
          <div key={sector} className={styles.countGroup}>
            <span className={styles.micro}>{labels.sectorShort[sector]}</span>
            {data.teams
              .filter((t) => t.sector === sector)
              .map((t) => (
                <span key={t.id} className={styles.count} title={names(t.id)}>
                  <b className={sector === "infraestrutura" ? styles.cInfra : styles.cSupport}>{t.code}</b> {counts.get(t.id) ?? 0}
                </span>
              ))}
          </div>
        ))}
        <span className={styles.countHint}>plantões no período</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Fim de semana</th>
              <th className={styles.thSupport}>Suporte · plantão</th>
              <th>Folga</th>
              <th className={styles.thInfra}>Backbone · plantão</th>
              <th>Folga</th>
            </tr>
          </thead>
          <tbody>
            {saturdays.map((sat) => (
              <tr key={sat}>
                <td className={styles.when}>
                  <b>
                    {sat.slice(8)}–{scheduleEngine.addDays(sat, 1).slice(8)}/{scheduleEngine.addDays(sat, 1).slice(5, 7)}
                  </b>
                  <span className={styles.scale}>{scheduleEngine.patternForDate(data.patterns, "suporte", sat)?.scaleType ?? ""}</span>
                  {holidaysOfWeekend(sat).map((h) => (
                    <HolidayChip key={h.id} holiday={h} data={data} onSave={(v) => saveHoliday.mutate(v)} />
                  ))}
                </td>
                {labels.sectors.map((sector) => {
                  const s = shiftOf(sector, sat);
                  const prev = shiftOf(sector, scheduleEngine.addDays(sat, -7));
                  const next = shiftOf(sector, scheduleEngine.addDays(sat, 7));
                  const backToBack = s && ((prev && prev.teamId === s.teamId) || (next && next.teamId === s.teamId));
                  const away = s ? awayReason(s.teamId, sat) : null;
                  return [
                    <td key={`${sector}t`} className={styles.teamCell}>
                      <Select value={s ? String(s.teamId) : NONE} onValueChange={(v) => changeTeam(sector, sat, v)}>
                        <SelectTrigger className={`${styles.trigger} ${!s ? styles.empty : ""}`} aria-label={`Plantão ${labels.sectorShort[sector]} ${sat}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— sem plantão —</SelectItem>
                          {data.teams
                            .filter((t) => t.sector === sector)
                            .map((t) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.code} · {names(t.id)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {backToBack && (
                        <div className={styles.warn}>
                          <AlertTriangle size={12} /> dois fins de semana seguidos
                        </div>
                      )}
                      {away && (
                        <div className={styles.warn}>
                          {away.icon === "trip" ? <Plane size={12} /> : <UserX size={12} />} {away.text}
                        </div>
                      )}
                      {s?.notes && <div className={styles.note}>{s.notes}</div>}
                    </td>,
                    <td key={`${sector}c`} className={styles.compCell}>
                      {s ? <CompEditor shift={s} onSave={(compDates) => saveOnCall.mutate({ ...s, compDates, notes: s.notes })} /> : <span className={styles.dash}>—</span>}
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** Dias de folga do plantão (clique para mudar). */
const CompEditor = ({ shift, onSave }: { shift: OnCallShiftDTO; onSave: (dates: string[]) => void }) => {
  const [open, setOpen] = useState(false);
  const [d1, setD1] = useState(shift.compDates[0] ?? "");
  const [d2, setD2] = useState(shift.compDates[1] ?? "");
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setD1(shift.compDates[0] ?? "");
          setD2(shift.compDates[1] ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className={styles.compBtn} title="Mudar os dias de folga">
          {shift.compDates.length ? shift.compDates.map(short).join(" + ") : "sem folga"} <Pencil size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent className={styles.pop} side="left" collisionPadding={12}>
        <div className={styles.micro}>Dias de folga (banco de horas)</div>
        <Input type="date" value={d1} onChange={(e) => setD1(e.target.value)} />
        <Input type="date" value={d2} onChange={(e) => setD2(e.target.value)} />
        <Button
          size="sm"
          onClick={() => {
            onSave([d1, d2].filter(Boolean).sort());
            setOpen(false);
          }}
        >
          Salvar folga
        </Button>
      </PopoverContent>
    </Popover>
  );
};

/** Feriado da semana: quem faz o plantão e o dia de folga. */
const HolidayChip = ({ holiday, data, onSave }: { holiday: HolidayDTO; data: OutputType; onSave: (h: HolidayDTO) => void }) => {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<Record<Sector, string>>({ suporte: NONE, infraestrutura: NONE });
  const [comp, setComp] = useState(holiday.compDate ?? "");
  const codes = holiday.onCallTeamIds.map((id) => data.teams.find((t) => t.id === id)?.code).filter(Boolean).join(" + ") || "sem plantão";
  const weekday = scheduleEngine.weekdayIndex(holiday.date) < 5;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const pick = (sector: Sector) => String(holiday.onCallTeamIds.find((id) => data.teams.find((t) => t.id === id)?.sector === sector) ?? NONE);
          setTeams({ suporte: pick("suporte"), infraestrutura: pick("infraestrutura") });
          setComp(holiday.compDate ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className={styles.hol} title="Editar o plantão do feriado">
          <PartyPopper size={12} /> {holiday.name} · {short(holiday.date)} · {codes}
          {holiday.compDate && ` · folga ${short(holiday.compDate)}`} <Pencil size={11} />
        </button>
      </PopoverTrigger>
      <PopoverContent className={styles.pop} side="right" collisionPadding={12}>
        <div className={styles.micro}>
          {holiday.name} · {scheduleEngine.formatDate(holiday.date)}
        </div>
        {labels.sectors.map((sector) => (
          <div key={sector}>
            <label className={styles.label}>{labels.sectorShort[sector]}</label>
            <Select value={teams[sector]} onValueChange={(v) => setTeams({ ...teams, [sector]: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— ninguém —</SelectItem>
                {data.teams
                  .filter((t) => t.sector === sector)
                  .map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.code} · {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {weekday && (
          <div>
            <label className={styles.label}>Folga de quem trabalhou</label>
            <Input type="date" value={comp} onChange={(e) => setComp(e.target.value)} />
          </div>
        )}
        <Button
          size="sm"
          onClick={() => {
            onSave({
              ...holiday,
              onCallTeamIds: [teams.suporte, teams.infraestrutura].filter((v) => v !== NONE).map(Number),
              compDate: weekday ? comp || null : holiday.compDate,
            });
            setOpen(false);
          }}
        >
          Salvar feriado
        </Button>
      </PopoverContent>
    </Popover>
  );
};
