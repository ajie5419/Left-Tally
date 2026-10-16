import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'mysql2/promise';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { containerBackend, sameInventory } from './database-backend.mjs';
import {
  allocatePort,
  assertIdentity,
  assertIsolation,
  assertPortClosed,
} from './database-isolation.mjs';

/** A business test never accepts a caller-supplied database target. */
export async function withBusinessDatabase(run) {
  const config = JSON.parse(readFileSync('config/database-probe.json', 'utf8'));
  const backend = containerBackend(
    process.env.GC_CONTAINER_BACKEND ?? config.backend,
  );
  const token = randomUUID();
  const target = {
    name: `gc-bootstrap-${token}`,
    token,
    image: config.image,
    port: await allocatePort(),
  };
  const directory = `evidence/contained/runs/${token}`;
  mkdirSync(directory, { recursive: true });
  const report = {
    target,
    created: false,
    connected: false,
    isolationVerified: false,
    cleanupVerified: false,
  };
  function command(args) {
    const result = spawnSync(backend.executable, args, {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.status !== 0 || result.error)
      throw new Error(
        `BUSINESS_CONTAINER_FAILED: ${result.stderr ?? result.error?.message}`,
      );
    return result.stdout;
  }
  function inspect() {
    const records = JSON.parse(command(['inspect', target.name]));
    if (!Array.isArray(records) || records.length !== 1)
      throw new Error('BUSINESS_CONTAINER_IDENTITY_UNKNOWN');
    return backend.normalize(records[0]);
  }
  const before = command(backend.inventory);
  let creationAttempted = false;
  let connection;
  try {
    if (backend.name === 'docker') {
      const host = JSON.parse(
        command([
          'context',
          'inspect',
          '--format',
          '{{json .Endpoints.docker.Host}}',
        ]),
      );
      if (
        typeof host !== 'string' ||
        !host.startsWith('unix://') ||
        (process.env.DOCKER_HOST &&
          !process.env.DOCKER_HOST.startsWith('unix://'))
      )
        throw new Error('BUSINESS_NONLOCAL_DOCKER_REFUSED');
    }
    creationAttempted = true;
    command([
      'create',
      '--name',
      target.name,
      '--label',
      'gc.scope=bootstrap-isolated-probe',
      '--label',
      `gc.probe-id=${token}`,
      '--cpus',
      '2',
      '--memory',
      '1G',
      '--tmpfs',
      '/var/lib/mysql',
      '--tmpfs',
      '/var/run/mysqld',
      '--publish',
      `127.0.0.1:${target.port}:3306`,
      '--env',
      'MYSQL_ALLOW_EMPTY_PASSWORD=yes',
      '--env',
      'MYSQL_ROOT_HOST=%',
      target.image,
    ]);
    report.created = true;
    assertIsolation(inspect(), target);
    command(['start', target.name]);
    assertIsolation(inspect(), target);
    report.isolationVerified = true;
    for (let attempt = 0; attempt < 45; attempt++) {
      try {
        connection = await createConnection({
          host: '127.0.0.1',
          port: target.port,
          user: 'root',
          connectTimeout: 1000,
        });
        break;
      } catch (error) {
        if (attempt === 44) throw error;
        await delay(1000);
      }
    }
    if (!connection) throw new Error('BUSINESS_DATABASE_UNAVAILABLE');
    const [rows] = await connection.query(
      'SELECT VERSION() AS version, @@default_storage_engine AS engine',
    );
    if (
      !Array.isArray(rows) ||
      !rows[0]?.version.startsWith('8.4.') ||
      rows[0].engine !== 'InnoDB'
    )
      throw new Error('BUSINESS_DATABASE_VERSION_REFUSED');
    report.connected = true;
    await connection.query(
      'CREATE DATABASE gc_b01 CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
    );
    await connection.end();
    connection = undefined;
    await run(`mysql://root@127.0.0.1:${target.port}/gc_b01`, directory);
  } finally {
    await cleanup();
  }
  async function removeContainer() {
    if (!creationAttempted) return;
    assertIdentity(inspect(), target);
    command(backend.remove(target.name));
    const after = command(backend.inventory);
    if (!sameInventory(before, after))
      throw new Error('BUSINESS_EXISTING_INVENTORY_CHANGED');
    await assertPortClosed(target.port);
    report.cleanupVerified = true;
  }
  async function cleanup() {
    try {
      if (connection) await connection.end();
    } finally {
      try {
        await removeContainer();
      } finally {
        writeFileSync(
          `${directory}/business-database.json`,
          JSON.stringify(report, null, 2) + '\n',
        );
      }
    }
    console.log(`BUSINESS_DATABASE_CLEANED ${directory}`);
  }
}
