import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Switch } from "./Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { toast } from "../helpers/toast";
import { type Service, type StockData, type StockSector, itemFitsSector, useStockMutations } from "../helpers/stock";
import { parseNumber } from "../helpers/stockImport";
import styles from "./StockServicesPanel.module.css";

type Sector = "suporte" | "infraestrutura";
type Form = { id?: number; name: string; sector: StockSector; weekly: string; active: boolean; materials: { itemId: number; qty: string }[] };
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * Fluxo de serviço: quanto de cada material um serviço gasta e quantos serviços cada colaborador faz por semana.
 * É a base do cálculo do abastecimento semanal.
 */
export const StockServicesPanel = ({ data, sector }: { data: StockData; sector: Sector }) => {
  const { saveService, deleteService, saveForecast } = useStockMutations();
  const [form, setForm] = useState<Form | null>(null);
  const services = data.services.filter((s) => s.sector === "ambos" || s.sector === sector);
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const techs = data.technicians.filter((t) => data.teams.find((x) => x.id === t.teamId)?.sector === sector);

  const open = (s?: Service) =>
    setForm(
      s
        ? { id: s.id, name: s.name, sector: s.sector, weekly: fmt(s.weeklyPerTech), active: s.active, materials: s.materials.map((m) => ({ itemId: m.itemId, qty: fmt(m.qty) })) }
        : { name: "", sector, weekly: "0", active: true, materials: [] },
    );

  const submit = () => {
    if (!form) return;
    saveService.mutate(
      {
        id: form.id,
        name: form.name,
        sector: form.sector,
        weeklyPerTech: parseNumber(form.weekly) ?? 0,
        active: form.active,
        materials: form.materials.map((m) => ({ itemId: m.itemId, qty: parseNumber(m.qty) ?? 0 })),
      },
      {
        onSuccess: () => {
          toast.success("Serviço salvo");
          setForm(null);
        },
      },
    );
  };

  const addable = form ? data.items.filter((i) => i.active && itemFitsSector(i, sector) && !form.materials.some((m) => m.itemId === i.id)) : [];

  return (
    <section>
      <div className={styles.bar}>
        <p className={styles.meta}>
          Material gasto em cada serviço e quantos serviços cada técnico faz por semana. O abastecimento semanal soma isso para cada colaborador.
        </p>
        <Button size="sm" variant="outline" onClick={() => open()}>
          <Plus size={14} /> Novo serviço
        </Button>
      </div>

      <div className={styles.cards}>
        {services.map((s) => (
          <div key={s.id} className={`${styles.card} ${s.active ? "" : styles.inactive}`}>
            <div className={styles.cardHead}>
              <b>{s.name}</b>
              <Button size="icon-sm" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => open(s)}>
                <Pencil size={14} />
              </Button>
            </div>
            <div className={styles.meta}>
              {fmt(s.weeklyPerTech)} por técnico na semana{s.active ? "" : " · desativado"}
            </div>
            <ul className={styles.mats}>
              {s.materials.map((m) => {
                const item = itemById.get(m.itemId);
                return (
                  <li key={m.itemId}>
                    <span>{item?.name ?? "item removido"}</span>
                    <b>
                      {fmt(m.qty)} {item?.unit}
                    </b>
                  </li>
                );
              })}
              {s.materials.length === 0 && <li className={styles.meta}>sem materiais</li>}
            </ul>
          </div>
        ))}
        {services.length === 0 && <p className={styles.meta}>Nenhum serviço cadastrado neste setor.</p>}
      </div>

      {services.length > 0 && techs.length > 0 && (
        <>
          <h3 className={styles.h3}>Serviços por semana de cada técnico</h3>
          <p className={styles.meta}>Em branco = padrão do serviço. Preencha só quem faz mais ou menos que o padrão.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Técnico</th>
                  {services
                    .filter((s) => s.active)
                    .map((s) => (
                      <th key={s.id} className={styles.r}>
                        {s.name}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {techs.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name} <span className={styles.meta}>{data.teams.find((x) => x.id === t.teamId)?.code}</span>
                    </td>
                    {services
                      .filter((s) => s.active)
                      .map((s) => {
                        const own = data.forecast.find((f) => f.technicianId === t.id && f.serviceId === s.id);
                        return (
                          <td key={s.id} className={styles.r}>
                            <Input
                              key={`${t.id}-${s.id}-${own?.weeklyQty ?? ""}`}
                              inputMode="decimal"
                              className={styles.qty}
                              placeholder={fmt(s.weeklyPerTech)}
                              defaultValue={own ? fmt(own.weeklyQty) : ""}
                              aria-label={`${s.name} por semana de ${t.name}`}
                              onBlur={(e) => {
                                const v = e.target.value.trim() ? parseNumber(e.target.value) : null;
                                if (v !== (own?.weeklyQty ?? null)) saveForecast.mutate({ technicianId: t.id, serviceId: s.id, weeklyQty: v });
                              }}
                            />
                          </td>
                        );
                      })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className={styles.form}>
              <div className={styles.row}>
                <div>
                  <label className={styles.label}>Serviço</label>
                  <Input value={form.name} placeholder="Ex.: Instalação FTTH" onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Por técnico na semana</label>
                  <Input inputMode="decimal" value={form.weekly} onChange={(e) => setForm({ ...form, weekly: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Setor</label>
                  <Select value={form.sector} onValueChange={(v) => setForm({ ...form, sector: v as StockSector })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suporte">Suporte</SelectItem>
                      <SelectItem value="infraestrutura">Infra / Backbone</SelectItem>
                      <SelectItem value="ambos">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className={styles.label}>Material gasto em cada serviço</label>
              <div className={styles.matList}>
                {form.materials.map((m, idx) => {
                  const item = itemById.get(m.itemId);
                  return (
                    <div key={m.itemId} className={styles.matRow}>
                      <span>
                        {item?.name} <span className={styles.meta}>{item?.unit}</span>
                      </span>
                      <Input
                        inputMode="decimal"
                        className={styles.qty}
                        value={m.qty}
                        onChange={(e) => setForm({ ...form, materials: form.materials.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)) })}
                        aria-label={`Quantidade de ${item?.name}`}
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Tirar ${item?.name}`}
                        onClick={() => setForm({ ...form, materials: form.materials.filter((_, i) => i !== idx) })}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  );
                })}
              </div>
              {addable.length > 0 && (
                <Select value="" onValueChange={(v) => setForm({ ...form, materials: [...form.materials, { itemId: Number(v), qty: "1" }] })}>
                  <SelectTrigger className={styles.add}>
                    <SelectValue placeholder="+ Incluir material" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.code ? `${i.code} · ` : ""}
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className={styles.switchRow}>
                <Switch id="svc-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                <label htmlFor="svc-active">Ativo</label>
              </div>
            </div>
          )}
          <DialogFooter>
            {form?.id && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (form.id && window.confirm(`Excluir o serviço ${form.name}?`)) deleteService.mutate(form.id, { onSuccess: () => setForm(null) });
                }}
              >
                <Trash2 size={14} /> Excluir
              </Button>
            )}
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saveService.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
