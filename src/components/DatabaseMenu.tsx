import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Cloud, CloudUpload, Download, FileUp, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Button } from "./Button";
import { supabase } from "../helpers/supabase";
import { cloudGetData } from "../helpers/cloud";
import { toast } from "../helpers/toast";
import { OPEN_IMPORT_EVENT } from "./CloudImportDialog";
import { useProfile } from "../helpers/profile";
import { type PushState, disablePush, enablePush, pushState } from "../helpers/push";
import styles from "./DatabaseMenu.module.css";

/** Menu dos dados: nuvem (Supabase), usuário logado, backup em arquivo e envio dos dados do banco local antigo. */
export const DatabaseMenu = ({ className }: { className?: string }) => {
  const [email, setEmail] = useState("");
  const { role } = useProfile();
  const [push, setPush] = useState<PushState | null>(null);
  const togglePush = async () => {
    try {
      if (push === "ligado") {
        await disablePush();
        setPush("desligado");
        toast.success("Avisos desligados neste aparelho");
      } else {
        const st = await enablePush();
        setPush(st);
        if (st === "ligado") toast.success("Avisos ligados neste aparelho");
        else if (st === "bloqueado") toast.error("Notificações bloqueadas. Libere nas configurações do aparelho ou do navegador.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      // carrega o leitor de SQLite só quando precisa
      const { readLocalDbFile } = await import("../helpers/localFile");
      const data = await readLocalDbFile(file);
      window.dispatchEvent(new CustomEvent(OPEN_IMPORT_EVENT, { detail: data }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    void pushState().then(setPush).catch(() => setPush("indisponivel"));
  }, []);

  const backup = async () => {
    try {
      const data = await cloudGetData();
      const blob = new Blob([JSON.stringify({ exportadoEm: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `escala-tecnica-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Backup gerado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
    <input
      ref={fileRef}
      type="file"
      accept=".sqlite,.db,.sqlite3"
      hidden
      onChange={(e) => void pickFile(e.target.files?.[0])}
    />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-md" className={className} aria-label="Dados na nuvem" title="Dados na nuvem">
          <Cloud size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className={styles.content}>
        <DropdownMenuLabel>
          <div className={styles.label}>Dados na nuvem (Supabase)</div>
          <div className={styles.path}>{email || "—"}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {role === "supervisor" && (
          <>
        <DropdownMenuItem onClick={backup}>
          <Download size={15} /> Baixar backup (.json)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => fileRef.current?.click()}>
          <FileUp size={15} /> Enviar dados do banco antigo (arquivo)…
        </DropdownMenuItem>
        {window.escala && (
          <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(OPEN_IMPORT_EVENT))}>
            <CloudUpload size={15} /> Enviar dados deste computador…
          </DropdownMenuItem>
        )}
          </>
        )}
        {push && push !== "indisponivel" && push !== "instalar" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void togglePush()} disabled={push === "bloqueado"}>
              {push === "ligado" ? <BellOff size={15} /> : <Bell size={15} />}{" "}
              {push === "ligado" ? "Desligar avisos neste aparelho" : push === "bloqueado" ? "Avisos bloqueados neste aparelho" : "Ligar avisos neste aparelho"}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => supabase.auth.signOut()}>
          <LogOut size={15} /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
};
