// Ponte segura entre a janela (React) e o processo principal (banco SQLite).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("escala", {
  call: (op, input) => ipcRenderer.invoke("escala:call", op, input),
  info: () => ipcRenderer.invoke("escala:info"),
  backup: () => ipcRenderer.invoke("escala:backup"),
  restore: () => ipcRenderer.invoke("escala:restore"),
  openFolder: () => ipcRenderer.invoke("escala:openFolder"),
});
