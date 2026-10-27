import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Briefcase, EyeOff, Eye, PartyPopper, Repeat } from "lucide-react";
import type { OutputType } from "../endpoints/data_GET.schema";
import type { Alert, AlertFix } from "../helpers/buildScheduleSnapshot";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { holidayWeekend } from "../helpers/onCallMotor";
import * as api from "../helpers/api";
import { APP_DATA_QUERY_KEY } from "../helpers/useAppData";
import { toast } from "../helpers/toast";
import styles from "./AlertActions.module.css";

interface Props {
  alert: Alert;
  data: OutputType;
  today: string;
  ignored: boolean;
  onToggleIgnore: () => void;
}

/** Botões que resolvem o alerta na hora (ou levam à tela certa) + Ignorar. */
export const AlertActions = ({ alert, data, today, ignored, onToggleIgnore }: Props) => {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const code = (id: number) => data.teams.find((t) => t.id === id)?.code ?? "?";

  // feriado: a regra sugere a dupla do plantão do fim de semana daquela semana
  const suggestedFor = (holidayId: number) => {
    const h = data.holidays.find((x) => x.id === holidayId);
    // feriado na sexta: o plantão do fim de semana não pega (plantão é só sábado e domingo)
    if (!h || scheduleEngine.weekdayIndex(h.date) === 4) return new Set<number>();
    const sat = holidayWeekend(h.date, data.motorConfig?.mondayRule ?? "seguinte");
    return new Set(data.onCallShifts.filter((s) => s.weekendStart === sat).map((s) => s.teamId));
  };
  const fixes = [...alert.fixes].sort((a, b) => {
    const rank = (f: AlertFix) => (f.kind === "holidayOnCall" && suggestedFor(f.holidayId).has(f.teamId) ? 0 : f.kind === "link" ? 2 : 1);
    return rank(a) - rank(b);
  });

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      const msg = await fn();
      await qc.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY });
      toast.success(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = (f: AlertFix) => {
    if (f.kind === "callTeam") {
      const dates = f.dates.filter((d) => d >= today);
      return run(async () => {
        for (const date of dates) await api.saveOverride({ teamId: f.teamId, date, status: "trabalho", note: "Chamada pelo alerta do painel" });
        return `${code(f.teamId)} em campo ${dates.length > 1 ? `em ${dates.length} dias` : `em ${scheduleEngine.formatDate(dates[0]).slice(0, 5)}`}`;
      });
    }
    if (f.kind === "holidayOnCall") {
      const h = data.holidays.find((x) => x.id === f.holidayId);
      if (!h) return;
      const sector = data.teams.find((t) => t.id === f.teamId)?.sector ?? "suporte";
      return run(async () => {
        await api.saveHoliday({
          ...h,
          onCallTeamIds: [...new Set([...h.onCallTeamIds, f.teamId])],
          compDate: h.compDate ?? scheduleEngine.holidayCompDate(h.date, sector, data.patterns, data.holidays),
        });
        return `${code(f.teamId)} de plantão no feriado ${h.name}`;
      });
    }
    if (f.kind === "swapOnCall") {
      return run(async () => {
        await api.applyOnCallAdjust({ shifts: [{ id: f.shiftId, teamId: f.teamId, notes: "Troca pelo alerta do painel" }], holidays: [] });
        return `Plantão passou para ${code(f.teamId)}`;
      });
    }
  };

  return (
    <div className={styles.row}>
      {fixes.map((f, i) =>
        f.kind === "link" ? (
          <Link key={i} to={f.to} className={styles.link}>
            {f.label} <ArrowRight size={12} />
          </Link>
        ) : (
          <button key={i} className={styles.fix} disabled={busy || ignored} onClick={() => apply(f)}>
            {f.kind === "callTeam" && (
              <>
                <Briefcase size={13} /> Colocar {code(f.teamId)} em campo
                {f.dates.filter((d) => d >= today).length > 1 && ` (${f.dates.filter((d) => d >= today).length} dias)`}
              </>
            )}
            {f.kind === "holidayOnCall" && (
              <>
                <PartyPopper size={13} /> Plantão do feriado: {code(f.teamId)}
                {suggestedFor(f.holidayId).has(f.teamId) && <span className={styles.tag}>sugerido</span>}
              </>
            )}
            {f.kind === "swapOnCall" && (
              <>
                <Repeat size={13} /> Passar plantão para {code(f.teamId)}
              </>
            )}
          </button>
        ),
      )}
      <button className={styles.ignore} onClick={onToggleIgnore} title={ignored ? "Voltar a mostrar este alerta" : "Esconder este alerta"}>
        {ignored ? <Eye size={13} /> : <EyeOff size={13} />} {ignored ? "Reativar" : "Ignorar"}
      </button>
    </div>
  );
};
