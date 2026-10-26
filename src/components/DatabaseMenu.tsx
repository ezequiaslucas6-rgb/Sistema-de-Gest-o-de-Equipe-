import { useEffect, useState } from "react";
import { Cloud, CloudUpload, Download, LogOut } from "lucide-react";
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
import styles from "./DatabaseMenu.module.css";

/** Menu dos dados: nuvem (Supabase), usuário logado, backup em arquivo e envio dos dados do banco local antigo. */
export const DatabaseMenu = ({ className }: { className?: string }) => {
  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
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
        <DropdownMenuItem onClick={backup}>
          <Download size={15} /> Baixar backup (.json)
        </DropdownMenuItem>
        {window.escala && (
          <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(OPEN_IMPORT_EVENT))}>
            <CloudUpload size={15} /> Enviar dados deste computador…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => supabase.auth.signOut()}>
          <LogOut size={15} /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
