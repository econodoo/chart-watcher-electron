// sql.js types
declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): QueryResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    get(): any[];
    free(): void;
  }

  interface QueryResult {
    columns: string[];
    values: any[][];
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export default initSqlJs;
  export { Database, Statement, QueryResult, SqlJsStatic };
}

// Global Window.api exposed by preload
interface ChartWatcherApi {
  getSources(): Promise<any[]>;
  upsertSource(s: any): Promise<{ ok: boolean }>;
  getComponents(): Promise<any[]>;
  upsertComponent(c: any): Promise<{ ok: boolean }>;
  getTabs(): Promise<any[]>;
  getPlacements(tabId: string): Promise<any[]>;
  upsertPlacement(p: any): Promise<{ ok: boolean }>;
  deletePlacement(id: string): Promise<{ ok: boolean }>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, val: string): Promise<{ ok: boolean }>;
  getWebviewPreloadPath(): string;
  getAgentJsPath(): string;
  onCycleTheme(cb: () => void): void;
  onReloadSources(cb: () => void): void;
}

interface Window {
  api: ChartWatcherApi;
}
