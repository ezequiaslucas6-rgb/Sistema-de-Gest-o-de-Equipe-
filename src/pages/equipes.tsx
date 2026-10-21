import { useState } from "react";
import { Helmet } from "react-helmet";
import { Pencil, Plus, Trash2, Truck, UserPlus } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/Dialog";
import { useAppData } from "../helpers/useAppData";
import { useAppMutations } from "../helpers/useAppMutations";
import { labels } from "../helpers/labels";
import type { Sector } from "../helpers/schema";
import type { TeamDTO, TechnicianDTO } from "../endpoints/data_GET.schema";
import styles from "./equipes.module.css";

type TeamForm = { id?: number; name: string; code: string; sector: Sector; vehicle: string; notes: string };
type TechForm = { id?: number; name: string; phone: string; role: string; teamId: string };

export default function TeamsPage() {
  const { data, error } = useAppData();
  const { saveTeam, deleteTeam, saveTechnician, deleteTechnician } = useAppMutations();
  const [teamForm, setTeamForm] = useState<TeamForm | null>(null);
  const [techForm, setTechForm] = useState<TechForm | null>(null);

  const openTeam = (sector: Sector, team?: TeamDTO) =>
    setTeamForm(
      team
        ? { id: team.id, name: team.name, code: team.code, sector: team.sector, vehicle: team.vehicle ?? "", notes: team.notes ?? "" }
        : { name: "", code: "", sector, vehicle: "", notes: "" },
    );

  const openTech = (teamId: number | null, tech?: TechnicianDTO) =>
    setTechForm(
      tech
        ? { id: tech.id, name: tech.name, phone: tech.phone ?? "", role: tech.role ?? "", teamId: tech.teamId ? String(tech.teamId) : "__none" }
        : { name: "", phone: "", role: "", teamId: teamId ? String(teamId) : "__none" },
    );

  const submitTeam = () => {
    if (!teamForm) return;
    saveTeam.mutate(
      { ...teamForm, vehicle: teamForm.vehicle || null, notes: teamForm.notes || null },
      { onSuccess: () => setTeamForm(null) },
    );
  };

  const submitTech = () => {
    if (!techForm) return;
    saveTechnician.mutate(
      {
        id: techForm.id,
        name: techForm.name,
        phone: techForm.phone || null,
        role: techForm.role || null,
        teamId: techForm.teamId === "__none" ? null : Number(techForm.teamId),
      },
      { onSuccess: () => setTechForm(null) },
    );
  };

  const unassigned = data?.technicians.filter((t) => t.teamId === null) ?? [];

  if (error) return <div className={styles.error}>Erro ao carregar dados: {(error as Error).message}</div>;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Equipes · Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow={`${data?.technicians.length ?? "–"} técnicos · ${data?.teams.length ?? "–"} duplas`}
        title="Equipes e duplas"
        description="Cadastre os técnicos e monte as duplas de cada setor. Cada equipe trabalha em dupla (máximo 2 técnicos)."
        actions={
          <Button onClick={() => openTech(null)}>
            <UserPlus size={16} /> Novo técnico
          </Button>
        }
      />

      <div className={styles.sectors}>
        {labels.sectors.map((sector) => {
          const teams = data?.teams.filter((t) => t.sector === sector) ?? [];
          return (
            <section key={sector} className={`${styles.sector} ${sector === "infraestrutura" ? styles.infra : styles.support}`}>
              <div className={styles.sectorHead}>
                <h2 className={styles.h2}>{labels.sector[sector]}</h2>
                <Button variant="outline" size="sm" onClick={() => openTeam(sector)}>
                  <Plus size={14} /> Equipe
                </Button>
              </div>
              {!data && <Skeleton className={styles.skel} />}
              <div className={styles.teamGrid}>
                {teams.map((team) => {
                  const members = data!.technicians.filter((t) => t.teamId === team.id);
                  return (
                    <div key={team.id} className={styles.teamCard}>
                      <div className={styles.teamHead}>
                        <span className={styles.code}>{team.code}</span>
                        <span className={styles.teamName}>{team.name}</span>
                        <div className={styles.teamActions}>
                          <Button variant="ghost" size="icon-sm" onClick={() => openTeam(sector, team)} aria-label="Editar equipe">
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Excluir equipe"
                            onClick={() => {
                              if (window.confirm(`Excluir a equipe ${team.code}? Os técnicos ficarão sem equipe.`)) deleteTeam.mutate({ id: team.id });
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      {team.vehicle && (
                        <div className={styles.vehicle}>
                          <Truck size={13} /> {team.vehicle}
                        </div>
                      )}
                      <ul className={styles.members}>
                        {members.map((m) => (
                          <li key={m.id} className={styles.member}>
                            <div>
                              <div className={styles.memberName}>{m.name}</div>
                              <div className={styles.memberMeta}>{[m.role, m.phone].filter(Boolean).join(" · ") || "—"}</div>
                            </div>
                            <div className={styles.teamActions}>
                              <Button variant="ghost" size="icon-sm" onClick={() => openTech(team.id, m)} aria-label="Editar técnico">
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Excluir técnico"
                                onClick={() => {
                                  if (window.confirm(`Excluir ${m.name}? As ausências dele também serão apagadas.`)) deleteTechnician.mutate({ id: m.id });
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </li>
                        ))}
                        {members.length < 2 && (
                          <li>
                            <button className={styles.addMember} onClick={() => openTech(team.id)}>
                              <UserPlus size={14} /> {members.length === 0 ? "Adicionar técnicos" : "Completar dupla"}
                            </button>
                          </li>
                        )}
                      </ul>
                      {team.notes && <p className={styles.notes}>{team.notes}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <section className={styles.unassigned}>
          <h2 className={styles.h2}>Técnicos sem equipe</h2>
          <ul className={styles.members}>
            {unassigned.map((m) => (
              <li key={m.id} className={styles.member}>
                <div>
                  <div className={styles.memberName}>{m.name}</div>
                  <div className={styles.memberMeta}>{m.role ?? "—"}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openTech(null, m)}>
                  Alocar em equipe
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!teamForm} onOpenChange={(o) => !o && setTeamForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{teamForm?.id ? "Editar equipe" : "Nova equipe"}</DialogTitle>
          </DialogHeader>
          {teamForm && (
            <div className={styles.form}>
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Código</label>
                  <Input value={teamForm.code} maxLength={8} placeholder="S5" onChange={(e) => setTeamForm({ ...teamForm, code: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Setor</label>
                  <Select value={teamForm.sector} onValueChange={(v) => setTeamForm({ ...teamForm, sector: v as Sector })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {labels.sectors.map((s) => (
                        <SelectItem key={s} value={s}>
                          {labels.sector[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className={styles.label}>Nome</label>
              <Input value={teamForm.name} placeholder="Suporte 5" onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
              <label className={styles.label}>Veículo</label>
              <Input value={teamForm.vehicle} placeholder="Placa / modelo" onChange={(e) => setTeamForm({ ...teamForm, vehicle: e.target.value })} />
              <label className={styles.label}>Observações</label>
              <Textarea value={teamForm.notes} onChange={(e) => setTeamForm({ ...teamForm, notes: e.target.value })} />
              {!teamForm.id && (
                <p className={styles.hint}>Depois de criar, gere novamente a escala do setor em Planejamento para incluir a nova equipe.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTeamForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submitTeam} disabled={saveTeam.isPending || !teamForm?.name || !teamForm?.code}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!techForm} onOpenChange={(o) => !o && setTechForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{techForm?.id ? "Editar técnico" : "Novo técnico"}</DialogTitle>
          </DialogHeader>
          {techForm && (
            <div className={styles.form}>
              <label className={styles.label}>Nome</label>
              <Input value={techForm.name} onChange={(e) => setTechForm({ ...techForm, name: e.target.value })} />
              <div className={styles.row2}>
                <div>
                  <label className={styles.label}>Função</label>
                  <Input value={techForm.role} placeholder="Técnico de Rede" onChange={(e) => setTechForm({ ...techForm, role: e.target.value })} />
                </div>
                <div>
                  <label className={styles.label}>Telefone</label>
                  <Input value={techForm.phone} placeholder="(00) 00000-0000" onChange={(e) => setTechForm({ ...techForm, phone: e.target.value })} />
                </div>
              </div>
              <label className={styles.label}>Equipe (dupla)</label>
              <Select value={techForm.teamId} onValueChange={(v) => setTechForm({ ...techForm, teamId: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sem equipe</SelectItem>
                  {data?.teams.map((t) => {
                    const count = data.technicians.filter((x) => x.teamId === t.id && x.id !== techForm.id).length;
                    return (
                      <SelectItem key={t.id} value={String(t.id)} disabled={count >= 2}>
                        {t.code} · {t.name} ({labels.sectorShort[t.sector]}){count >= 2 ? " — completa" : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTechForm(null)}>
              Cancelar
            </Button>
            <Button onClick={submitTech} disabled={saveTechnician.isPending || !techForm?.name}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
