export interface D1RunMeta {
  changes?: number;
  last_row_id?: number;
}

export interface D1RunResult {
  success?: boolean;
  meta?: D1RunMeta;
}

export interface D1AllResult<T> {
  results?: T[];
  success?: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
}

export interface WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  DB?: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  PAGELEA_ADMIN_EMAILS?: string;
  PAGELEA_ANONYMOUS_ANALYTICS_ENABLED?: string;
}
