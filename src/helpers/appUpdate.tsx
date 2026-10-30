import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** Plugin nativo do APK (android/app/.../AppUpdaterPlugin.java). */
interface AppUpdaterPlugin {
  info(): Promise<{ versionCode: number; versionName: string; canInstall: boolean; certSha256: string }>;
  download(o: { url: string }): Promise<{ path: string; versionCode: number; versionName: string }>;
  install(): Promise<{ needsPermission: boolean }>;
  addListener(event: "progress", fn: (p: { percent: number }) => void): Promise<PluginListenerHandle>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

const REPO = "ezequiaslucas6-rgb/Sistema-de-Gest-o-de-Equipe-";
const SITE = "https://ezequiaslucas6-rgb.github.io/Sistema-de-Gest-o-de-Equipe-/";

export interface AvailableUpdate {
  build: number;
  versionName: string;
  url: string;
  sizeMb: number;
  /** abaixo do mínimo exigido: o app fica bloqueado até atualizar */
  required: boolean;
  notes: string;
}

/** Procura APK mais novo que o instalado (o número do build é o mesmo do tag v1.0.N da versão publicada). */
export async function findUpdate(currentBuild: number): Promise<AvailableUpdate | null> {
  const [rel, policy] = await Promise.all([
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" }).then((r) =>
      r.ok ? r.json() : null,
    ),
    fetch(`${SITE}version.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<{ androidMinBuild?: number } | null>,
  ]);
  if (!rel) return null;
  const build = Number(/v\d+\.\d+\.(\d+)/.exec(String(rel.tag_name))?.[1] ?? 0);
  const apk = (rel.assets as { name: string; browser_download_url: string; size: number }[] | undefined)?.find((a) =>
    /^Escala-Tecnica-Android-.*\.apk$/.test(a.name),
  );
  if (!apk || !(build > currentBuild)) return null;
  return {
    build,
    versionName: /Android-(.+)\.apk$/.exec(apk.name)?.[1] ?? String(build),
    url: apk.browser_download_url,
    sizeMb: Math.round((apk.size / 1048576) * 10) / 10,
    required: currentBuild < Number(policy?.androidMinBuild ?? 0),
    notes: String(rel.body ?? ""),
  };
}
