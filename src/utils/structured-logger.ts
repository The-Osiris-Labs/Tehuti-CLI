import { debug } from './debug.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: unknown;
  duration?: number;
}

export class StructuredLogger {
  private entries: LogEntry[] = [];
  private maxEntries = 1000;

  constructor(private component: string) {}

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    debug.log(this.component as Parameters<typeof debug.log>[0], `[${level}] ${message}`);
  }

  getEntries(level?: LogLevel): LogEntry[] {
    if (level) return this.entries.filter(e => e.level === level);
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export function createLogger(component: string): StructuredLogger {
  return new StructuredLogger(component);
}
