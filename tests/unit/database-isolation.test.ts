import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const target = {
  name: 'gc-bootstrap-test-only',
  token: 'test-only',
  image: 'docker.io/library/mysql:8.4',
  port: 49152,
};

function container() {
  return {
    id: target.name,
    configuration: {
      id: target.name,
      labels: {
        'gc.scope': 'bootstrap-isolated-probe',
        'gc.probe-id': target.token,
      },
      image: { reference: target.image },
      publishedPorts: [
        {
          hostAddress: '127.0.0.1',
          hostPort: target.port,
          containerPort: 3306,
          proto: 'tcp',
          count: 1,
        },
      ],
      mounts: ['/var/lib/mysql', '/var/run/mysqld'].map((destination) => ({
        destination,
        source: 'tmpfs',
        type: Object.fromEntries([['tmpfs', {}]]),
      })),
      publishedSockets: [],
      ssh: false,
      virtualization: false,
    },
  };
}

function check(actual: ReturnType<typeof container>, identityOnly = false) {
  const method = identityOnly ? 'assertIdentity' : 'assertIsolation';
  const script = `import { ${method} } from './scripts/database-isolation.mjs'; ${method}(${JSON.stringify(actual)}, ${JSON.stringify(target)});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
}

it('accepts the exact owned ephemeral loopback probe', () => {
  expect(check(container()).status).toBe(0);
});

it('refuses foreign identity before cleanup', () => {
  for (const field of ['id', 'label', 'image']) {
    const actual = container();
    if (field === 'id') actual.id = 'existing-business-container';
    if (field === 'label')
      actual.configuration.labels['gc.probe-id'] = 'foreign';
    if (field === 'image') actual.configuration.image.reference = 'mysql:8.0';
    const result = check(actual, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MYSQL_PROBE_FOREIGN_TARGET_REFUSED');
  }
});

it('refuses public or unrelated ports', () => {
  for (const field of ['address', 'port', 'extra']) {
    const actual = container();
    const binding = actual.configuration.publishedPorts[0];
    if (!binding) throw new Error('Missing test binding');
    if (field === 'address') binding.hostAddress = '0.0.0.0';
    if (field === 'port') binding.hostPort = 3307;
    if (field === 'extra') actual.configuration.publishedPorts.push(binding);
    const result = check(actual);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MYSQL_PROBE_BINDING_UNKNOWN');
  }
});

it('refuses persistent or host mounts and extra capabilities', () => {
  for (const field of ['volume', 'bind', 'ssh', 'virtualization', 'missing']) {
    const actual = container();
    const mount = actual.configuration.mounts[0];
    if (!mount) throw new Error('Missing test mount');
    if (field === 'volume') mount.type = { volume: {} };
    if (field === 'bind') mount.source = '/existing-business-data';
    if (field === 'ssh') actual.configuration.ssh = true;
    if (field === 'virtualization') actual.configuration.virtualization = true;
    if (field === 'missing') actual.configuration.mounts.pop();
    const result = check(actual);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MYSQL_PROBE_ISOLATION_UNKNOWN');
  }
});

const header =
  'ID                   IMAGE                           OS     ARCH   STATE    IP  CPUS  MEMORY   STARTED';
const rows = [
  'existing-cache       docker.io/library/redis:alpine  linux  arm64  stopped      4     1024 MB  ',
  'existing-database    docker.io/library/mysql:8.0     linux  arm64  stopped      4     1024 MB  ',
  'existing-postgres    docker.io/library/postgres:16   linux  arm64  stopped      4     1024 MB  ',
];

function sameInventory(before: string[], after: string[]) {
  const script = `import { sameInventory } from './scripts/database-backend.mjs'; console.log(sameInventory(${JSON.stringify(before.join('\n') + '\n')}, ${JSON.stringify(after.join('\n') + '\n')}));`;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  return run.stdout.trim();
}

it('accepts an unchanged inventory listed in a different order', () => {
  const [first = '', second = '', third = ''] = rows;
  expect(sameInventory([header, ...rows], [header, second, third, first])).toBe(
    'true',
  );
});

it('detects added, removed or altered existing containers', () => {
  const [first = '', second = '', third = ''] = rows;
  expect(sameInventory([header, ...rows], [header, first, second])).toBe(
    'false',
  );
  expect(
    sameInventory(
      [header, ...rows],
      [
        header,
        ...rows,
        rows[0]?.replace('existing-cache', 'new-container') ?? '',
      ],
    ),
  ).toBe('false');
  expect(
    sameInventory(
      [header, ...rows],
      [header, first, second, third.replace('stopped', 'running')],
    ),
  ).toBe('false');
  expect(
    sameInventory(
      [header, first, first, second],
      [header, first, second, second],
    ),
  ).toBe('false');
});
