import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

/** Chave pública VAPID (a privada fica só no Supabase, na função que envia os avisos). */
const VAPID_PUBLIC_KEY = "BIRwOIXcwsmUcTVK61JWvNThT-HhrGs8-KM-jp3W1LaeyuGj1bCyrW_qsYhjCk3EdlFyuZP4j97ZxAQs6KhPE9k";
/** Token do Firebase deste aparelho (app Android), para saber se os avisos estão ligados. */
const FCM_TOKEN_KEY = "escala-fcm-token";

export type PushState = "indisponivel" | "bloqueado" | "desligado" | "ligado" | "instalar";

/** Rodando dentro do app Android (APK). */
export const isNativeApp = () => Capacitor.isNativePlatform();
/** O APK só tem o Firebase quando foi gerado com o google-services.json (segredo do GitHub). */
const fcmBuilt = import.meta.env.VITE_FCM === "1";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const readToken = () => {
  try {
    return localStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(FCM_TOKEN_KEY, t);
    else localStorage.removeItem(FCM_TOKEN_KEY);
  } catch {
    // sem armazenamento: só não lembra o estado
  }
};

async function saveSubscription(row: { endpoint: string; kind: "webpush" | "fcm"; p256dh?: string; auth?: string }) {
  const { data: user } = await supabase.auth.getUser();
  const email = user.user?.email?.toLowerCase();
  if (!email) throw new Error("Entre no sistema antes de ativar os avisos.");
  const { error } = await supabase.from("escala_push_subscriptions").upsert(
    { email, endpoint: row.endpoint, kind: row.kind, p256dh: row.p256dh ?? "", auth: row.auth ?? "", user_agent: navigator.userAgent.slice(0, 200) },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

// ---------- site / app instalado pelo navegador (Web Push) ----------

/** No site publicado (https) registra o service worker; no programa do Windows (file://) e no APK não. */
export async function registerServiceWorker() {
  if (isNativeApp() || !("serviceWorker" in navigator) || location.protocol !== "https:") return null;
  try {
    return await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch {
    return null;
  }
}

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// ---------- app Android (Firebase Cloud Messaging) ----------

let nativeReady: Promise<void> | null = null;

/** Canal de alta prioridade, toque ao chegar aviso com o app aberto e abertura na tela certa ao tocar. */
function setupNative(onForeground?: (title: string, body: string) => void) {
  if (nativeReady) return nativeReady;
  nativeReady = (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.createChannel({
      id: "escala_alertas",
      name: "Avisos da escala",
      description: "Plantão, conferência de estoque, material e caixa",
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch(() => {});
    await PushNotifications.addListener("pushNotificationReceived", (n) => onForeground?.(n.title ?? "Escala Técnica", n.body ?? ""));
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const url = (a.notification.data as { url?: string } | undefined)?.url;
      const hash = url?.split("#")[1];
      if (hash) window.location.hash = hash;
    });
  })();
  return nativeReady;
}

async function registerNative(): Promise<string> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const token = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("O Firebase não respondeu. Verifique a internet e tente de novo.")), 20000);
    void PushNotifications.addListener("registration", (t) => {
      window.clearTimeout(timer);
      resolve(t.value);
    });
    void PushNotifications.addListener("registrationError", (e) => {
      window.clearTimeout(timer);
      reject(new Error(`Firebase: ${e.error}`));
    });
  });
  await PushNotifications.register();
  const value = await token;
  await saveSubscription({ endpoint: value, kind: "fcm" });
  writeToken(value);
  return value;
}

/** No app Android: depois do login, renova o token do aparelho se os avisos já estavam ligados. */
export async function startNativePush(onForeground?: (title: string, body: string) => void) {
  if (!isNativeApp() || !fcmBuilt) return;
  await setupNative(onForeground);
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "granted" && readToken()) await registerNative().catch(() => {});
}

// ---------- comum ----------

export async function pushState(): Promise<PushState> {
  if (isNativeApp()) {
    if (!fcmBuilt) return "indisponivel";
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === "denied") return "bloqueado";
    return perm.receive === "granted" && readToken() ? "ligado" : "desligado";
  }
  if (location.protocol !== "https:" || !("serviceWorker" in navigator)) return "indisponivel";
  // iPhone só recebe aviso com o app instalado na tela inicial
  if (!("PushManager" in window)) return isIos() && !standalone() ? "instalar" : "indisponivel";
  if (Notification.permission === "denied") return "bloqueado";
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "ligado" : "desligado";
}

export async function enablePush(): Promise<PushState> {
  if (isNativeApp()) {
    if (!fcmBuilt) throw new Error("Este APK foi gerado sem o Firebase. Instale a versão nova do app.");
    await setupNative();
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return perm.receive === "denied" ? "bloqueado" : "desligado";
    await registerNative();
    return "ligado";
  }
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.getRegistration("./"));
  if (!reg) throw new Error("Este navegador não aceita notificações. Abra pelo Chrome no celular.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "bloqueado" : "desligado";
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await saveSubscription({ endpoint: json.endpoint, kind: "webpush", p256dh: json.keys.p256dh, auth: json.keys.auth });
  return "ligado";
}

export async function disablePush() {
  if (isNativeApp()) {
    const token = readToken();
    if (token) await supabase.from("escala_push_subscriptions").delete().eq("endpoint", token);
    writeToken(null);
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister().catch(() => {});
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration("./");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("escala_push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}
