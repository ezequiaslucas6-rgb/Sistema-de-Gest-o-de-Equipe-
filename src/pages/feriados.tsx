import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Switch } from "../components/Switch";
import { Skeleton } from "../components/Skeleton";
import { DateField } from "../components/DateField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { scheduleEngine, Sector } from "../helpers/scheduleEngine";
import { labels } from "../helpers/labels";
import { toast } from "../helpers/toast";
import type { HolidayKind } from "../helpers/schema";
import type { HolidayDTO } from "../endpoints/data_GET.schema";
import styles from "./feriados.module.css";

type Form = {
  id?: number;
  date: string;
  name: string;
  kind: HolidayKind;
  dayOff: boolean;
  onCall: Record<Sector, string>;
  onCallHours: string;
  compDate: string;
};

export default function HolidaysPage() {
  const { data, error } = useAppData();
  const { saveHoliday, deleteHoliday, importHolidays } = useAppMutations();
  const today = scheduleEngine.todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [form, setForm] = useState<Form | null>(null);

  const teamById = useMemo(() => new Map(data?.teams.map((t) => [t.id, t]) ?? []), [data]);
  const list = useMemo(() => data?.holidays.filter((h) => h.date.startsWith(String(year))) ?? [], [data, year]);

  /** Sugere a dupla do setor com menos plantões (fim de semana + feriados), evitando quem está de plantão no fim de semana vizinho. */
  const suggestTeam = (sector: Sector, date: string, excludeHolidayId?: number) => {
    if (!data) return "__none";
    const teams = data.teams.filter((t) => t.sector === sector);
    if (teams.length === 0) return "__none";
    const near = (d: string) => Math.abs(scheduleEngine.diffDays(d, date)) <= 2;
    const score = (id: number) =>
      data.onCallShifts.filter((s) => s.teamId === id).length +
      data.holidays.filter((h) => h.id !== excludeHolidayId && h.onCallTeamIds.includes(id)).length +
      (data.onCallShifts.some((s) => s.teamId === id && (near(s.weekendStart) || s.compDates.includes(date))) ? 100 : 0);
    return String([...teams].sort((a, b) => score(a.id) - score(b.id))[0].id);
  };

  const compFor = (date: string) => scheduleEngine.holidayCompDate(date, "suporte", data?.patterns ?? [], data?.holidays ?? []);

  const openForm = (h?: HolidayDTO) => {
    const date = h?.date ?? today;
    const onCall = {} as Record<Sector, string>;
    for (const s of labels.sectors) {
      const assigned = h?.onCallTeamIds.find((id) => teamById.get(id)?.sector === s);
      onCall[s] = assigned ? String(assigned) : h ? "__none" : suggestTeam(s, date);
    }
    setForm({
      id: h?.id,
      date,
      name: h?.name ?? "",
      kind: h?.kind ?? "municipal",
      dayOff: h?.dayOff ?? true,
      onCall,
      onCallHours: h?.onCallHours ?? "08:00-12:00,14:00-18:00",
      compDate: h?.compDate ?? compFor(date),
    });
  };

  const submit = () => {
    if (!form) return;
    saveHoliday.mutate(
      {
        id: form.id,
        date: form.date,
        name: form.name,
        kind: form.kind,
        dayOff: form.dayOff,
        onCallTeamIds: form.dayOff
          ? labels.sectors.map((s) => form.onCall[s]).filter((v) => v !== "__none").map(Number)
          : [],
        onCallHours: form.onCallHours,
        compDate: form.dayOff && labels.sectors.some((s) => form.onCall[s] !== "__none") ? form.compDate : null,
      },
      { onSuccess: () => setForm(null) },
    );
  };

  const importYear = () => {
    importHolidays.mutate(
      { year },
      {
        onSuccess: (r) =>
          toast.success(r.created > 0 ? `${r.created} feriado(s) nacionais de ${year} importados` : `Feriados nacionais de ${year} já estavam cadastrados`),
      },
    );
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Feriados · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Calendário"
        title="Feriados"
        description="Feriado com folga geral tira todas as duplas da escala naquele dia e fica coberto pela dupla de plantão de cada setor. Folgas de compensação que caem em feriado são empurradas para o próximo dia útil."
        actions={
          <>
            <Button variant="outline" onClick={importYear} disabled={importHolidays.isPending}>
              <Download size={16} /> Importar nacionais de {year}
            </Button>
            <Button onClick={() => openForm()}>
              <Plus size={16} /> Novo feriado
            </Button>
          </>
        }
      />

      <div className={styles.yearNav}>
        <Button variant="ghost" size="icon-md" onClick={() => setYear(year - 1)} aria-label="Ano anterior">
          <ChevronLeft size={18} />
        </Button>
        <span className={styles.year}>{year}</span>
        <Button variant="ghost" size="icon-md" onClick={() => setYear(year + 1)} aria-label="Próximo ano">
          <ChevronRight size={18} />
        </Button>
      </div>

      <div className={styles.table}>
        {!data && <Skeleton className={styles.skel} />}
        {data && list.length === 0 && (
          <p className={styles.empty}>
            Nenhum feriado em {year}. Use <b>Importar nacionais</b> e depois inclua os estaduais e municipais da sua cidade.
          </p>
        )}
        {list.map((h) => {
          const wd = scheduleEngine.weekdayIndex(h.date);
          const past = h.date < today;
          const missing = h.dayOff && wd < 5 && labels.sectors.some(
            (s) => data!.teams.some((t) => t.sector === s) && !h.onCallTeamIds.some((id) => teamById.get(id)?.sector === s),
          );
          return (
            <div key={h.id} className={`${styles.row} ${past ? styles.past : ""}`}>
              <div className={styles.date}>
                <span className={styles.dateMain}>{scheduleEngine.formatDate(h.date).slice(0, 5)}</span>
                <span className={styles.wd}>{scheduleEngine.WEEKDAY_LONG[wd]}</span>
              </div>
              <div className={styles.info}>
                <div className={styles.name}>{h.name}</div>
                <div className={styles.meta}>
                  {h.dayOff ? (
                    h.onCallTeamIds.length > 0 ? (
                      <>
                        Plantão: {h.onCallTeamIds.map((id) => teamById.get(id)?.code).join(", ")} · {h.onCallHours} (
                        {scheduleEngine.parseHours(h.onCallHours)}h)
                        {h.compDate && ` · folga ${scheduleEngine.WEEKDAY_SHORT[scheduleEngine.weekdayIndex(h.compDate)]} ${scheduleEngine.formatDate(h.compDate).slice(0, 5)}`}
                      </>
                    ) : wd >= 5 ? (
                      "Cai no fim de semana — coberto pelo plantão do fim de semana"
                    ) : (
                      "Sem plantão definido"
                    )
                  ) : (
                    "Expediente normal"
                  )}
                </div>
              </div>
              <Badge variant={h.kind === "ponto_facultativo" ? "outline" : "secondary"}>{labels.holidayKind[h.kind]}</Badge>
              {missing && !past && <Badge variant="warning">Definir plantão</Badge>}
              <Button variant="ghost" size="icon-md" onClick={() => openForm(h)} aria-label="Editar feriado">
                <Pencil size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-md"
                aria-label="Excluir feriado"
                onClick={() => window.confirm(`Excluir o feriado "${h.name}"?`) && deleteHoliday.mutate({ id: h.id })}
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
            <DialogTitle>{form?.id ? "Editar feriado" : "Novo feriado"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className={styles.form}>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Data</label>
                  <DateField value={form.date} onChange={(v) => setForm({ ...form, date: v, compDate: compFor(v) })} />
                </div>
                <div>
                  <label className={styles.label}>Tipo</label>
                  <Select
                    value={form.kind}
                    onValueChange={(v) => setForm({ ...form, kind: v as HolidayKind, dayOff: v === "ponto_facultativo" ? false : form.dayOff })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(labels.holidayKind) as HolidayKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {labels.holidayKind[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className={styles.label}>Nome</label>
              <Input value={form.name} placeholder="Aniversário da cidade" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className={styles.switchRow}>
                <Switch checked={form.dayOff} onCheckedChange={(v) => setForm({ ...form, dayOff: v })} id="dayoff" />
                <label htmlFor="dayoff">Folga geral (só a dupla de plantão trabalha)</label>
              </div>
              {form.dayOff && (
                <>
                  <div className={styles.row2}>
                    {labels.sectors.map((s) => (
                      <div key={s}>
                        <label className={styles.label}>Plantão {labels.sectorShort[s]}</label>
                        <Select value={form.onCall[s]} onValueChange={(v) => setForm({ ...form, onCall: { ...form.onCall, [s]: v } })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Sem plantão</SelectItem>
                            {data?.teams
                              .filter((t) => t.sector === s)
                              .map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.code} · {t.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="link"
                    size="sm"
                    className={styles.suggest}
                    onClick={() =>
                      setForm({
                        ...form,
                        onCall: Object.fromEntries(labels.sectors.map((s) => [s, suggestTeam(s, form.date, form.id)])) as Record<Sector, string>,
                      })
                    }
                  >
                    Sugerir duplas (menos plantões, sem fim de semana vizinho)
                  </Button>
                  <label className={styles.label}>Horário do plantão</label>
                  <Input value={form.onCallHours} onChange={(e) => setForm({ ...form, onCallHours: e.target.value })} />
                  <p className={styles.hint}>
                    {scheduleEngine.parseHours(form.onCallHours)}h creditadas no banco de horas da dupla de plantão.
                  </p>
                  <label className={styles.label}>Folga de compensação</label>
                  <DateField value={form.compDate} onChange={(v) => setForm({ ...form, compDate: v })} />
                  <p className={styles.hint}>Padrão: próximo dia útil depois do feriado.</p>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saveHoliday.isPending || !form?.name}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
