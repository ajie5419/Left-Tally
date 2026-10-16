import type { WorkOrderSource } from './modules/work-orders/application/ports.js';

/** Runtime dependencies are all GC-local; no QMS URL, key or login configuration is accepted. */
export interface ProductionAdapters {
  personnel: WorkOrderSource;
}
export interface RuntimeConfig {
  databaseUrl: string;
  publicOrigin: string;
  /** Retired QMS bridge source compatibility only; production runtime ignores it. */
  loginUrl?: string | undefined;
  /** Explicitly test-only: production always emits Secure host-only cookies. */
  insecureCookiesForTesting?: boolean;
}
