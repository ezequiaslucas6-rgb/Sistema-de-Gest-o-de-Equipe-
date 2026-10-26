import { cloudOps } from "./cloud";

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

/** Lê/grava no banco local do computador (usado só para enviar os dados antigos para a nuvem). */
export async function localCall<T>(op: string, input?: unknown): Promise<T> {
  try {
    return (await desktop().call(op, input)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
  }
}

/** Operação de dados do sistema: agora sempre no Supabase (nuvem). */
export async function dbCall<T>(op: string, input?: unknown): Promise<T> {
  const fn = cloudOps[op];
  if (!fn) throw new Error(`Operação desconhecida: ${op}`);
  return (await fn(input)) as T;
}
