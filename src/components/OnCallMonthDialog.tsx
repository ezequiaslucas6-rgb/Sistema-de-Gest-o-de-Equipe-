import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, Printer } from "lucide-react";
import type { OutputType } from "../endpoints/data_GET.schema";
import type { Sector } from "../helpers/scheduleEngine";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { buildMonth, downloadMonthPdf, monthLabel, printMonth } from "../helpers/onCallPrint";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { Button } from "./Button";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import styles from "./OnCallMonthDialog.module.css";

const shiftMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

type Which = "ambos" | Sector;

/** Mês inteiro numa folha deitada: prévia, impressão e PDF. */
export const OnCallMonthDialog = ({ data, open, onOpenChange }: { data: OutputType; open: boolean; onOpenChange: (o: boolean) => void }) => {
  const [month, setMonth] = useState(() => scheduleEngine.todayIso().slice(0, 7));
  const [which, setWhich] = useState<Which>("ambos");
  const [busy, setBusy] = useState(false);
  const sectors: Sector[] = which === "ambos" ? ["suporte", "infraestrutura"] : [which];
  const sheet = useMemo(() => buildMonth(data, month, sectors), [data, month, which]); // eslint-disable-line react-hooks/exhaustive-deps

  const pdf = async () => {
    setBusy(true);
    try {
      await downloadMonthPdf(sheet);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Escala de plantão do mês</DialogTitle>
        </DialogHeader>
        <div className={styles.bar}>
          <div className={styles.monthNav}>
            <Button size="icon-sm" variant="ghost" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft size={16} />
            </Button>
            <span className={styles.month}>{monthLabel(month)}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight size={16} />
            </Button>
          </div>
          <ToggleGroup type="single" value={which} onValueChange={(v) => v && setWhich(v as Which)}>
            <ToggleGroupItem value="ambos">Suporte + Backbone</ToggleGroupItem>
            <ToggleGroupItem value="suporte">Só Suporte</ToggleGroupItem>
            <ToggleGroupItem value="infraestrutura">Só Backbone</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className={styles.sheet}>
          <div className={styles.grid}>
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
              <div key={d} className={styles.head}>
                {d}
              </div>
            ))}
            {sheet.weeks.flat().map((c) => (
              <div key={c.date} className={`${styles.cell} ${c.inMonth ? "" : styles.out} ${c.weekend ? styles.we : ""} ${c.holiday ? styles.hol : ""}`}>
                <div className={styles.day}>
                  <b>{Number(c.date.slice(8))}</b>
                  {c.holiday && <span className={styles.holName}>{c.holiday}</span>}
                </div>
                {c.entries.map((e, i) => (
                  <div key={i} className={`${styles.entry} ${styles[e.kind]} ${e.sector ? styles[e.sector] : ""}`}>
                    {e.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className={styles.legend}>
            {sheet.legend.map((l) => (
              <span key={l.code}>
                <b className={styles[l.sector]}>{l.code}</b> {l.members}
              </span>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => printMonth(sheet)}>
            <Printer size={15} /> Imprimir (A4 deitado)
          </Button>
          <Button onClick={() => void pdf()} disabled={busy}>
            <FileDown size={15} /> {busy ? "Gerando…" : "Baixar PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
