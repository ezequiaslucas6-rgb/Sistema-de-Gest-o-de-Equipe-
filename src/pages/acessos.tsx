import { FormEvent, useState } from "react";
import { Helmet } from "react-helmet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Skeleton } from "../components/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { supabase } from "../helpers/supabase";
import { useProfile, type Role } from "../helpers/profile";
import { toast } from "../helpers/toast";
import { useAppData } from "../helpers/useAppData";
import styles from "./acessos.module.css";

type User = { email: string; name: string | null; role: Role; technician_id: number | null; created_at: string };

const ROLE_LABEL: Record<Role, string> = {
  supervisor: "Supervisor (acesso total)",
  almoxarifado: "Supervisor de almoxarifado (só estoque)",
  tecnico: "Técnico (app: conferência, material e caixa)",
};
const ROLES: Role[] = ["tecnico", "almoxarifado", "supervisor"];

const KEY = ["escala_usuarios"] as const;

/** Quem pode entrar no sistema e com qual perfil. */
export default function AccessPage() {
  const me = useProfile();
  const qc = useQueryClient();
  const { data: app } = useAppData();
  const [form, setForm] = useState({ email: "", name: "", role: "tecnico" as Role, technicianId: "", password: "" });
  const [pwdFor, setPwdFor] = useState<string | null>(null);
  const [pwd, setPwd] = useState("");

  /** Cria a conta (ou troca a senha) direto, sem e-mail de confirmação. */
  const setPassword = async (email: string, password: string) => {
    const { data, error } = await supabase.functions.invoke("escala-usuarios", { body: { email, password } });
    const msg = (data as { error?: string } | null)?.error;
    if (error || msg) {
      let detail = msg;
      if (!detail && error && "context" in error) detail = ((await (error as { context: Response }).context.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new Error(detail ?? error?.message ?? "Não foi possível definir a senha.");
    }
  };
  const techName = (id: number | null) => app?.technicians.find((t) => t.id === id)?.name ?? "—";

  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("escala_usuarios").select("email, name, role, technician_id, created_at").order("role").order("email");
      if (error) throw new Error(error.message);
      return data as User[];
    },
  });

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await fn();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (err: Error) => toast.error(/duplicate|unique/i.test(err.message) ? "Esse e-mail já está cadastrado." : err.message),
  });

  const add = (e: FormEvent) => {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    if (form.role === "tecnico" && !form.technicianId) {
      toast.error("Escolha qual técnico é este acesso.");
      return;
    }
    const technicianId = form.role === "tecnico" ? Number(form.technicianId) : null;
    const name = form.name.trim() || (technicianId ? techName(technicianId) : "") || null;
    if (form.password && form.password.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    run.mutate(() => supabase.from("escala_usuarios").insert({ email, name, role: form.role, technician_id: technicianId }), {
      onSuccess: async () => {
        if (form.password) {
          try {
            await setPassword(email, form.password);
            toast.success(`Acesso liberado para ${email}. Já pode entrar com a senha definida.`);
          } catch (err) {
            toast.error(`Acesso liberado, mas a senha não foi salva: ${err instanceof Error ? err.message : String(err)}`);
          }
          setForm({ email: "", name: "", role: "tecnico", technicianId: "", password: "" });
          return;
        }
        toast.success(`Acesso liberado para ${email}`);
        setForm({ email: "", name: "", role: "tecnico", technicianId: "", password: "" });
      },
    });
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Acessos — Escala Técnica</title>
      </Helmet>
      <PageHeader
        eyebrow="Administração"
        title="Acessos"
        description="E-mails liberados para entrar no sistema. O supervisor de almoxarifado vê só a conferência de estoque."
      />

      <form className={styles.addForm} onSubmit={add}>
        <div>
          <label className={styles.label}>E-mail</label>
          <Input type="email" value={form.email} placeholder="nome@nortetel.com.br" onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className={styles.label}>Nome</label>
          <Input value={form.name} placeholder="Nome completo" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={styles.label}>Perfil</label>
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {form.role === "tecnico" && (
          <div>
            <label className={styles.label}>Técnico</label>
            <Select value={form.technicianId} onValueChange={(v) => setForm({ ...form, technicianId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha" />
              </SelectTrigger>
              <SelectContent>
                {(app?.technicians ?? []).map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <label className={styles.label}>Senha inicial</label>
          <Input type="text" autoComplete="off" value={form.password} placeholder="mín. 6 caracteres" onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <Button type="submit" disabled={run.isPending}>
          <UserPlus size={15} /> Liberar acesso
        </Button>
      </form>
      <p className={styles.hint}>
        Sem confirmação por e-mail: defina a senha inicial aqui e entregue para a pessoa (ou ela usa <b>Primeiro acesso</b> e cria a própria). No
        celular, abra o site e use “Adicionar à tela inicial” para instalar o app.
      </p>

      {error && <p className={styles.error}>{error instanceof Error ? error.message : String(error)}</p>}
      {!data ? (
        <Skeleton className={styles.skel} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Nome</th>
                <th>Perfil</th>
                <th>Técnico</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => {
                const self = u.email === me.email.toLowerCase();
                return (
                  <tr key={u.email}>
                    <td>
                      {u.email} {self && <span className={styles.meta}>(você)</span>}
                    </td>
                    <td>
                      <Input
                        className={styles.inline}
                        defaultValue={u.name ?? ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const name = e.target.value.trim() || null;
                          if (name !== u.name) run.mutate(() => supabase.from("escala_usuarios").update({ name }).eq("email", u.email));
                        }}
                      />
                    </td>
                    <td>
                      <Select
                        value={u.role}
                        disabled={self}
                        onValueChange={(v) => run.mutate(() => supabase.from("escala_usuarios").update({ role: v }).eq("email", u.email))}
                      >
                        <SelectTrigger className={styles.inline}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td>
                      {u.role === "tecnico" ? (
                        <Select
                          value={u.technician_id ? String(u.technician_id) : ""}
                          onValueChange={(v) => run.mutate(() => supabase.from("escala_usuarios").update({ technician_id: Number(v) }).eq("email", u.email))}
                        >
                          <SelectTrigger className={styles.inline}>
                            <SelectValue placeholder="Escolha" />
                          </SelectTrigger>
                          <SelectContent>
                            {(app?.technicians ?? []).map((t) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={styles.meta}>—</span>
                      )}
                    </td>
                    <td className={styles.r}>
                      <Button size="sm" variant="ghost" onClick={() => (setPwdFor(u.email), setPwd(""))}>
                        <KeyRound size={14} /> Senha
                      </Button>
                      {!self && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Remover acesso"
                          aria-label={`Remover acesso de ${u.email}`}
                          onClick={() => {
                            if (window.confirm(`Remover o acesso de ${u.email}?`)) run.mutate(() => supabase.from("escala_usuarios").delete().eq("email", u.email));
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pwdFor && (
        <div className={styles.pwdBox} role="dialog" aria-label="Definir senha">
          <div>
            Nova senha para <b>{pwdFor}</b>
          </div>
          <Input type="text" autoComplete="off" value={pwd} placeholder="mín. 6 caracteres" onChange={(e) => setPwd(e.target.value)} autoFocus />
          <div className={styles.pwdActions}>
            <Button variant="outline" onClick={() => setPwdFor(null)}>
              Cancelar
            </Button>
            <Button
              disabled={pwd.length < 6 || run.isPending}
              onClick={async () => {
                try {
                  await setPassword(pwdFor, pwd);
                  toast.success(`Senha definida para ${pwdFor}`);
                  setPwdFor(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <KeyRound size={14} /> Salvar senha
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
