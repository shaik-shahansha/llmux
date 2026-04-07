/**
 * Structured JSON logger using Pino.
 * Exported as a singleton used throughout the codebase.
 */

import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";

const opts: pino.LoggerOptions = {
  level,
  base: { service: "llmux" },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
};

if (process.env["NODE_ENV"] !== "production") {
  opts.transport = { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } };
}

export const logger = pino(opts);

export type Logger = typeof logger;
