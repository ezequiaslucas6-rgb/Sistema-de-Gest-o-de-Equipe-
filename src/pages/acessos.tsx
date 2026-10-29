import { FormEvent, useState } from "react";
import { Helmet } from "react-helmet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Skeleton } from "../components/Skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { supabase } from "../helpers/supabase";
import { useProfile, type Role } from "../helpers/profile";
import { toast } from "../helpers/toast";
import styles from "./acessos.module.css";

type User = { email: string; name: string | null; role: Role; created_at: string };

const ROLE_LABEL: Record<Role, string> = {
  supervisor: "Supervisor (acesso total)",
  almoxarifado: "Supervisor de almoxarifado (só estoque)",
};

const KEY = ["escala_usuarios"] as const;

/** Quem pode entrar no sistema e com qual perfil. */
export default function AccessPage() {
  const me = useProfile();
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: "", name: "", role: "almoxarifado" as Role });

  const { data, error } = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("escala_usuarios").select("email, name, role, created_at").order("role").order("email");
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
    run.mutate(() => supabase.from("escala_usuarios").insert({ email, name: form.name.trim() || null, role: form.role }), {
      onSuccess: () => {
        toast.success(`Acesso liberado para ${email}`);
        setForm({ email: "", name: "", role: "almoxarifado" });
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
              <SelectItem value="almoxarifado">{ROLE_LABEL.almoxarifado}</SelectItem>
              <SelectItem value="supervisor">{ROLE_LABEL.supervisor}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={run.isPending}>
          <UserPlus size={15} /> Liberar acesso
        </Button>
      </form>
      <p className={styles.hint}>
        Depois de liberado, a pessoa abre o sistema, clica em <b>Primeiro acesso</b> e cria a própria senha com esse e-mail.
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
                          <SelectItem value="almoxarifado">{ROLE_LABEL.almoxarifado}</SelectItem>
                          <SelectItem value="supervisor">{ROLE_LABEL.supervisor}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={styles.r}>
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
    </div>
  );
}
