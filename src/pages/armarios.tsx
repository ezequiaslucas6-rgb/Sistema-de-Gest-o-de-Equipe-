import { FormEvent, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import { Popover, PopoverContent, PopoverTrigger } from "../components/Popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { LOCKER_COUNT } from "../helpers/api";
import { labels } from "../helpers/labels";
import type { LockerDTO } from "../endpoints/data_GET.schema";
import styles from "./armarios.module.css";

const COLS = 6;
const pad = (n: number) => String(n).padStart(2, "0");
/** Nome mostrado na porta: a 13 aparece como "12+1", como no armário físico. */
const doorLabel = (id: string) => (id === "13" ? "12+1" : id);

type Filter = "todos" | "ocupados" | "livres";
type Form = { technicianId: string; name: string; sector: string; since: string; note: string };

export default function LockersPage() {
  const { data, error } = useAppData();
  const { saveLocker, freeLocker } = useAppMutations();
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const byId = useMemo(() => new Map((data?.lockers ?? []).map((l) => [l.id, l])), [data]);
  const teamById = useMemo(() => new Map((data?.teams ?? []).map((t) => [t.id, t])), [data]);
  const ids = Array.from({ length: LOCKER_COUNT }, (_, i) => pad(i + 1));
  const busy = data?.lockers.length ?? 0;

  /** Setor sugerido para um técnico: função + código da dupla. */
  const technicianSector = (technicianId: number) => {
    const tech = data?.technicians.find((t) => t.id === technicianId);
    if (!tech) return "";
    const team = tech.teamId ? teamById.get(tech.teamId) : undefined;
    return [tech.role, team ? `${team.code} · ${labels.sectorShort[team.sector]}` : null].filter(Boolean).join(" — ");
  };

  const matches = (id: string) => {
    const l = byId.get(id);
    if (filter === "ocupados" && !l) return false;
    if (filter === "livres" && l) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [id, String(Number(id)), doorLabel(id), l?.name, l?.sector].join(" ").toLowerCase().includes(q);
  };

  const open = (id: string) => {
    const l = byId.get(id);
    setOpenId(id);
    setFormError(null);
    setForm({
      technicianId: l?.technicianId ? String(l.technicianId) : "__none",
      name: l?.name ?? "",
      sector: l?.sector ?? "",
      since: l?.since ?? "",
      note: l?.note ?? "",
    });
  };
  const close = () => {
    setOpenId(null);
    setForm(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!openId || !form) return;
    if (!form.name.trim()) {
      setFormError("Informe o nome do ocupante para salvar.");
      return;
    }
    saveLocker.mutate(
      {
        id: openId,
        name: form.name,
        sector: form.sector || null,
        since: form.since || null,
        note: form.note || null,
        technicianId: form.technicianId === "__none" ? null : Number(form.technicianId),
      },
      { onSuccess: close },
    );
  };

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Armários · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Vestiário"
        title="Mapa dos Armários"
        description="Clique em uma porta para registrar ou liberar o ocupante. A grade segue o armário físico: 01 a 06 na primeira fileira."
        actions={
          <div className={styles.stats}>
            <div className={styles.stat}>
              <b>{LOCKER_COUNT}</b>
              <span>Portas</span>
            </div>
            <div className={`${styles.stat} ${styles.statBusy}`}>
              <b>{data ? busy : "–"}</b>
              <span>Ocupados</span>
            </div>
            <div className={`${styles.stat} ${styles.statFree}`}>
              <b>{data ? LOCKER_COUNT - busy : "–"}</b>
              <span>Livres</span>
            </div>
          </div>
        }
      />

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} />
          <Input
            type="search"
            placeholder="Buscar por nome, setor ou número"
            aria-label="Buscar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)}>
          <ToggleGroupItem value="todos">Todos</ToggleGroupItem>
          <ToggleGroupItem value="ocupados">Ocupados</ToggleGroupItem>
          <ToggleGroupItem value="livres">Livres</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className={styles.cabinet}>
        {!data ? (
          <Skeleton className={styles.skel} />
        ) : (
          <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
            {ids.map((id) => {
              const l = byId.get(id);
              return (
                <Popover key={id} open={openId === id} onOpenChange={(o) => (o ? open(id) : close())}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`${styles.locker} ${l ? styles.busy : ""} ${matches(id) ? "" : styles.dim} ${openId === id ? styles.open : ""}`}
                      aria-label={`Armário ${doorLabel(id)}, ${l ? `ocupado por ${l.name}` : "livre"}`}
                    >
                      <span className={styles.num}>{doorLabel(id)}</span>
                      <span className={styles.lock} aria-hidden>
                        <i />
                        <i />
                      </span>
                      <span className={styles.occupant}>{l?.name ?? ""}</span>
                      <span className={styles.chip}>{l ? "Ocupado" : "Livre"}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side={(Number(id) - 1) % COLS >= COLS / 2 ? "left" : "right"}
                    align="start"
                    collisionPadding={12}
                    className={styles.editor}
                  >
                    {form && openId === id && (
                      <form onSubmit={submit} className={styles.form} aria-label={`Editar armário ${doorLabel(id)}`}>
                        <div className={styles.editorHead}>
                          Armário {doorLabel(id)} · {l ? "ocupado" : "livre"}
                        </div>
                        <label className={styles.label}>Técnico da equipe</label>
                        <Select
                          value={form.technicianId}
                          onValueChange={(v) => {
                            const tech = data.technicians.find((t) => String(t.id) === v);
                            setForm({
                              ...form,
                              technicianId: v,
                              ...(tech ? { name: tech.name, sector: technicianSector(tech.id) } : {}),
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">Outra pessoa (digitar nome)</SelectItem>
                            {data.technicians.map((t) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.name}
                                {t.teamId ? ` (${teamById.get(t.teamId)?.code ?? ""})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className={styles.label} htmlFor="locker-name">
                          Ocupante
                        </label>
                        <Input
                          id="locker-name"
                          autoFocus
                          maxLength={80}
                          placeholder="Nome completo"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                        <label className={styles.label} htmlFor="locker-sector">
                          Setor / função
                        </label>
                        <Input
                          id="locker-sector"
                          maxLength={60}
                          placeholder="Ex.: Técnico de campo"
                          value={form.sector}
                          onChange={(e) => setForm({ ...form, sector: e.target.value })}
                        />
                        <label className={styles.label} htmlFor="locker-since">
                          Desde
                        </label>
                        <Input id="locker-since" type="date" value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} />
                        <label className={styles.label} htmlFor="locker-note">
                          Observação
                        </label>
                        <Textarea
                          id="locker-note"
                          maxLength={300}
                          placeholder="Ex.: chave reserva com a portaria"
                          value={form.note}
                          onChange={(e) => setForm({ ...form, note: e.target.value })}
                        />
                        {formError && <p className={styles.formError}>{formError}</p>}
                        <div className={styles.actions}>
                          <Button type="submit" disabled={saveLocker.isPending}>
                            Salvar ocupante
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className={styles.freeBtn}
                            disabled={!l || freeLocker.isPending}
                            onClick={() => freeLocker.mutate({ id }, { onSuccess: close })}
                          >
                            Liberar
                          </Button>
                        </div>
                      </form>
                    )}
                  </PopoverContent>
                </Popover>
              );
            })}
          </div>
        )}
      </div>

      {data && data.lockers.length > 0 && (
        <section className={styles.listSection}>
          <h2 className={styles.h2}>Ocupantes</h2>
          <div className={styles.listWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Porta</th>
                  <th>Ocupante</th>
                  <th>Setor / função</th>
                  <th>Desde</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {data.lockers
                  .filter((l: LockerDTO) => matches(l.id))
                  .map((l) => (
                    <tr key={l.id} onClick={() => open(l.id)} className={styles.row}>
                      <td className={styles.n}>{doorLabel(l.id)}</td>
                      <td>{l.name}</td>
                      <td>{l.sector ?? "—"}</td>
                      <td className={styles.mono}>{l.since ? l.since.split("-").reverse().join("/") : "—"}</td>
                      <td className={styles.note}>{l.note ?? ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
