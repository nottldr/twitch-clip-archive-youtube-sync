import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";

export function createLogger(name: string) {
  return pino({ name, level });
}

export const logger = pino({ level });
