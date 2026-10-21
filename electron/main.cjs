/**
 * Processo principal do app de desktop: abre a janela e guarda o banco SQLite no computador.
 * Banco: Documentos/Escala Técnica/escala-tecnica.sqlite (ou ESCALA_DB_PATH, se definido).
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { EscalaDb, createOperations } = require("./db.cjs");

let store;
let ops;
let mainWindow;

function dbPath() {
  return process.env.ESCALA_DB_PATH || path.join(app.getPath("documents"), "Escala Técnica", "escala-tecnica.sqlite");
}

async function openStore() {
  store = await EscalaDb.open(dbPath(), path.join(__dirname, "seed.json"));
  ops = createOperations(store);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Escala Técnica",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#f4f7f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // links externos abrem no navegador, nunca dentro do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

ipcMain.handle("escala:call", (_event, op, input) => {
  const fn = ops && ops[op];
  if (typeof fn !== "function") throw new Error(`Operação desconhecida: ${op}`);
  return fn(input ?? {});
});

ipcMain.handle("escala:info", () => ({ dbPath: dbPath(), version: app.getVersion() }));

ipcMain.handle("escala:backup", async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Salvar cópia do banco de dados",
    defaultPath: path.join(app.getPath("desktop"), `escala-tecnica-backup-${stamp}.sqlite`),
    filters: [{ name: "Banco SQLite", extensions: ["sqlite"] }],
  });
  if (canceled || !filePath) return { saved: false };
  store.persist();
  fs.copyFileSync(dbPath(), filePath);
  return { saved: true, filePath };
});

ipcMain.handle("escala:restore", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Restaurar banco de dados a partir de um backup",
    properties: ["openFile"],
    filters: [{ name: "Banco SQLite", extensions: ["sqlite", "db"] }],
  });
  if (canceled || filePaths.length === 0) return { restored: false };
  const header = fs.readFileSync(filePaths[0]).subarray(0, 16).toString("latin1");
  if (!header.startsWith("SQLite format 3")) throw new Error("O arquivo escolhido não é um banco SQLite.");
  // guarda uma cópia do banco atual antes de substituir
  const current = dbPath();
  if (fs.existsSync(current)) fs.copyFileSync(current, `${current}.antes-da-restauracao`);
  fs.copyFileSync(filePaths[0], current);
  await openStore();
  return { restored: true };
});

ipcMain.handle("escala:openFolder", () => {
  shell.showItemInFolder(dbPath());
  return { ok: true };
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await openStore();
    } catch (err) {
      dialog.showErrorBox("Escala Técnica", `Não foi possível abrir o banco de dados em\n${dbPath()}\n\n${err.message}`);
      app.quit();
      return;
    }
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
