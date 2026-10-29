import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileUp, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./Dialog";
import { Button } from "./Button";
import { Switch } from "./Switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { toast } from "../helpers/toast";
import { type ImportMapping, type StockData, type StockSector, useStockMutations } from "../helpers/stock";
import {
  type Field,
  type SheetTable,
  FIELD_LABEL,
  downloadSpreadsheet,
  guessMapping,
  matchItem,
  matchTechnician,
  norm,
  parseNumber,
  readSpreadsheet,
} from "../helpers/stockImport";
import styles from "./StockImportDialog.module.css";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: StockData;
}

const NONE = "__none";
const FIELDS: Field[] = ["technician", "code", "name", "qty", "unit", "category", "min", "max"];

type ParsedRow = { group: string; code: string; name: string; unit: string; category: string; qty: number; min: number | null; max: number | null };

/** Importa o saldo de cada colaborador a partir da planilha do outro sistema (CSV ou Excel). */
export const StockImportDialog = ({ open, onOpenChange, data }: Props) => {
  const { importBalances } = useStockMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [tables, setTables] = useState<SheetTable[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [techOverride, setTechOverride] = useState<Record<string, string>>({});
  const [fixedTech, setFixedTech] = useState(NONE);
  const [createItems, setCreateItems] = useState(true);
  const [replace, setReplace] = useState(true);
  const [reading, setReading] = useState(false);

  const lastMapping = data.imports.find((i) => i.mapping)?.mapping ?? null;
  // "Almoxarifado 373" → técnico, aprendido nas importações anteriores (a mais recente vale)
  const knownOwners = useMemo(() => {
    const m: Record<string, number> = {};
    for (const imp of [...data.imports].reverse()) Object.assign(m, imp.mapping?.owners ?? {});
    return m;
  }, [data.imports]);
  const headers = tables[0]?.headers ?? [];

  const reset = () => {
    setFileName("");
    setTables([]);
    setMapping({});
    setTechOverride({});
    setFixedTech(NONE);
    if (fileRef.current) fileRef.current.value = "";
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      const t = await readSpreadsheet(file);
      if (!t.length) throw new Error("Não encontrei nenhuma tabela com dados no arquivo.");
      setFileName(file.name);
      setTables(t);
      setMapping(guessMapping(t[0].headers, lastMapping));
      setTechOverride({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  };

  // linhas do arquivo já no formato do sistema
  const parsed = useMemo(() => {
    const out: ParsedRow[] = [];
    for (const t of tables) {
      // outras abas com cabeçalhos diferentes: adivinha a partir do que foi escolhido na primeira
      const m = t === tables[0] ? mapping : guessMapping(t.headers, mapping);
      const col = (f: Field) => (m[f] ? t.headers.indexOf(m[f]!) : -1);
      const ci = {
        technician: col("technician"),
        code: col("code"),
        name: col("name"),
        qty: col("qty"),
        unit: col("unit"),
        category: col("category"),
        min: col("min"),
        max: col("max"),
      };
      for (const r of t.rows) {
        const code = ci.code >= 0 ? r[ci.code].trim() : "";
        const name = ci.name >= 0 ? r[ci.name].trim() : "";
        if (!code && !name) continue;
        if (/^TOTA(L|IS)\b/.test(norm(name || code))) continue;
        const group = ci.technician >= 0 ? r[ci.technician].trim() : (t.owner ?? (tables.length > 1 ? t.sheet : ""));
        out.push({
          group,
          code,
          name: name || code,
          unit: ci.unit >= 0 ? r[ci.unit].trim() : "",
          category: ci.category >= 0 ? r[ci.category].trim() : "",
          qty: ci.qty >= 0 ? (parseNumber(r[ci.qty]) ?? 0) : 0,
          min: ci.min >= 0 ? parseNumber(r[ci.min]) : null,
          max: ci.max >= 0 ? parseNumber(r[ci.max]) : null,
        });
      }
    }
    return out;
  }, [tables, mapping]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; items: Set<string>; auto: number | null }>();
    for (const r of parsed) {
      const known = knownOwners[r.group];
      const auto = r.group ? (matchTechnician(r.group, data.technicians)?.id ?? (known && data.technicians.some((t) => t.id === known) ? known : null)) : null;
      const g = map.get(r.group) ?? { key: r.group, items: new Set<string>(), auto };
      g.items.add(norm(r.code) || norm(r.name));
      map.set(r.group, g);
    }
    return [...map.values()].map((g) => ({ key: g.key, rows: g.items.size, auto: g.auto }));
  }, [parsed, data.technicians, knownOwners]);

  const techOf = (group: string): number | null => {
    const o = techOverride[group];
    if (o) return o === NONE ? null : Number(o);
    if (!group) return fixedTech === NONE ? null : Number(fixedTech);
    return groups.find((g) => g.key === group)?.auto ?? null;
  };

  const sectorOfTech = (techId: number): StockSector => {
    const team = data.teams.find((t) => t.id === data.technicians.find((x) => x.id === techId)?.teamId);
    return team?.sector ?? "ambos";
  };

  const plan = useMemo(() => {
    const newItems = new Map<
      string,
      { key: string; code: string | null; name: string; unit: string; category: string | null; sectors: Set<StockSector>; minQty: number; maxQty: number | null }
    >();
    const limits = new Map<number, { itemId: number; minQty: number | null; maxQty: number | null }>();
    const rows: { technicianId: number; itemId?: number; newItemKey?: string; qty: number }[] = [];
    let noTech = 0;
    let noItem = 0;
    for (const r of parsed) {
      const technicianId = techOf(r.group);
      if (technicianId == null) {
        noTech++;
        continue;
      }
      const item = matchItem(r.code, r.name, data.items);
      if (item) {
        rows.push({ technicianId, itemId: item.id, qty: r.qty });
        if ((r.min != null || r.max != null) && !limits.has(item.id)) limits.set(item.id, { itemId: item.id, minQty: r.min, maxQty: r.max });
        continue;
      }
      if (!createItems) {
        noItem++;
        continue;
      }
      const key = norm(r.code) || norm(r.name);
      const ni = newItems.get(key) ?? {
        key,
        code: r.code || null,
        name: r.name,
        unit: r.unit || "un",
        category: r.category || null,
        sectors: new Set<StockSector>(),
        minQty: r.min ?? 0,
        maxQty: r.max,
      };
      ni.sectors.add(sectorOfTech(technicianId));
      newItems.set(key, ni);
      rows.push({ technicianId, newItemKey: key, qty: r.qty });
    }
    return {
      rows,
      noTech,
      noItem,
      limits: [...limits.values()],
      newItems: [...newItems.values()].map(({ sectors, ...n }) => ({ ...n, sector: (sectors.size === 1 ? [...sectors][0] : "ambos") as StockSector })),
      techs: new Set(rows.map((r) => r.technicianId)).size,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, techOverride, fixedTech, createItems, groups, data]);

  const missingCols = (["qty"] as Field[]).filter((f) => !mapping[f]).concat(!mapping.code && !mapping.name ? (["name"] as Field[]) : []);

  const submit = () => {
    const owners: Record<string, number> = { ...knownOwners };
    for (const g of groups) {
      const tech = techOf(g.key);
      if (g.key && tech != null) owners[g.key] = tech;
    }
    importBalances.mutate(
      { fileName, mapping: { ...mapping, owners }, newItems: plan.newItems, itemLimits: plan.limits, rows: plan.rows, replace },
      {
        onSuccess: (r) => {
          toast.success(`Estoque importado: ${r.technicians} colaborador(es), ${r.rows} saldo(s)${r.created ? `, ${r.created} item(ns) novo(s)` : ""}.`);
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  const template = () =>
    downloadSpreadsheet(
      "modelo-estoque-colaboradores",
      data.technicians.slice(0, 3).flatMap((t) =>
        data.items
          .filter((i) => i.active)
          .slice(0, 4)
          .map((i) => ({ technician: t.name, code: i.code ?? "", name: i.name, unit: i.unit, qty: 0, min: i.minQty || null, max: i.maxQty })),
      ),
      lastMapping,
      "xlsx",
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Importar estoque dos colaboradores</DialogTitle>
          <DialogDescription>
            Relatório do outro sistema em PDF (Relatório de Produtos do almoxarifado do colaborador) ou planilha .xlsx/.csv com o saldo. O
            almoxarifado de cada colaborador fica gravado: na próxima importação ele é reconhecido sozinho.
          </DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.txt,.pdf" hidden onChange={(e) => void pick(e.target.files?.[0])} />

        <div className={styles.body}>
          {!tables.length ? (
            <div className={styles.drop}>
              <FileSpreadsheet size={36} />
              <Button onClick={() => fileRef.current?.click()} disabled={reading}>
                <FileUp size={16} /> {reading ? "Lendo arquivo…" : "Escolher arquivo"}
              </Button>
              <button type="button" className={styles.linkBtn} onClick={() => void template()}>
                Baixar planilha modelo
              </button>
            </div>
          ) : (
            <>
              <div className={styles.fileRow}>
                <span>
                  <b>{fileName}</b> · {tables.length > 1 ? `${tables.length} abas · ` : ""}
                  {tables.reduce((s, t) => s + t.rows.length, 0)} linhas
                </span>
                <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                  Trocar arquivo
                </Button>
              </div>

              <div className={styles.micro}>Colunas do arquivo</div>
              <div className={styles.mapGrid}>
                {FIELDS.map((f) => (
                  <div key={f}>
                    <label className={styles.label}>{FIELD_LABEL[f]}</label>
                    <Select value={mapping[f] ?? NONE} onValueChange={(v) => setMapping({ ...mapping, [f]: v === NONE ? undefined : v })}>
                      <SelectTrigger className={mapping[f] ? "" : styles.unmapped}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— não tem —</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {missingCols.length > 0 && <p className={styles.warn}>Escolha a coluna de {missingCols.map((f) => FIELD_LABEL[f].toLowerCase()).join(" e ")}.</p>}

              <div className={styles.micro}>Colaboradores</div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>No arquivo</th>
                      <th>No sistema</th>
                      <th className={styles.r}>Itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const tech = techOf(g.key);
                      return (
                        <tr key={g.key || "_"} className={tech == null ? styles.rowWarn : ""}>
                          <td>{g.key || <i>sem coluna de colaborador</i>}</td>
                          <td>
                            <Select
                              value={tech == null ? NONE : String(tech)}
                              onValueChange={(v) => (g.key ? setTechOverride({ ...techOverride, [g.key]: v }) : setFixedTech(v))}
                            >
                              <SelectTrigger className={styles.techSelect}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>— ignorar —</SelectItem>
                                {data.technicians.map((t) => (
                                  <SelectItem key={t.id} value={String(t.id)}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className={styles.r}>{g.rows}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={styles.options}>
                <div className={styles.switchRow}>
                  <Switch id="imp-create" checked={createItems} onCheckedChange={setCreateItems} />
                  <label htmlFor="imp-create">Cadastrar automaticamente os itens que ainda não existem</label>
                </div>
                <div className={styles.switchRow}>
                  <Switch id="imp-replace" checked={replace} onCheckedChange={setReplace} />
                  <label htmlFor="imp-replace">Substituir o saldo: itens do colaborador que não estão no arquivo ficam zerados</label>
                </div>
              </div>

              <div className={styles.summary}>
                <span>
                  <b>{plan.rows.length}</b> saldo(s) para <b>{plan.techs}</b> colaborador(es)
                </span>
                {plan.newItems.length > 0 && (
                  <span>
                    <b>{plan.newItems.length}</b> item(ns) novo(s)
                  </span>
                )}
                {plan.limits.length > 0 && <span>mín./máx. de {plan.limits.length} item(ns)</span>}
                {plan.noTech > 0 && <span className={styles.warnText}>{plan.noTech} linha(s) sem colaborador (ignoradas)</span>}
                {plan.noItem > 0 && <span className={styles.warnText}>{plan.noItem} linha(s) com item não cadastrado (ignoradas)</span>}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!plan.rows.length || missingCols.length > 0 || importBalances.isPending}>
            <Upload size={15} /> {importBalances.isPending ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
