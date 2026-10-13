import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'mysql2/promise';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  assertIdentity,
  assertIsolation,
  allocatePort,
  assertPortClosed,
} from './database-isolation.mjs';
import { containerBackend } from './database-backend.mjs';

const config = JSON.parse(readFileSync('config/database-probe.json', 'utf8'));
const backend = containerBackend(
  process.env.GC_CONTAINER_BACKEND ?? config.backend,
);
const token = randomUUID();
const directory = `evidence/contained/runs/${token}`;
mkdirSync(directory, { recursive: true });
const target = {
  name: `gc-bootstrap-${token}`,
  token,
  image: config.image,
  port: null,
};
const report = {
  phase: 'BOOTSTRAP',
  backend: backend.name,
  target,
  containersCreated: false,
  databaseConnected: false,
  probeVerified: false,
  cleanupVerified: false,
  faultControl: process.argv.includes('--reject-version'),
  commands: [],
  sourceSha256: Object.fromEntries(
    [
      'scripts/database.mjs',
      'scripts/database-isolation.mjs',
      'scripts/database-backend.mjs',
      'config/database-probe.json',
    ].map((path) => [
      path,
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    ]),
  ),
};
let creationAttempted = false;

function command(args, timeout = 10_000) {
  const run = spawnSync(backend.executable, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 5 * 1024 * 1024,
  });
  const log = `${directory}/${report.commands.length}.log`;
  // Inspect only a newly created task resource; never dump existing environments.
  writeFileSync(log, `${run.stdout ?? ''}${run.stderr ?? ''}`);
  report.commands.push({
    command: [backend.executable, ...args],
    exitCode: run.status ?? 1,
    signal: run.signal,
    error: run.error?.message,
    log,
  });
  return run;
}

function requireSuccess(run, reason) {
  if (run.error || run.status !== 0 || run.signal)
    throw new Error(`${reason}: ${run.error?.message ?? run.stderr}`);
  return run.stdout;
}

function inspect() {
  const output = requireSuccess(
    command(['inspect', target.name]),
    'MYSQL_PROBE_INSPECT_FAILED',
  );
  const records = JSON.parse(output);
  if (!Array.isArray(records) || records.length !== 1)
    throw new Error('MYSQL_PROBE_INSPECT_UNKNOWN');
  return backend.normalize(records[0]);
}

async function queryProbe() {
  let connection;
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      connection = await createConnection({
        host: '127.0.0.1',
        port: target.port,
        user: 'root',
        connectTimeout: 2000,
      });
      break;
    } catch (error) {
      if (attempt === 44) throw error;
      await delay(1000);
    }
  }
  if (!connection) throw new Error('MYSQL_PROBE_NOT_READY');
  report.databaseConnected = true;
  try {
    const sql =
      'SELECT VERSION() AS version, @@default_storage_engine AS engine';
    const [rows] = await connection.query(sql);
    report.query = { sql, result: rows };
    const prefix = report.faultControl ? '0.0.' : config.versionPrefix;
    if (
      !Array.isArray(rows) ||
      !rows[0] ||
      !rows[0].version.startsWith(prefix) ||
      rows[0].engine !== config.engine
    )
      throw new Error('MYSQL_PROBE_WRONG_VERSION_ENGINE');
    report.probeVerified = true;
    console.log(JSON.stringify(report.query, null, 2));
  } finally {
    await connection.end();
  }
}

async function cleanup() {
  if (creationAttempted) {
    const container = inspect();
    // A changed mount configuration fails the probe, but its own ID can still be removed.
    assertIdentity(container, target);
    requireSuccess(
      command(backend.remove(target.name), 30_000),
      'MYSQL_PROBE_CLEANUP_FAILED',
    );
    const inventory = requireSuccess(
      command(backend.inventory),
      'MYSQL_PROBE_CLEANUP_INVENTORY_UNKNOWN',
    );
    report.inventoryAfter = inventory;
    if (inventory.split(/\s+/).includes(target.name))
      throw new Error('MYSQL_PROBE_CONTAINER_SURVIVED');
    if (inventory !== report.inventoryBefore)
      throw new Error('MYSQL_PROBE_EXISTING_INVENTORY_CHANGED');
    await assertPortClosed(target.port);
    report.portClosed = true;
  }
  report.cleanupVerified = true;
}

try {
  if (
    config.backend !== 'apple' ||
    config.executable !== '/usr/local/bin/container' ||
    config.image !== 'docker.io/library/mysql:8.4' ||
    config.versionPrefix !== '8.4.' ||
    config.engine !== 'InnoDB'
  )
    throw new Error('MYSQL_PROBE_CONFIGURATION_REFUSED');
  report.cliVersion = requireSuccess(
    command(['--version']),
    'MYSQL_PROBE_RESOURCE_MISSING',
  ).trim();
  if (backend.name === 'apple') {
    const status = requireSuccess(
      command(['system', 'status']),
      'MYSQL_PROBE_RESOURCE_MISSING',
    );
    if (!/^status\s+running\s*$/m.test(status))
      throw new Error('MYSQL_PROBE_SERVICE_NOT_RUNNING');
  } else {
    requireSuccess(
      command(['info', '--format', '{{.ServerVersion}}']),
      'MYSQL_PROBE_RESOURCE_MISSING',
    );
    const context = JSON.parse(
      requireSuccess(
        command([
          'context',
          'inspect',
          '--format',
          '{{json .Endpoints.docker.Host}}',
        ]),
        'MYSQL_PROBE_CONTEXT_UNKNOWN',
      ),
    );
    if (
      typeof context !== 'string' ||
      !context.startsWith('unix://') ||
      (process.env.DOCKER_HOST &&
        !process.env.DOCKER_HOST.startsWith('unix://'))
    )
      throw new Error('MYSQL_PROBE_NONLOCAL_CONTEXT_REFUSED');
  }
  const inventory = requireSuccess(
    command(backend.inventory),
    'MYSQL_PROBE_INVENTORY_UNKNOWN',
  );
  report.inventoryBefore = inventory;
  if (inventory.split(/\s+/).includes(target.name))
    throw new Error('MYSQL_PROBE_NAME_COLLISION');
  target.port = await allocatePort();
  creationAttempted = true;
  requireSuccess(
    command(
      [
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
        config.image,
      ],
      120_000,
    ),
    'MYSQL_PROBE_CREATE_FAILED',
  );
  report.containersCreated = true;
  const container = inspect();
  assertIsolation(container, target);
  report.imageDigest = container.configuration.image.descriptor.digest;
  report.isolationVerified = true;
  requireSuccess(
    command(['start', target.name], 30_000),
    'MYSQL_PROBE_START_FAILED',
  );
  assertIsolation(inspect(), target);
  await queryProbe();
} catch (error) {
  report.reason = error.message;
  report.resourceMissing = /RESOURCE_MISSING|SERVICE_NOT_RUNNING/.test(
    error.message,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    report.cleanupError = error.message;
    console.error(error);
    process.exitCode = 1;
  }
}
report.exitCode = process.exitCode ?? 0;
report.businessTransactionsTested = false;
writeFileSync(
  `${directory}/result.json`,
  JSON.stringify(report, null, 2) + '\n',
);
writeFileSync(
  'evidence/bootstrap/database-probe.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  `MYSQL_PROBE_RESULT ${directory}/result.json exit=${report.exitCode}`,
);
