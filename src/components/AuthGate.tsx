import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, WifiOff } from "lucide-react";
import { supabase } from "../helpers/supabase";
import { subscribeCloudChanges } from "../helpers/cloud";
import { APP_DATA_QUERY_KEY } from "../helpers/useAppData";
import { Button } from "./Button";
import { CloudImportDialog } from "./CloudImportDialog";
import styles from "./AuthGate.module.css";

type Access = "verificando" | "liberado" | "negado" | "offline";

/** Exige login no Supabase e e-mail cadastrado em escala_usuarios antes de mostrar o sistema. */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>("verificando");
  const [retry, setRetry] = useState(0);

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
    supabase.rpc("escala_is_member").then(({ data, error }) => {
      if (error && /fetch|network/i.test(error.message)) setAccess("offline");
      else setAccess(!error && data === true ? "liberado" : "negado");
    });
  }, [userEmail, retry]);

  // outro computador gravou: recarrega os dados na hora
  useEffect(() => {
    if (access !== "liberado") return;
    return subscribeCloudChanges(() => qc.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }));
  }, [access, qc]);

  if (session === undefined || (session && access === "verificando")) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} aria-label="Carregando" />
      </div>
    );
  }
  if (!session) return <LoginForm />;
  if (access === "offline") {
    return (
      <div className={styles.center}>
        <div className={styles.card}>
          <WifiOff className={styles.alertIcon} />
          <h1 className={styles.title}>Sem conexão</h1>
          <p className={styles.text}>O sistema guarda os dados na nuvem (Supabase) e precisa de internet. Verifique a conexão e tente de novo.</p>
          <Button onClick={() => setRetry((n) => n + 1)}>Tentar de novo</Button>
        </div>
      </div>
    );
  }
  if (access === "negado") {
    return (
      <div className={styles.center}>
        <div className={styles.card}>
          <ShieldAlert className={styles.alertIcon} />
          <h1 className={styles.title}>Sem acesso</h1>
          <p className={styles.text}>
            O usuário <b>{session.user.email}</b> entrou, mas não está liberado no sistema de escalas. Peça ao supervisor para incluir este e-mail.
          </p>
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>
            Sair
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      <CloudImportDialog />
    </>
  );
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
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : /fetch|network/i.test(error.message)
            ? "Sem conexão com a internet."
            : error.message,
      );
    }
  };

  return (
    <div className={styles.split}>
      <aside className={styles.hero} aria-hidden>
        <svg className={styles.waves} viewBox="0 0 870 943" preserveAspectRatio="none">
          <path d="M370 0 C 470 120, 520 200, 640 260 S 820 360, 870 378" />
          <path d="M0 122 C 160 110, 260 220, 420 300 S 700 420, 870 528" />
          <path d="M0 188 C 150 180, 260 270, 400 360 S 690 500, 870 610" />
        </svg>
        <div className={styles.rings}>
          <span />
          <span />
          <span />
        </div>
        <img src="./logo-mark.png" alt="" className={styles.watermark} />
        <div className={styles.heroContent}>
          <div className={styles.heroBrand}>
            <span className={styles.heroBadge}>
              <img src="./logo-mark.png" alt="" />
            </span>
            <span>Nortetel</span>
          </div>
          <h1 className={styles.heroTitle}>Sua equipe, em escala.</h1>
        </div>
        <div className={styles.heroFoot}>Escala Técnica · Suporte e Backbone</div>
      </aside>

      <main className={styles.panel}>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.mobileBrand}>
            <img src="./logo.png" alt="" /> Nortetel · Escala Técnica
          </div>
          <h2 className={styles.formTitle}>Entrar</h2>
          <p className={styles.formSub}>Use o e-mail e a senha cadastrados pelo administrador.</p>
          <label className={styles.flabel} htmlFor="email">
            E-mail
          </label>
          <input id="email" className={styles.finput} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className={styles.flabel} htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            className={styles.finput}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className={styles.ferror}>{error}</p>}
          <button type="submit" disabled={loading} className={styles.fsubmit}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </main>
    </div>
  );
};
