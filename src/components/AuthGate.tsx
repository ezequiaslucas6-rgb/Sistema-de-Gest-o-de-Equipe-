import { FormEvent, ReactNode, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, WifiOff } from "lucide-react";
import { supabase } from "../helpers/supabase";
import { subscribeCloudChanges } from "../helpers/cloud";
import { APP_DATA_QUERY_KEY } from "../helpers/useAppData";
import { ProfileContext, type Profile } from "../helpers/profile";
import { Button } from "./Button";
import { CloudImportDialog } from "./CloudImportDialog";
import styles from "./AuthGate.module.css";

type Access = "verificando" | "liberado" | "negado" | "offline";

/** Exige login no Supabase e e-mail cadastrado em escala_usuarios antes de mostrar o sistema. */
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>("verificando");
  const [profile, setProfile] = useState<Profile | null>(null);
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
    supabase.rpc("escala_my_profile").then(({ data, error }) => {
      if (error && /fetch|network/i.test(error.message)) return setAccess("offline");
      const p = data as { role?: string; name?: string | null; technicianId?: number | null } | null;
      if (error || !p || (p.role !== "supervisor" && p.role !== "almoxarifado" && p.role !== "tecnico")) return setAccess("negado");
      if (p.role === "tecnico" && !p.technicianId) return setAccess("negado");
      setProfile({ role: p.role, name: p.name ?? null, email: userEmail, technicianId: p.technicianId ?? null });
      setAccess("liberado");
    });
  }, [userEmail, retry]);

  // outro computador gravou: recarrega os dados na hora
  useEffect(() => {
    if (access !== "liberado" || profile?.role !== "supervisor") return;
    return subscribeCloudChanges(() => qc.invalidateQueries({ queryKey: APP_DATA_QUERY_KEY }));
  }, [access, profile?.role, qc]);

  if (session === undefined || (session && access === "verificando")) {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} aria-label="Carregando" />
      </div>
    );
  }
  if (!session) return <LoginForm />;
  if (access === "liberado" && !profile) return null;
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
    <ProfileContext.Provider value={profile!}>
      {children}
      {profile?.role === "supervisor" && <CloudImportDialog />}
    </ProfileContext.Provider>
  );
};

const LoginForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [firstAccess, setFirstAccess] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (firstAccess) {
      if (password.length < 6) return setError("A senha precisa ter pelo menos 6 caracteres.");
      if (password !== confirm) return setError("As senhas não conferem.");
      setLoading(true);
      const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password });
      setLoading(false);
      if (error) {
        return setError(
          /registered|exists/i.test(error.message)
            ? "Esse e-mail já tem senha. Use Entrar."
            : /rate limit|too many/i.test(error.message)
              ? "Muitas tentativas agora. Peça ao supervisor para definir sua senha em Acessos."
            : /fetch|network/i.test(error.message)
              ? "Sem conexão com a internet."
              : /disabled|not allowed/i.test(error.message)
                ? "Cadastro desativado. Peça ao supervisor para criar seu usuário."
                : error.message,
        );
      }
      if (!data.session) {
        if (data.user && data.user.identities?.length === 0) return setError("Esse e-mail já tem senha. Use Entrar.");
        // e-mail liberado no sistema não precisa de confirmação: já entra
        const login = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (login.error) {
          setFirstAccess(false);
          setInfo("Conta criada. Se não entrar, peça ao supervisor para liberar seu e-mail e definir a senha em Acessos.");
        }
      }
      return;
    }
    setLoading(true);
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
          <h2 className={styles.formTitle}>{firstAccess ? "Primeiro acesso" : "Entrar"}</h2>
          <p className={styles.formSub}>
            {firstAccess ? "Crie sua senha usando o e-mail liberado pelo supervisor." : "Use o e-mail e a senha definidos pelo supervisor."}
          </p>
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
            autoComplete={firstAccess ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {firstAccess && (
            <>
              <label className={styles.flabel} htmlFor="confirm">
                Repita a senha
              </label>
              <input
                id="confirm"
                className={styles.finput}
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </>
          )}
          {error && <p className={styles.ferror}>{error}</p>}
          {info && <p className={styles.finfo}>{info}</p>}
          <button type="submit" disabled={loading} className={styles.fsubmit}>
            {loading ? "Aguarde..." : firstAccess ? "Criar senha" : "Entrar"}
          </button>
          <button
            type="button"
            className={styles.fswitch}
            onClick={() => {
              setFirstAccess(!firstAccess);
              setError(null);
              setInfo(null);
            }}
          >
            {firstAccess ? "Já tenho senha — entrar" : "Primeiro acesso? Criar senha"}
          </button>
        </form>
      </main>
    </div>
  );
};
