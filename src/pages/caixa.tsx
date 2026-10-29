import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { AlertTriangle, Banknote, CheckCircle2, Pencil, Plus, Printer, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { CashReceipts } from "../components/CashReceipts";
import { useAppData } from "../helpers/useAppData";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { toast } from "../helpers/toast";
import { type CashAdvance, type CashStatus, cashSummary, isOverdue, money, useCash, useCashMutations } from "../helpers/cash";
import { parseNumber } from "../helpers/stockImport";
import { printDocs } from "../helpers/stockPrint";
import styles from "./caixa.module.css";

type Filter = "abertos" | "prestados" | "acertados" | "todos";
type Form = { id?: number; who: string; amount: string; purpose: string; givenAt: string; dueAt: string; notes: string };

const STATUS: Record<CashStatus, string> = { aberto: "Com a equipe", prestado: "Prestação entregue", acertado: "Acertado" };
const fmtDate = (d: string | null) => (d ? scheduleEngine.formatDate(d) : "—");
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

/** Caixa das equipes: dinheiro entregue, notas, troco e acerto. */
export default function CashPage() {
  const { data } = useAppData();
  const { data: advances, error } = useCash();
  const { saveAdvance, settleAdvance, deleteAdvance } = useCashMutations();
  const [filter, setFilter] = useState<Filter>("abertos");
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [change, setChange] = useState({ value: "", date: scheduleEngine.todayIso() });
  const today = scheduleEngine.todayIso();

  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const techById = useMemo(() => new Map((data?.technicians ?? []).map((t) => [t.id, t])), [data]);
  const whoOf = (a: Pick<CashAdvance, "technicianId" | "teamId">) => {
    const tech = a.technicianId ? techById.get(a.technicianId) : undefined;
    const team = a.teamId ? teamById.get(a.teamId) : tech?.teamId ? teamById.get(tech.teamId) : undefined;
    return { name: tech?.name ?? (team ? `Dupla ${team.code}` : "—"), team: team ? `${team.code} · ${team.name}` : "" };
  };

  const list = useMemo(
    () =>
      (advances ?? []).filter((a) =>
        filter === "todos" ? true : filter === "abertos" ? a.status === "aberto" : filter === "prestados" ? a.status === "prestado" : a.status === "acertado",
      ),
    [advances, filter],
  );

  const stats = useMemo(() => {
    const all = advances ?? [];
    const open = all.filter((a) => a.status !== "acertado");
    const month = today.slice(0, 7);
    return {
      withTeams: open.reduce((s, a) => s + Math.max(0, cashSummary(a).pending), 0),
      openCount: open.length,
      overdue: all.filter((a) => isOverdue(a, today)).length,
      month: all.filter((a) => a.givenAt.slice(0, 7) === month).reduce((s, a) => s + a.amount, 0),
    };
  }, [advances, today]);

  const current = advances?.find((a) => a.id === openId) ?? null;

  const newForm = () => setForm({ who: "", amount: "", purpose: "", givenAt: today, dueAt: scheduleEngine.addDays(today, 7), notes: "" });
  const editForm = (a: CashAdvance) =>
    setForm({
      id: a.id,
      who: a.technicianId ? `t${a.technicianId}` : `e${a.teamId}`,
      amount: String(a.amount).replace(".", ","),
      purpose: a.purpose,
      givenAt: a.givenAt,
      dueAt: a.dueAt ?? "",
      notes: a.notes ?? "",
    });

  const submit = () => {
    if (!form) return;
    const isTech = form.who.startsWith("t");
    const id = Number(form.who.slice(1)) || null;
    saveAdvance.mutate(
      {
        id: form.id,
        technicianId: isTech ? id : null,
        teamId: isTech ? (id ? (techById.get(id)?.teamId ?? null) : null) : id,
        amount: parseNumber(form.amount) ?? 0,
        purpose: form.purpose,
        givenAt: form.givenAt,
        dueAt: form.dueAt || null,
        notes: form.notes || null,
      },
      {
        onSuccess: () => {
          toast.success(form.id ? "Adiantamento atualizado" : "Dinheiro entregue registrado");
          setForm(null);
        },
      },
    );
  };

  const settle = (a: CashAdvance, status: CashStatus) => {
    const value = change.value.trim() ? (parseNumber(change.value) ?? 0) : a.changeReturned;
    settleAdvance.mutate(
      { id: a.id, status, changeReturned: value, changeReturnedAt: value > 0 ? change.date : null },
      { onSuccess: () => toast.success(status === "acertado" ? "Acerto concluído" : status === "prestado" ? "Prestação registrada" : "Reaberto") },
    );
  };

  const printAdvance = (a: CashAdvance) => {
    const s = cashSummary(a);
    const who = whoOf(a);
    const rows = a.receipts
      .map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.description || "Nota")}</td><td class="r">${money(r.amount)}</td><td>${r.filePath ? "anexada" : "—"}</td></tr>`)
      .join("");
    printDocs(`Prestação de contas #${a.id}`, [
      `<header><h1>Prestação de contas #${a.id}</h1><div class="brand">Nortetel · Escala Técnica<br/>Impresso em ${new Date().toLocaleString("pt-BR")}</div></header>
      <p class="meta">Responsável: <b>${esc(who.name)}</b> ${who.team ? `· ${esc(who.team)}` : ""}<br/>Finalidade: <b>${esc(a.purpose)}</b><br/>
      Entregue em <b>${fmtDate(a.givenAt)}</b> · Prazo para prestar contas: <b>${fmtDate(a.dueAt)}</b> · Situação: <b>${STATUS[a.status]}</b></p>
      <table><thead><tr><th>Data</th><th>Nota</th><th class="r">Valor</th><th>Arquivo</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Sem notas.</td></tr>'}</tbody></table>
      <table style="margin-top:10px;width:50%"><tbody>
        <tr><td>Valor entregue</td><td class="r"><b>${money(a.amount)}</b></td></tr>
        <tr><td>Total das notas</td><td class="r">${money(s.spent)}</td></tr>
        <tr><td>Troco devolvido ${a.changeReturnedAt ? `em ${fmtDate(a.changeReturnedAt)}` : ""}</td><td class="r">${money(a.changeReturned)}</td></tr>
        <tr><td><b>${s.pending > 0 ? "Falta prestar contas" : s.pending < 0 ? "A reembolsar à equipe" : "Diferença"}</b></td><td class="r"><b>${money(Math.abs(s.pending))}</b></td></tr>
      </tbody></table>
      ${a.notes ? `<p class="note"><b>Observações:</b> ${esc(a.notes)}</p>` : ""}
      <div class="sign"><div>${esc(who.name)}<br/>Recebeu</div><div>Supervisor</div></div>`,
    ]);
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Caixa das equipes — Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Financeiro de campo"
        title="Caixa das equipes"
        description="Dinheiro entregue às equipes, notas anexadas pelos técnicos no celular, troco devolvido e acerto."
        actions={
          <Button onClick={newForm} disabled={!data}>
            <Plus size={16} /> Entregar dinheiro
          </Button>
        }
      />
      {error && <p className={styles.error}>{error instanceof Error ? error.message : String(error)}</p>}

      <div className={styles.stats}>
        <div className={styles.stat}>
          <b>{money(stats.withTeams)}</b>
          <span>Com as equipes (sem nota ou troco)</span>
        </div>
        <div className={styles.stat}>
          <b>{stats.openCount}</b>
          <span>Adiantamentos não acertados</span>
        </div>
        <div className={`${styles.stat} ${stats.overdue ? styles.bad : ""}`}>
          <b>{stats.overdue}</b>
          <span>Com prazo de prestação vencido</span>
        </div>
        <div className={styles.stat}>
          <b>{money(stats.month)}</b>
          <span>Entregue neste mês</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="abertos">Com a equipe</ToggleGroupItem>
          <ToggleGroupItem value="prestados">A conferir</ToggleGroupItem>
          <ToggleGroupItem value="acertados">Acertados</ToggleGroupItem>
          <ToggleGroupItem value="todos">Todos</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {!advances ? (
        <Skeleton className={styles.skel} />
      ) : list.length === 0 ? (
        <p className={styles.empty}>Nada aqui.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Entregue</th>
                <th>Responsável</th>
                <th>Finalidade</th>
                <th className={styles.r}>Valor</th>
                <th className={styles.r}>Notas</th>
                <th className={styles.r}>Troco</th>
                <th className={styles.r}>Falta acertar</th>
                <th>Prazo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const s = cashSummary(a);
                const who = whoOf(a);
                const late = isOverdue(a, today);
                return (
                  <tr key={a.id} className={styles.clickable} onClick={() => (setOpenId(a.id), setChange({ value: "", date: today }))}>
                    <td className={styles.mono}>{fmtDate(a.givenAt)}</td>
                    <td>
                      <b>{who.name}</b> <div className={styles.meta}>{who.team}</div>
                    </td>
                    <td>{a.purpose}</td>
                    <td className={`${styles.mono} ${styles.r}`}>{money(a.amount)}</td>
                    <td className={`${styles.mono} ${styles.r}`}>
                      {money(s.spent)} <div className={styles.meta}>{a.receipts.length} nota(s)</div>
                    </td>
                    <td className={`${styles.mono} ${styles.r}`}>{money(a.changeReturned)}</td>
                    <td className={`${styles.mono} ${styles.r} ${s.pending > 0 ? styles.badText : s.pending < 0 ? styles.warnText : styles.okText}`}>
                      {s.pending === 0 ? "ok" : money(Math.abs(s.pending))}
                      {s.pending < 0 && <div className={styles.meta}>reembolsar</div>}
                    </td>
                    <td className={late ? styles.badText : ""}>
                      {fmtDate(a.dueAt)}
                      {late && (
                        <div className={styles.meta}>
                          <AlertTriangle size={11} /> vencido
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.pill} ${styles[a.status]}`}>{STATUS[a.status]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- entregar / editar ---------- */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar adiantamento" : "Entregar dinheiro"}</DialogTitle>
          </DialogHeader>
          {form && data && (
            <div className={styles.form}>
              <label className={styles.label}>Quem recebeu</label>
              <Select value={form.who} onValueChange={(v) => setForm({ ...form, who: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Técnico ou dupla" />
                </SelectTrigger>
                <SelectContent>
                  {data.technicians.map((t) => (
                    <SelectItem key={`t${t.id}`} value={`t${t.id}`}>
                      {t.name} {t.teamId ? `· ${teamById.get(t.teamId)?.code}` : ""}
                    </SelectItem>
                  ))}
                  {data.teams.map((t) => (
                    <SelectItem key={`e${t.id}`} value={`e${t.id}`}>
                      Dupla {t.code} · {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Valor (R$)</label>
                  <Input inputMode="decimal" value={form.amount} placeholder="0,00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Entregue em</label>
                  <Input type="date" value={form.givenAt} onChange={(e) => setForm({ ...form, givenAt: e.target.value })} />
                </div>
              </div>
              <label className={styles.label}>Finalidade</label>
              <Input value={form.purpose} placeholder="Ex.: combustível viagem Rondolândia, compra de material" onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              <label className={styles.label}>Prazo para devolver notas e troco</label>
              <Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saveAdvance.isPending || !form?.who}>
              <Banknote size={15} /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- detalhe ---------- */}
      <Dialog open={!!current} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className={styles.dialog}>
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {whoOf(current).name} · {money(current.amount)}
                </DialogTitle>
              </DialogHeader>
              <div className={styles.form}>
                <div className={styles.detailHead}>
                  <div>
                    <div>{current.purpose}</div>
                    <div className={styles.meta}>
                      Entregue em {fmtDate(current.givenAt)} · prazo {fmtDate(current.dueAt)} · <b>{STATUS[current.status]}</b>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => (editForm(current), setOpenId(null))}>
                    <Pencil size={14} /> Editar
                  </Button>
                </div>
                {(() => {
                  const s = cashSummary(current);
                  return (
                    <div className={styles.sum}>
                      <span>
                        Notas <b>{money(s.spent)}</b>
                      </span>
                      <span>
                        Troco esperado <b>{money(Math.max(0, s.expectedChange))}</b>
                      </span>
                      <span>
                        Troco devolvido <b>{money(current.changeReturned)}</b>
                        {current.changeReturnedAt && ` em ${fmtDate(current.changeReturnedAt)}`}
                      </span>
                      <span className={s.pending > 0 ? styles.badText : s.pending < 0 ? styles.warnText : styles.okText}>
                        {s.pending > 0 ? "Falta acertar" : s.pending < 0 ? "Reembolsar à equipe" : "Fechado"} <b>{money(Math.abs(s.pending))}</b>
                      </span>
                    </div>
                  );
                })()}
                <CashReceipts advance={current} canEdit />
                {current.status !== "acertado" && (
                  <div className={styles.changeBox}>
                    <div className={styles.micro}>Troco devolvido</div>
                    <div className={styles.row2}>
                      <Input
                        inputMode="decimal"
                        placeholder={current.changeReturned ? String(current.changeReturned).replace(".", ",") : `sugerido ${money(Math.max(0, cashSummary(current).expectedChange))}`}
                        value={change.value}
                        onChange={(e) => setChange({ ...change, value: e.target.value })}
                        aria-label="Troco devolvido"
                      />
                      <Input type="date" value={change.date} onChange={(e) => setChange({ ...change, date: e.target.value })} aria-label="Data da devolução" />
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className={styles.footer}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm("Excluir este adiantamento e as notas anexadas?")) deleteAdvance.mutate(current, { onSuccess: () => setOpenId(null) });
                  }}
                >
                  <Trash2 size={14} /> Excluir
                </Button>
                <Button variant="ghost" onClick={() => printAdvance(current)}>
                  <Printer size={14} /> Imprimir
                </Button>
                <span className={styles.spacer} />
                {current.status === "acertado" ? (
                  <Button variant="outline" onClick={() => settle(current, "aberto")}>
                    <RotateCcw size={14} /> Reabrir
                  </Button>
                ) : (
                  <>
                    {current.status === "aberto" && (
                      <Button variant="outline" onClick={() => settle(current, "prestado")}>
                        Prestação entregue
                      </Button>
                    )}
                    <Button onClick={() => settle(current, "acertado")}>
                      <CheckCircle2 size={15} /> Acertar
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
