package br.com.nortetel.escalatecnica;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * Atualização do app sem loja: baixa o APK novo, confere se é do mesmo pacote, de versão maior e assinado com a
 * mesma chave do app instalado, e abre o instalador do Android (que sempre pede um toque de confirmação).
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String UPDATE_FILE = "updates/escala-tecnica.apk";

    private PackageInfo selfInfo() throws PackageManager.NameNotFoundException {
        Context ctx = getContext();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), flags);
    }

    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private static String[] digests(PackageInfo info) throws Exception {
        Signature[] sigs;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo == null) return new String[0];
            sigs = info.signingInfo.hasMultipleSigners() ? info.signingInfo.getApkContentsSigners() : info.signingInfo.getSigningCertificateHistory();
        } else {
            sigs = info.signatures;
        }
        if (sigs == null) return new String[0];
        String[] out = new String[sigs.length];
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        for (int i = 0; i < sigs.length; i++) {
            byte[] d = md.digest(sigs[i].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (int j = 0; j < d.length; j++) {
                if (j > 0) sb.append(':');
                sb.append(String.format("%02X", d[j]));
            }
            out[i] = sb.toString();
        }
        Arrays.sort(out);
        return out;
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo self = selfInfo();
            JSObject ret = new JSObject();
            ret.put("versionCode", versionCodeOf(self));
            ret.put("versionName", self.versionName);
            ret.put("canInstall", canInstall());
            String[] d = digests(self);
            ret.put("certSha256", d.length > 0 ? d[0] : "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Não foi possível ler a versão do app: " + e.getMessage());
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Endereço de atualização inválido.");
            return;
        }
        getBridge().execute(() -> {
            File file = new File(getContext().getCacheDir(), UPDATE_FILE);
            HttpURLConnection conn = null;
            try {
                File dir = file.getParentFile();
                if (dir != null && !dir.exists() && !dir.mkdirs()) throw new Exception("sem espaço para a atualização");
                // segue redirecionamentos https (o arquivo fica no armazenamento do GitHub)
                URL current = new URL(url);
                for (int hop = 0; hop < 6; hop++) {
                    conn = (HttpURLConnection) current.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("Accept", "application/octet-stream");
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (loc == null) throw new Exception("redirecionamento sem destino");
                        current = new URL(current, loc);
                        if (!"https".equals(current.getProtocol())) throw new Exception("atualização fora de https");
                        continue;
                    }
                    if (code != 200) throw new Exception("servidor respondeu " + code);
                    break;
                }
                long total = conn.getContentLengthLong();
                long done = 0;
                int lastPct = -1;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) (done * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject p = new JSObject();
                                p.put("percent", pct);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                }

                // conferências de segurança antes de oferecer a instalação
                PackageManager pm = getContext().getPackageManager();
                int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
                PackageInfo apk = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
                if (apk == null) throw new Exception("arquivo baixado não é um APK válido");
                PackageInfo self = selfInfo();
                if (!getContext().getPackageName().equals(apk.packageName)) throw new Exception("o APK é de outro aplicativo");
                if (versionCodeOf(apk) <= versionCodeOf(self)) throw new Exception("o APK não é mais novo que o instalado");
                if (!Arrays.equals(digests(apk), digests(self))) throw new Exception("assinatura diferente da Nortetel — atualização recusada");

                JSObject ret = new JSObject();
                ret.put("path", file.getAbsolutePath());
                ret.put("versionCode", versionCodeOf(apk));
                ret.put("versionName", apk.versionName);
                call.resolve(ret);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
                call.reject("Falha ao baixar a atualização: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        File file = new File(getContext().getCacheDir(), UPDATE_FILE);
        if (!file.exists()) {
            call.reject("Atualização ainda não baixada.");
            return;
        }
        if (!canInstall()) {
            // Android 8+: o usuário libera uma vez "instalar apps desta fonte" para a Escala Técnica
            Intent perm = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            perm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(perm);
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        JSObject ret = new JSObject();
        ret.put("needsPermission", false);
        call.resolve(ret);
    }
}
