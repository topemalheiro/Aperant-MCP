/**
 * Sentry Configuration (No @sentry/electron dependency)
 *
 * This file provides Sentry configuration utilities that can be safely imported
 * without triggering @sentry/electron's module-level electron.app access.
 *
 * Used by:
 * - sentry.ts (for initialization)
 * - env-utils.ts (for subprocess environment variables)
 */

import { PRODUCTION_TRACE_SAMPLE_RATE } from '../shared/utils/sentry-privacy';

/**
 * Build-time constants defined in electron.vite.config.ts
 * These are replaced at build time with actual values from environment variables.
 * In development, they come from .env file. In CI builds, from GitHub secrets.
 */
declare const __SENTRY_DSN__: string;
declare const __SENTRY_TRACES_SAMPLE_RATE__: string;
declare const __SENTRY_PROFILES_SAMPLE_RATE__: string;

/**
 * Get Sentry DSN from build-time constant
 *
 * The DSN is embedded at build time via Vite's `define` option.
 * - In local development: comes from .env file (loaded by dotenv)
 * - In CI builds: comes from GitHub secrets
 * - For forks: without SENTRY_DSN, Sentry is disabled (safe for forks)
 */
export function getSentryDsn(): string {
  // __SENTRY_DSN__ is replaced at build time with the actual value
  // Falls back to runtime env var for development flexibility
  // typeof guard needed for test environments where Vite's define doesn't apply
  const buildTimeValue = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : '';
  return buildTimeValue || process.env.SENTRY_DSN || '';
}

/**
 * Get trace sample rate from build-time constant
 * Controls performance monitoring sampling (0.0 to 1.0)
 * Default: 0.1 (10%) in production, 0 in development
 *
 * @param isPackaged - Whether the app is packaged (production). When undefined, defaults to 0.
 */
export function getTracesSampleRate(isPackaged?: boolean): number {
  // Try build-time constant first, then runtime env var
  // typeof guard needed for test environments where Vite's define doesn't apply
  const buildTimeValue = typeof __SENTRY_TRACES_SAMPLE_RATE__ !== 'undefined' ? __SENTRY_TRACES_SAMPLE_RATE__ : '';
  const envValue = buildTimeValue || process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  // Default: 10% in production, 0 in dev
  return isPackaged ? PRODUCTION_TRACE_SAMPLE_RATE : 0;
}

/**
 * Get profile sample rate from build-time constant
 * Controls profiling sampling relative to traces (0.0 to 1.0)
 * Default: 0.1 (10%) in production, 0 in development
 *
 * @param isPackaged - Whether the app is packaged (production). When undefined, defaults to 0.
 */
export function getProfilesSampleRate(isPackaged?: boolean): number {
  // Try build-time constant first, then runtime env var
  // typeof guard needed for test environments where Vite's define doesn't apply
  const buildTimeValue = typeof __SENTRY_PROFILES_SAMPLE_RATE__ !== 'undefined' ? __SENTRY_PROFILES_SAMPLE_RATE__ : '';
  const envValue = buildTimeValue || process.env.SENTRY_PROFILES_SAMPLE_RATE;
  if (envValue) {
    const parsed = parseFloat(envValue);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  // Default: 10% in production, 0 in dev
  return isPackaged ? PRODUCTION_TRACE_SAMPLE_RATE : 0;
}

/**
 * Get Sentry environment variables for passing to Python subprocesses
 *
 * This returns the build-time embedded values so that Python backends
 * can also report errors to Sentry in packaged apps.
 *
 * Usage:
 * ```typescript
 * const env = { ...getAugmentedEnv(), ...getSentryEnvForSubprocess() };
 * spawn(pythonPath, args, { env });
 * ```
 */
export function getSentryEnvForSubprocess(): Record<string, string> {
  const dsn = getSentryDsn();
  if (!dsn) {
    return {};
  }

  return {
    SENTRY_DSN: dsn,
    SENTRY_TRACES_SAMPLE_RATE: String(getTracesSampleRate()),
    SENTRY_PROFILES_SAMPLE_RATE: String(getProfilesSampleRate()),
    // Pass SENTRY_DEV so Python backend also enables Sentry in dev mode
    ...(process.env.SENTRY_DEV ? { SENTRY_DEV: process.env.SENTRY_DEV } : {}),
  };
}
