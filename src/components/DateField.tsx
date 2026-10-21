import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ptBR } from "react-day-picker/locale";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Calendar } from "./Calendar";
import { Button } from "./Button";
import { scheduleEngine } from "../helpers/scheduleEngine";
import styles from "./DateField.module.css";

interface Props {
  value: string;
  onChange: (iso: string) => void;
  /** Restringe a seleção a segundas-feiras. */
  mondaysOnly?: boolean;
  /** Restringe a um dia da semana (0 = domingo ... 6 = sábado). */
  onlyWeekday?: number;
  className?: string;
  id?: string;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const DateField = ({ value, onChange, mondaysOnly, onlyWeekday, className, id }: Props) => {
  const [open, setOpen] = useState(false);
  const weekday = mondaysOnly ? 1 : onlyWeekday;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className={`${styles.trigger} ${className ?? ""}`}>
          <CalendarDays size={16} />
          <span>{value ? scheduleEngine.formatDate(value) : "Selecionar data"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={styles.content}>
        <Calendar
          mode="single"
          locale={ptBR}
          weekStartsOn={1}
          selected={value ? fromIso(value) : undefined}
          defaultMonth={value ? fromIso(value) : undefined}
          disabled={weekday !== undefined ? (d: Date) => d.getDay() !== weekday : undefined}
          onSelect={(d?: Date) => {
            if (!d) return;
            onChange(toIso(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
