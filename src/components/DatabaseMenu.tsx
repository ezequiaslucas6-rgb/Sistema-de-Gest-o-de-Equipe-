import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, FolderOpen, Download, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Button } from "./Button";
import { desktop } from "../helpers/desktop";
import { toast } from "../helpers/toast";
import styles from "./DatabaseMenu.module.css";

/** Menu do banco local: onde está o arquivo, backup, restauração. */
export const DatabaseMenu = ({ className }: { className?: string }) => {
  const qc = useQueryClient();
  const [dbPath, setDbPath] = useState<string>("");

  useEffect(() => {
    window.escala?.info().then((i) => setDbPath(i.dbPath));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-md" className={className} aria-label="Banco de dados" title="Banco de dados">
          <Database size={18} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className={styles.content}>
        <DropdownMenuLabel>
          <div className={styles.label}>Banco de dados neste computador</div>
          <div className={styles.path}>{dbPath || "—"}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            run(async () => {
              const r = await desktop().backup();
              if (r.saved) toast.success("Backup salvo", { description: r.filePath });
            })
          }
        >
          <Download size={15} /> Fazer backup…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            run(async () => {
              if (!window.confirm("Restaurar um backup substitui os dados atuais (uma cópia do banco atual é guardada na mesma pasta). Continuar?")) return;
              const r = await desktop().restore();
              if (r.restored) {
                await qc.invalidateQueries();
                toast.success("Backup restaurado");
              }
            })
          }
        >
          <Upload size={15} /> Restaurar backup…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run(async () => void (await desktop().openFolder()))}>
          <FolderOpen size={15} /> Abrir pasta do banco
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
