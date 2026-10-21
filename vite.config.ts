import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// base "./" + HashRouter: o site funciona em qualquer caminho do GitHub Pages
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // as páginas vieram do Floot com <Helmet>; no React 19 o <title> já é levado para o <head>
      "react-helmet": fileURLToPath(new URL("./src/helpers/helmet.tsx", import.meta.url)),
    },
  },
});
