// Tipos mínimos do sql.js usados na leitura do banco antigo (helpers/localFile.tsx).
declare module "sql.js" {
  export interface Statement {
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }
  export interface Database {
    prepare(sql: string): Statement;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
}
