/** Ponte com o processo principal do app de desktop (definida em electron/preload.cjs). */
export interface EscalaBridge {
  call: (op: string, input?: unknown) => Promise<unknown>;
  info: () => Promise<{ dbPath: string; version: string }>;
  backup: () => Promise<{ saved: boolean; filePath?: string }>;
  restore: () => Promise<{ restored: boolean }>;
  openFolder: () => Promise<{ ok: true }>;
}

declare global {
  interface Window {
    escala?: EscalaBridge;
  }
}

export function desktop(): EscalaBridge {
  if (!window.escala) {
    throw new Error("Este sistema roda como programa de computador. Abra pelo atalho “Escala Técnica”.");
  }
  return window.escala;
}

/** Chama uma operação do banco local; tira o prefixo técnico das mensagens de erro do Electron. */
export async function dbCall<T>(op: string, input?: unknown): Promise<T> {
  try {
    return (await desktop().call(op, input)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
  }
}
