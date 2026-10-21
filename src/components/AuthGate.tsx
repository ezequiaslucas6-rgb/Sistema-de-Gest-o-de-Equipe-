import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, RadioTower, ShieldAlert } from "lucide-react";
import { supabase } from "../helpers/supabase";
import { Button } from "./Button";
import { Input } from "./Input";
import styles from "./AuthGate.module.css";

type Access = "verificando" | "liberado" | "negado";

/** Exige login no Supabase e e-mail cadastrado em escala_usuarios antes de mostrar o sistema. */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>("verificando");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) qc.removeQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const userEmail = session?.user.email ?? null;
  useEffect(() => {
    if (!userEmail) return;
    setAccess("verificando");
    supabase.rpc("escala_is_member").then(({ data, error }) => setAccess(!error && data === true ? "liberado" : "negado"));
  }, [userEmail]);

  if (session === undefined || (session && access === "verificando")) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} aria-label="Carregando" />
      </div>
    );
  }
  if (!session) return <LoginForm />;
  if (access === "negado") {
    return (
      <div className={styles.center}>
        <div className={styles.card}>
          <ShieldAlert className={styles.alertIcon} />
          <h1 className={styles.title}>Sem acesso</h1>
          <p className={styles.text}>
            O usuário <b>{session.user.email}</b> entrou, mas não está liberado no sistema de escalas. Peça ao supervisor para
            incluir este e-mail.
          </p>
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};

const LoginForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
  };

  return (
    <div className={styles.center}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.brand}>
          <RadioTower className={styles.brandIcon} />
          <div>
            <div className={styles.title}>Escala Técnica</div>
            <div className={styles.sub}>Suporte · Backbone</div>
          </div>
        </div>
        <label className={styles.label} htmlFor="email">
          E-mail
        </label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className={styles.label} htmlFor="password">
          Senha
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
        <Button type="submit" disabled={loading} className={styles.submit}>
          <LogIn size={16} /> {loading ? "Entrando..." : "Entrar"}
        </Button>
        <p className={styles.hint}>Use o mesmo e-mail e senha do sistema da frota (Supabase).</p>
      </form>
    </div>
  );
};
