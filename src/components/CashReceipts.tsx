import { useRef, useState } from "react";
import { Camera, FileText, Paperclip, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { toast } from "../helpers/toast";
import { type CashAdvance, type CashReceipt, money, receiptUrl, useCashMutations } from "../helpers/cash";
import { parseNumber } from "../helpers/stockImport";
import styles from "./CashReceipts.module.css";

/** Notas de um adiantamento: lista, abrir o arquivo e anexar nova (foto pelo celular ou PDF). */
export const CashReceipts = ({ advance, canEdit, myEmail }: { advance: CashAdvance; canEdit: boolean; myEmail?: string }) => {
  const { addReceipt, deleteReceipt } = useCashMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState(scheduleEngine.todayIso());

  const openFile = async (r: CashReceipt) => {
    if (!r.filePath) return;
    // abre a aba antes do await para o navegador do celular não bloquear
    const win = window.open("", "_blank");
    try {
      const url = await receiptUrl(r.filePath);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = () => {
    const value = parseNumber(amount);
    if (value == null) return toast.error("Informe o valor da nota.");
    addReceipt.mutate(
      { advanceId: advance.id, date, amount: value, description: desc || null, file },
      {
        onSuccess: () => {
          toast.success("Nota anexada");
          setFile(null);
          setAmount("");
          setDesc("");
          if (fileRef.current) fileRef.current.value = "";
        },
      },
    );
  };

  const open = advance.status === "aberto";

  return (
    <div className={styles.wrap}>
      {advance.receipts.length === 0 ? (
        <p className={styles.empty}>Nenhuma nota anexada ainda.</p>
      ) : (
        <ul className={styles.list}>
          {advance.receipts.map((r) => (
            <li key={r.id}>
              <div className={styles.info}>
                <b>{money(r.amount)}</b>
                <span>{r.description || "Nota"}</span>
                <span className={styles.meta}>{scheduleEngine.formatDate(r.date)}</span>
              </div>
              <div className={styles.rowActions}>
                {r.filePath ? (
                  <Button size="sm" variant="ghost" onClick={() => void openFile(r)}>
                    <FileText size={14} /> Ver nota
                  </Button>
                ) : (
                  <span className={styles.meta}>sem arquivo</span>
                )}
                {(canEdit || (open && r.uploadedBy === myEmail)) && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Excluir nota"
                    onClick={() => window.confirm("Excluir esta nota?") && deleteReceipt.mutate(r)}
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(open || canEdit) && (
        <div className={styles.add}>
          <div className={styles.micro}>Anexar nota</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" className={styles.pick} onClick={() => fileRef.current?.click()}>
            {file ? <Paperclip size={16} /> : <Camera size={16} />} {file ? file.name : "Foto da nota ou PDF"}
          </Button>
          <div className={styles.fields}>
            <Input inputMode="decimal" placeholder="Valor (R$)" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Valor da nota" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data da nota" />
          </div>
          <Input placeholder="Descrição (ex.: combustível, almoço, material)" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Descrição" />
          <Button onClick={submit} disabled={addReceipt.isPending || !amount}>
            {addReceipt.isPending ? "Enviando…" : "Salvar nota"}
          </Button>
        </div>
      )}
    </div>
  );
};
