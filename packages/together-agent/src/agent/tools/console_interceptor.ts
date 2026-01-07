interface LogEntry {
  level: string;
  args: any[];
}

export interface ConsoleInterceptor {
  console: {
    log: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  };
  getLogs: () => string[];
}

export function createConsoleInterceptor(): ConsoleInterceptor {
  const logs: LogEntry[] = [];

  const createLogger = (level: string) => (...args: any[]) => {
    logs.push({ level, args });
  };

  const getLogs = (): string[] => {
    return logs.map((log) => {
      const message = log.args
        .map((arg) => {
          if (typeof arg === "object" && arg !== null) {
            try {
              return JSON.stringify(arg, null, 2);
            } catch (e) {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(" ");
      return `[${log.level}] ${message}`;
    });
  };

  return {
    console: {
      log: createLogger("log"),
      info: createLogger("info"),
      warn: createLogger("warn"),
      error: createLogger("error"),
      debug: createLogger("debug"),
    },
    getLogs,
  };
}
