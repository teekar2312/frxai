/**
 * H-11: Safe structured logger that sanitizes sensitive data in production.
 * In development, logs include full error details.
 * In production, error messages are truncated and stack traces are omitted.
 */

const isDev = process.env.NODE_ENV === 'development';

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  route: string;
  message: string;
  error?: string;
  [key: string]: unknown;
}

function sanitize(message: string, maxLength = 200): string {
  if (isDev) return message;
  // In production: truncate and remove potential file paths
  return message
    .replace(/\/home\/[^\s]+/g, '[PATH]')
    .replace(/\/app\/[^\s]+/g, '[PATH]')
    .replace(/at\s+[^\n]+/g, '[STACK]')
    .slice(0, maxLength);
}

export function safeLog(entry: LogEntry): void {
  const { level, route, message, error, ...meta } = entry;
  const sanitizedMessage = sanitize(message);
  const sanitizedError = error ? sanitize(error) : undefined;

  const logObj: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    route,
    msg: sanitizedMessage,
    ...meta,
  };
  if (sanitizedError) logObj.err = sanitizedError;

  const prefix = `[${level.toUpperCase()}] [${route}]`;
  switch (level) {
    case 'error':
      console.error(prefix, JSON.stringify(logObj));
      break;
    case 'warn':
      console.warn(prefix, JSON.stringify(logObj));
      break;
    case 'debug':
      if (isDev) console.debug(prefix, JSON.stringify(logObj));
      break;
    default:
      console.log(prefix, JSON.stringify(logObj));
  }
}

/** Convenience: log API error safely */
export function logApiError(route: string, error: unknown): void {
  safeLog({
    level: 'error',
    route,
    message: 'Request failed',
    error: error instanceof Error ? error.message : String(error),
  });
}
