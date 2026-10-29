import { supabase } from "./supabase";

/** Chave pública VAPID (a privada fica só no Supabase, na função que envia os avisos). */
const VAPID_PUBLIC_KEY = "BIRwOIXcwsmUcTVK61JWvNThT-HhrGs8-KM-jp3W1LaeyuGj1bCyrW_qsYhjCk3EdlFyuZP4j97ZxAQs6KhPE9k";

export type PushState = "indisponivel" | "bloqueado" | "desligado" | "ligado" | "instalar";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** No site publicado (https) registra o service worker; no programa do Windows (file://) não há notificações. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return null;
  try {
    return await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (location.protocol !== "https:" || !("serviceWorker" in navigator)) return "indisponivel";
  // iPhone só recebe aviso com o app instalado na tela inicial
  if (!("PushManager" in window)) return isIos() && !standalone() ? "instalar" : "indisponivel";
  if (Notification.permission === "denied") return "bloqueado";
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "ligado" : "desligado";
}

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush(): Promise<PushState> {
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.getRegistration("./"));
  if (!reg) throw new Error("Este navegador não aceita notificações. Abra pelo Chrome no celular.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "bloqueado" : "desligado";
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("escala_push_subscriptions").upsert(
    {
      email: user.user?.email?.toLowerCase(),
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
  return "ligado";
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("escala_push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}
