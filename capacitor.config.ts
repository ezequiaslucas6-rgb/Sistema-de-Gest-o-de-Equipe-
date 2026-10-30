import type { CapacitorConfig } from "@capacitor/cli";

// App Android: o mesmo sistema (dist/) empacotado num APK assinado; dados no Supabase e avisos pelo Firebase
const config: CapacitorConfig = {
  appId: "br.com.nortetel.escalatecnica",
  appName: "Escala Técnica",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
