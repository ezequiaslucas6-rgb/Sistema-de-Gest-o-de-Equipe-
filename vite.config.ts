import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string; escala?: { androidMinBuild?: number } };
const { version } = pkg;
// app Android com build menor que este fica bloqueado até instalar a atualização
const androidMinBuild = pkg.escala?.androidMinBuild ?? 0;

// base "./" + HashRouter: o site funciona em qualquer caminho do GitHub Pages
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    // version.json publicado junto com o site: o programa e as abas abertas comparam com a própria versão
    {
      name: "version-json",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version, androidMinBuild }) });
      },
    },
  ],
  resolve: {
    alias: {
      // as páginas vieram do Floot com <Helmet>; no React 19 o <title> já é levado para o <head>
      "react-helmet": fileURLToPath(new URL("./src/helpers/helmet.tsx", import.meta.url)),
    },
  },
});
