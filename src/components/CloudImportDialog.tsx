import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudUpload, HardDrive } from "lucide-react";
import type { OutputType } from "../endpoints/data_GET.schema";
import { localCall } from "../helpers/desktop";
import { cloudGetData, replaceCloudWith } from "../helpers/cloud";
import { toast } from "../helpers/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { Button } from "./Button";
import styles from "./CloudImportDialog.module.css";

const FLAG = "escala-nuvem-importacao";
export const OPEN_IMPORT_EVENT = "escala:abrir-importacao";

const summary = (d: OutputType) => [
  ["Duplas", d.teams.length],
  ["Técnicos", d.technicians.length],
  ["Plantões", d.onCallShifts.length],
  ["Ausências", d.absences.length],
  ["Viagens", d.trips.length],
  ["Armários ocupados", d.lockers.length],
] as const;

/** Banco local com dados de verdade (não só os dados de exemplo da primeira execução)? */
const hasRealData = (d: OutputType) =>
  d.trips.length > 0 || d.lockers.length > 0 || d.technicians.some((t) => !/^Técnico \d{2}$/.test(t.name)) || d.motorConfig !== null;

/**
 * Envia os dados do banco do computador (versões anteriores do programa) para a nuvem, substituindo o que há lá.
 * Abre sozinho na primeira vez em cada computador com dados próprios, ou pelo menu do banco de dados.
 */
export const CloudImportDialog = () => {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<OutputType | null>(null);
  const [cloud, setCloud] = useState<OutputType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (auto: boolean, fromFile?: OutputType) => {
    if (!fromFile && !window.escala) return;
    try {
      const l = fromFile ?? (await localCall<OutputType>("getData"));
      if (auto && !hasRealData(l)) return;
      setLocal(l);
      setCloud(await cloudGetData());
      setOpen(true);
    } catch (err) {
      if (!auto) toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(FLAG);
    } catch {
      // sem armazenamento: só abre pelo menu
    }
    if (!flag) void load(true);
    // o evento pode trazer os dados de um arquivo escolhido no menu (site ou programa)
    const onOpen = (e: Event) => void load(false, (e as CustomEvent<OutputType | undefined>).detail);
    window.addEventListener(OPEN_IMPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IMPORT_EVENT, onOpen);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = (v: string) => {
    try {
      localStorage.setItem(FLAG, v);
    } catch {
      // ignora
    }
  };

  const send = async () => {
    if (!local) return;
    try {
      await replaceCloudWith(local, setBusy);
      remember("enviado");
      await qc.invalidateQueries();
      toast.success("Dados enviados para a nuvem");
      setOpen(false);
    } catch (err) {
      toast.error(`Falha ao enviar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        if (!o) remember("recusado");
      }}
    >
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Levar os dados do banco antigo para a nuvem?</DialogTitle>
          <DialogDescription>
            O sistema agora guarda tudo no Supabase, e qualquer computador com login liberado vê os mesmos dados. Estes são os dados do banco da versão
            anterior (arquivo no computador). Enviar <b>substitui</b> o que está hoje na nuvem.
          </DialogDescription>
        </DialogHeader>
        {local && cloud && (
          <div className={styles.compare}>
            <div className={styles.col}>
              <div className={styles.head}>
                <HardDrive size={16} /> No banco antigo
              </div>
              {summary(local).map(([k, v]) => (
                <div key={k} className={styles.row}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <div className={styles.col}>
              <div className={styles.head}>
                <CloudUpload size={16} /> Na nuvem hoje
              </div>
              {summary(cloud).map(([k, v]) => (
                <div key={k} className={styles.row}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        {busy && <p className={styles.busy}>{busy}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => {
              remember("recusado");
              setOpen(false);
            }}
          >
            Agora não
          </Button>
          <Button onClick={send} disabled={!!busy}>
            <CloudUpload size={16} /> {busy ? "Enviando…" : "Enviar para a nuvem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
