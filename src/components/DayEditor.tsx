import { useState } from "react";
import { Link } from "react-router-dom";
import { Briefcase, Moon, RotateCcw, Siren, SlidersHorizontal, UserX, X } from "lucide-react";
import type { OutputType } from "../endpoints/data_GET.schema";
import type { TeamDayView } from "../helpers/buildScheduleSnapshot";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import { AbsenceKindArrayValues, type AbsenceKind } from "../helpers/schema";
import { useAppMutations } from "../helpers/useAppMutations";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Input } from "./Input";
import { Button } from "./Button";
import styles from "./DayEditor.module.css";

interface Props {
  data: OutputType;
  date: string;
  view: TeamDayView;
  /** abre o diálogo completo (folga fixa no ciclo da escala) */
  onMore: () => void;
  onDone: () => void;
}

const QUICK = [
  { status: "trabalho" as const, label: "Em campo", icon: Briefcase },
  { status: "folga" as const, label: "Folga", icon: Moon },
  { status: "plantao" as const, label: "Plantão", icon: Siren },
];

/** Edição rápida de um dia direto na tabela da escala: grava na hora. */
export const DayEditor = ({ data, date, view, onMore, onDone }: Props) => {
  const { saveOverride, deleteOverride, saveAbsence, deleteAbsence } = useAppMutations();
  const team = data.teams.find((t) => t.id === view.teamId);
  const members = data.technicians.filter((t) => t.teamId === view.teamId);
  const override = view.overrideId !== null ? data.overrides.find((o) => o.id === view.overrideId) : null;
  const [tech, setTech] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("ferias");
  const [until, setUntil] = useState(date);
  const busy = saveOverride.isPending || deleteOverride.isPending || saveAbsence.isPending;

  const setStatus = (status: "trabalho" | "folga" | "plantao") =>
    saveOverride.mutate({ teamId: view.teamId, date, status, note: null }, { onSuccess: onDone });

  const addAbsence = () => {
    if (!tech) return;
    saveAbsence.mutate(
      { technicianId: Number(tech), startDate: date, endDate: until < date ? date : until, kind, notes: "Registrado na tabela da escala" },
      {
        onSuccess: () => {
          setTech("");
          onDone();
        },
      },
    );
  };

  return (
    <div className={styles.box}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>
            <span className={styles.code}>{team?.code}</span> {team?.name}
          </div>
          <div className={styles.sub}>
            {scheduleEngine.WEEKDAY_LONG[scheduleEngine.weekdayIndex(date)]}, {scheduleEngine.formatDate(date)} · <b>{labels.status[view.status]}</b>
            {override && <span className={styles.manual}> · ajuste manual</span>}
          </div>
        </div>
      </div>

      <div className={styles.micro}>Neste dia a dupla fica</div>
      <div className={styles.quick}>
        {QUICK.map((q) => {
          const active = override ? override.status === q.status : view.status === q.status;
          return (
            <button key={q.status} className={`${styles.qbtn} ${styles[`q_${q.status}`]} ${active ? styles.qOn : ""}`} disabled={busy} onClick={() => setStatus(q.status)}>
              <q.icon size={16} />
              {q.label}
            </button>
          );
        })}
      </div>
      {override && (
        <button className={styles.reset} disabled={busy} onClick={() => deleteOverride.mutate({ teamId: view.teamId, date }, { onSuccess: onDone })}>
          <RotateCcw size={13} /> Voltar ao padrão da escala
        </button>
      )}

      <div className={styles.micro}>
        <UserX size={12} /> Técnico ausente
      </div>
      {members.map((m) => {
        const a = scheduleEngine.isAbsent(data.absences, m.id, date);
        const trip = scheduleEngine.tripForTechnician(data.trips, m.id, date);
        if (!a && !trip) return null;
        return (
          <div key={m.id} className={styles.away}>
            <span>
              <b>{m.name}</b> —{" "}
              {a
                ? `${labels.absenceKind[a.kind]} ${scheduleEngine.formatDate(a.startDate).slice(0, 5)}–${scheduleEngine.formatDate(a.endDate).slice(0, 5)}`
                : `em viagem (${trip!.destination})`}
            </span>
            {a && (
              <button className={styles.remove} title="Remover esta ausência" disabled={deleteAbsence.isPending} onClick={() => deleteAbsence.mutate({ id: a.id }, { onSuccess: onDone })}>
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
      <div className={styles.absRow}>
        <Select value={tech} onValueChange={setTech}>
          <SelectTrigger className={styles.sel}>
            <SelectValue placeholder="Técnico" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => setKind(v as AbsenceKind)}>
          <SelectTrigger className={styles.sel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AbsenceKindArrayValues.map((k) => (
              <SelectItem key={k} value={k}>
                {labels.absenceKind[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={styles.absRow}>
        <label className={styles.until}>
          até
          <Input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <Button size="sm" onClick={addAbsence} disabled={!tech || busy}>
          Registrar
        </Button>
      </div>

      <div className={styles.foot}>
        <button className={styles.link} onClick={onMore}>
          <SlidersHorizontal size={13} /> Folga fixa toda semana…
        </button>
        {scheduleEngine.weekdayIndex(date) >= 5 && (
          <Link to="/motor" className={styles.link}>
            <Siren size={13} /> Escala de plantão
          </Link>
        )}
      </div>
    </div>
  );
};
