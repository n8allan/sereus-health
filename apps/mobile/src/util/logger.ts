export type Logger = {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  sql: (query: string, params?: unknown[]) => void;
};

function ts(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    info: (...args) => console.log(ts(), prefix, ...args),
    debug: (...args) => console.debug(ts(), prefix, ...args),
    error: (...args) => console.error(ts(), prefix, ...args),
    sql: (query, params) => console.debug(ts(), prefix, 'SQL:', query.trim(), params ?? []),
  };
}


