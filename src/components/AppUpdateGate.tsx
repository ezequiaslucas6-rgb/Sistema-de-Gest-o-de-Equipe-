import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { AppUpdater, type AvailableUpdate, findUpdate } from "../helpers/appUpdate";
import { isNativeApp } from "../helpers/push";
import { Button } from "./Button";
import styles from "./AppUpdateGate.module.css";

type Phase = "idle" | "downloading" | "ready" | "permission" | "error";
const CHECK_EVERY = 3 * 3600 * 1000;

/**
 * App Android: procura versão nova sozinho (ao abrir, ao voltar para o app e a cada 3 horas), baixa em segundo plano,
 * confere a assinatura e chama o instalador do Android. Versão obrigatória bloqueia o uso até instalar.
 */
export const AppUpdateGate = () => {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [later, setLater] = useState(false);
  const busy = useRef(false);
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (busy.current || Date.now() - lastCheck.current < 10 * 60 * 1000) return;
    busy.current = true;
    lastCheck.current = Date.now();
    try {
      const me = await AppUpdater.info();
      const found = await findUpdate(me.versionCode);
      if (!found) return;
      setUpdate(found);
      setPhase("downloading");
      setPercent(0);
      const sub = await AppUpdater.addListener("progress", (p) => setPercent(p.percent));
      try {
        await AppUpdater.download({ url: found.url });
        setPhase("ready");
      } finally {
        void sub.remove();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase((p) => (p === "downloading" ? "error" : p));
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    try {
      const r = await AppUpdater.install();
      setPhase(r.needsPermission ? "permission" : "ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    const t = window.setTimeout(() => void check(), 2500);
    const every = window.setInterval(() => void check(), CHECK_EVERY);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // voltou da tela "permitir instalar desta fonte": tenta instalar de novo
      if (phase === "permission") void install();
      else void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, install, phase]);

  if (!isNativeApp() || !update || phase === "idle") return null;
  const blocking = update.required;

  // atualização opcional baixando: só uma faixa discreta
  if (!blocking && (phase === "downloading" || later)) {
    if (phase !== "downloading") {
      return (
        <button className={styles.pill} onClick={() => setLater(false)}>
          <RefreshCw size={14} /> Atualização {update.versionName} pronta — instalar
        </button>
      );
    }
    return (
      <div className={styles.pill} role="status">
        <Download size={14} /> Baixando atualização {update.versionName}… {percent}%
      </div>
    );
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Atualização do app">
      <div className={styles.card}>
        <img src="./icon-192.png" alt="" className={styles.icon} />
        <h2>{blocking ? "Atualização obrigatória" : "Nova versão do app"}</h2>
        <p className={styles.version}>Escala Técnica {update.versionName}</p>
        {phase === "downloading" && (
          <>
            <div className={styles.bar}>
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className={styles.meta}>
              Baixando {percent}% de {update.sizeMb} MB…
            </p>
          </>
        )}
        {phase === "ready" && (
          <>
            <p className={styles.meta}>
              <ShieldCheck size={14} /> Baixada e conferida: assinatura da Nortetel. Toque em instalar e confirme na tela do Android.
            </p>
            <Button className={styles.main} onClick={() => void install()}>
              <Download size={16} /> Instalar agora
            </Button>
            {!blocking && (
              <Button variant="ghost" onClick={() => setLater(true)}>
                Depois
              </Button>
            )}
          </>
        )}
        {phase === "permission" && (
          <>
            <p className={styles.meta}>
              Na tela que abriu, ative <b>“Permitir desta fonte”</b> para a Escala Técnica e volte para o app. É pedido só uma vez.
            </p>
            <Button className={styles.main} onClick={() => void install()}>
              Já permiti — instalar
            </Button>
          </>
        )}
        {phase === "error" && (
          <>
            <p className={styles.err}>{error}</p>
            <Button
              className={styles.main}
              onClick={() => {
                lastCheck.current = 0;
                setPhase("idle");
                void check();
              }}
            >
              <RefreshCw size={16} /> Tentar de novo
            </Button>
            {!blocking && (
              <Button variant="ghost" onClick={() => (setPhase("idle"), setUpdate(null))}>
                Fechar
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
