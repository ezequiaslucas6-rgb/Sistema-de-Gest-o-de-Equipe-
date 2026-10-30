import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { isNativeApp } from "../helpers/push";
import styles from "./UpdateBanner.module.css";

const SITE = "https://ezequiaslucas6-rgb.github.io/Sistema-de-Gest-o-de-Equipe-/";
const RELEASES = "https://github.com/ezequiaslucas6-rgb/Sistema-de-Gest-o-de-Equipe-/releases/latest";
const CHECK_EVERY = 30 * 60 * 1000;

const newer = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
};

/** Avisa quando há versão nova publicada: no site recarrega, no programa leva ao instalador novo. */
export const UpdateBanner = () => {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    const check = () =>
      fetch(`${SITE}version.json?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { version?: string } | null) => {
          if (d?.version && newer(d.version, __APP_VERSION__)) setLatest(d.version);
        })
        .catch(() => {});
    void check();
    const id = window.setInterval(check, CHECK_EVERY);
    return () => window.clearInterval(id);
  }, []);

  // no app Android quem cuida é a atualização automática (AppUpdateGate)
  if (!latest || isNativeApp()) return null;
  // programa do Windows e app Android: a versão nova vem pelo instalador / APK da página de versões
  const desktop = !!window.escala || isNativeApp();
  return (
    <div className={styles.banner} role="status">
      <span>
        Nova versão disponível (<b>{latest}</b>, você está na {__APP_VERSION__}).
      </span>
      {desktop ? (
        <a href={RELEASES} target="_blank" rel="noreferrer" className={styles.action}>
          <Download size={14} /> {isNativeApp() ? "Baixar o app novo (APK)" : "Baixar instalador novo"}
        </a>
      ) : (
        <button className={styles.action} onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> Atualizar agora
        </button>
      )}
    </div>
  );
};
