/** Normalize only a task-owned inspect result; never inspect existing container environments. */
export function dockerContainer(raw) {
  const mounts = new Map();
  for (const mount of raw.Mounts ?? []) {
    mounts.set(mount.Destination, {
      destination: mount.Destination,
      source: mount.Type === 'tmpfs' ? 'tmpfs' : mount.Source,
      type: { [mount.Type]: {} },
    });
  }
  for (const destination of Object.keys(raw.HostConfig?.Tmpfs ?? {})) {
    if (!mounts.has(destination))
      mounts.set(destination, {
        destination,
        source: 'tmpfs',
        type: { tmpfs: {} },
      });
  }
  const ports = [];
  for (const [port, bindings] of Object.entries(
    raw.HostConfig?.PortBindings ?? {},
  )) {
    const [number, protocol] = port.split('/');
    for (const binding of bindings ?? []) {
      ports.push({
        hostAddress: binding.HostIp,
        hostPort: Number(binding.HostPort),
        containerPort: Number(number),
        proto: protocol,
        count: 1,
      });
    }
  }
  const id = raw.Name?.replace(/^\//, '');
  return {
    id,
    configuration: {
      id,
      labels: raw.Config?.Labels,
      image: {
        reference: raw.Config?.Image,
        descriptor: { digest: raw.Image },
      },
      mounts: [...mounts.values()],
      publishedPorts: ports,
      publishedSockets: [],
      ssh: false,
      virtualization: raw.HostConfig?.Privileged === true,
    },
  };
}

export function containerBackend(name) {
  if (name === 'apple')
    return {
      name,
      executable: '/usr/local/bin/container',
      inventory: ['list', '--all'],
      remove: (id) => ['delete', '--force', id],
      normalize: (record) => record,
    };
  if (name === 'docker')
    return {
      name,
      executable: 'docker',
      inventory: [
        'ps',
        '--all',
        '--no-trunc',
        '--format',
        '{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.State}}',
      ],
      remove: (id) => ['rm', '--force', id],
      normalize: dockerContainer,
    };
  throw new Error('MYSQL_PROBE_BACKEND_UNKNOWN');
}

/**
 * Container CLIs do not guarantee listing order, so compare listings as
 * multisets of exact lines: any added, removed or altered row still differs.
 */
export function sameInventory(before, after) {
  const rows = (text) =>
    text
      .split('\n')
      .filter((line) => line.trim())
      .sort();
  return JSON.stringify(rows(before)) === JSON.stringify(rows(after));
}
