import { z } from '@gc/contracts';
import type { RuntimeConfig } from './runtime-config.js';

export interface ServerConfig extends RuntimeConfig {
  port: number;
  hostname: string;
}
const required = z.object({
  GC_DATABASE_URL: z.string().min(1),
  GC_PUBLIC_ORIGIN: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
});
function runtimeUrls(databaseUrl: string, publicOrigin: string) {
  const database = new URL(databaseUrl);
  const origin = new URL(publicOrigin);
  if (
    database.protocol !== 'mysql:' ||
    !database.hostname ||
    !database.pathname.slice(1) ||
    !database.username
  )
    throw new Error('RUNTIME_DATABASE_INVALID');
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== publicOrigin ||
    origin.username ||
    origin.password
  )
    throw new Error('RUNTIME_PUBLIC_ORIGIN_INVALID');
}
/** Reject incomplete deployments before listening; never expose configuration values in errors. */
export function serverConfig(env: NodeJS.ProcessEnv): ServerConfig {
  try {
    const values = required.parse(env);
    const config = {
      databaseUrl: values.GC_DATABASE_URL,
      publicOrigin: values.GC_PUBLIC_ORIGIN,
      port: values.PORT,
      hostname: values.HOST,
    };
    runtimeUrls(config.databaseUrl, config.publicOrigin);
    return config;
  } catch {
    throw new Error('RUNTIME_CONFIG_INVALID');
  }
}
