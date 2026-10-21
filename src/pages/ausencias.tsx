import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { DateField } from "../components/DateField";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import type { AbsenceKind } from "../helpers/schema";
import styles from "./ausencias.module.css";

type Form = { technicianId: string; kind: AbsenceKind; startDate: string; endDate: string; notes: string };

export default function AbsencesPage() {
  const { data, error } = useAppData();
  const { saveAbsence, deleteAbsence } = useAppMutations();
  const today = scheduleEngine.todayIso();
  const [scope, setScope] = useState<"ativas" | "todas">("ativas");
  const [form, setForm] = useState<Form | null>(null);

  const techById = useMemo(() => new Map(data?.technicians.map((t) => [t.id, t]) ?? []), [data]);
  const teamById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);

  const list = useMemo(() => {
    const all = data?.absences ?? [];
    const filtered = scope === "ativas" ? all.filter((a) => a.endDate >= today) : all;
    return [...filtered].sort((a, b) => (scope === "ativas" ? a.startDate.localeCompare(b.startDate) : b.startDate.localeCompare(a.startDate)));
  }, [data, scope, today]);

  // Disponibilidade hoje por setor (técnicos sem ausência)
  const availability = labels.sectors.map((sector) => {
    const techs = data?.technicians.filter((t) => t.teamId && teamById.get(t.teamId)?.sector === sector) ?? [];
    const away = techs.filter((t) => scheduleEngine.isAbsent(data?.absences ?? [], t.id, today));
    return { sector, total: techs.length, away: away.length };
  });

  const submit = () => {
    if (!form) return;
    saveAbsence.mutate(
      {
        technicianId: Number(form.technicianId),
        kind: form.kind,
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes || null,
      },
      { onSuccess: () => setForm(null) },
    );
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Ausências · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Disponibilidade"
        title="Ausências"
        description="Férias, atestados, folgas extras e treinamentos. A escala e o painel marcam as duplas desfalcadas automaticamente."
        actions={
          <Button onClick={() => setForm({ technicianId: "", kind: "ferias", startDate: today, endDate: today, notes: "" })}>
            <Plus size={16} /> Nova ausência
          </Button>
        }
      />

      <div className={styles.availability}>
        {availability.map((a) => (
          <div key={a.sector} className={styles.availCard}>
            <span className={styles.micro}>{labels.sector[a.sector]} · hoje</span>
            <span className={styles.availNum}>
              {a.total - a.away}
              <span className={styles.availOf}>/{a.total} técnicos disponíveis</span>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.toolbar}>
        <ToggleGroup type="single" value={scope} onValueChange={(v) => v && setScope(v as "ativas" | "todas")}>
          <ToggleGroupItem value="ativas">Atuais e futuras</ToggleGroupItem>
          <ToggleGroupItem value="todas">Histórico completo</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={styles.table}>
        {!data && <Skeleton className={styles.skel} />}
        {data && list.length === 0 && <p className={styles.empty}>Nenhuma ausência registrada.</p>}
        {list.map((a) => {
          const tech = techById.get(a.technicianId);
          const team = tech?.teamId ? teamById.get(tech.teamId) : undefined;
          const active = a.startDate <= today && a.endDate >= today;
          const days = scheduleEngine.diffDays(a.endDate, a.startDate) + 1;
          return (
            <div key={a.id} className={styles.row}>
              <div className={styles.dates}>
                {scheduleEngine.formatDate(a.startDate)}
                {a.endDate !== a.startDate && <> → {scheduleEngine.formatDate(a.endDate)}</>}
                <span className={styles.days}>{days} dia(s)</span>
              </div>
              <div className={styles.who}>
                <div className={styles.name}>{tech?.name ?? "Técnico removido"}</div>
                <div className={styles.meta}>
                  {team ? `${team.code} · ${labels.sectorShort[team.sector]}` : "Sem equipe"}
                  {a.notes ? ` · ${a.notes}` : ""}
                </div>
              </div>
              <Badge variant={a.kind === "atestado" ? "destructive" : a.kind === "ferias" ? "secondary" : "outline"}>{labels.absenceKind[a.kind]}</Badge>
              {active && <Badge variant="warning">Em andamento</Badge>}
              <Button
                variant="ghost"
                size="icon-md"
                aria-label="Remover ausência"
                onClick={() => {
                  if (window.confirm("Remover esta ausência?")) deleteAbsence.mutate({ id: a.id });
                }}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova ausência</DialogTitle>
          </DialogHeader>
          {form && (
            <div className={styles.form}>
              <label className={styles.label}>Técnico</label>
              <Select value={form.technicianId} onValueChange={(v) => setForm({ ...form, technicianId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {data?.technicians.map((t) => {
                    const team = t.teamId ? teamById.get(t.teamId) : undefined;
                    return (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name} {team ? `(${team.code})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <label className={styles.label}>Tipo</label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as AbsenceKind })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(labels.absenceKind) as AbsenceKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {labels.absenceKind[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>De</label>
                  <DateField
                    value={form.startDate}
                    onChange={(v) => setForm({ ...form, startDate: v, endDate: form.endDate < v ? v : form.endDate })}
                  />
                </div>
                <div>
                  <label className={styles.label}>Até</label>
                  <DateField value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
                </div>
              </div>
              {form.endDate < form.startDate && <p className={styles.errorText}>A data final deve ser igual ou posterior à inicial.</p>}
              <label className={styles.label}>Observações</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saveAbsence.isPending || !form?.technicianId || (form?.endDate ?? "") < (form?.startDate ?? "")}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
