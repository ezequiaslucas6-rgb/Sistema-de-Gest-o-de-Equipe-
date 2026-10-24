import { forwardRef, ButtonHTMLAttributes } from "react";
import type { DayStatus } from "../helpers/scheduleEngine";
import styles from "./DayCell.module.css";

const SHORT: Record<DayStatus, string> = {
  trabalho: "T",
  plantao: "P",
  folga: "F",
  folga_plantao: "FP",
  feriado: "FE",
  viagem: "V",
  compensatoria: "FC",
  desfalcada: "D",
  ausente: "A",
  sem_escala: "–",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  status: DayStatus;
  weekend?: boolean;
  today?: boolean;
  label?: string;
}

/** Célula de status de uma equipe num dia (forma primeiro, cor depois). */
export const DayCell = forwardRef<HTMLButtonElement, Props>(
  ({ status, weekend, today, label, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={`${styles.cell} ${styles[status]} ${weekend ? styles.weekend : ""} ${today ? styles.today : ""} ${className ?? ""}`}
      {...props}
    >
      {label ?? SHORT[status]}
    </button>
  ),
);
DayCell.displayName = "DayCell";
