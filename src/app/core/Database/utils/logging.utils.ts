import { environment } from '../../../../environments/environment';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogContext {
  service: string;
  method?: string;
  operation?: string;
  data?: any;
}

class Logger {
  private isProduction = environment.production;
  private logLevel = LogLevel.ERROR; // Only show errors

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(
    level: string,
    context: LogContext,
    message: string,
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context.method
      ? `${context.service}.${context.method}`
      : context.service;

    return `[${timestamp}] [${level}] [${contextStr}] ${message}`;
  }

  private log(
    level: LogLevel,
    levelName: string,
    context: LogContext,
    message: string,
    data?: any,
  ): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(levelName, context, message);

    if (data) {
      (console as any)[levelName.toLowerCase()](formattedMessage, data);
    } else {
      (console as any)[levelName.toLowerCase()](formattedMessage);
    }
  }

  debug(context: LogContext, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, 'DEBUG', context, message, data);
  }

  info(context: LogContext, message: string, data?: any): void {
    this.log(LogLevel.INFO, 'INFO', context, message, data);
  }

  warn(context: LogContext, message: string, data?: any): void {
    this.log(LogLevel.WARN, 'WARN', context, message, data);
  }

  error(context: LogContext, message: string, error?: Error | any): void {
    this.log(LogLevel.ERROR, 'ERROR', context, message, error);
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

export const logger = new Logger();

// Convenience functions for common services
export const createServiceLogger = (serviceName: string) => ({
  debug: (method: string, message: string, data?: any) =>
    logger.debug({ service: serviceName, method }, message, data),
  info: (method: string, message: string, data?: any) =>
    logger.info({ service: serviceName, method }, message, data),
  warn: (method: string, message: string, data?: any) =>
    logger.warn({ service: serviceName, method }, message, data),
  error: (method: string, message: string, error?: Error | any) =>
    logger.error({ service: serviceName, method }, message, error),
});
