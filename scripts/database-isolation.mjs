import { createServer, createConnection } from 'node:net';

/** Never identify an owned resource by its human-readable prefix alone. */
export function assertIdentity(container, target) {
  const config = container?.configuration;
  if (
    container?.id !== target.name ||
    config?.id !== target.name ||
    config?.labels?.['gc.scope'] !== 'bootstrap-isolated-probe' ||
    config?.labels?.['gc.probe-id'] !== target.token ||
    config?.image?.reference !== target.image
  )
    throw new Error('MYSQL_PROBE_FOREIGN_TARGET_REFUSED');
}

/** A probe may expose only its own loopback port and ephemeral mount points. */
export function assertIsolation(container, target) {
  assertIdentity(container, target);
  const config = container.configuration;
  const ports = config.publishedPorts;
  if (
    !Array.isArray(ports) ||
    ports.length !== 1 ||
    ports[0].hostAddress !== '127.0.0.1' ||
    ports[0].hostPort !== target.port ||
    ports[0].containerPort !== 3306 ||
    ports[0].proto !== 'tcp' ||
    ports[0].count !== 1
  )
    throw new Error('MYSQL_PROBE_BINDING_UNKNOWN');
  const destinations = ['/var/lib/mysql', '/var/run/mysqld'];
  if (
    !Array.isArray(config.mounts) ||
    config.mounts.length !== destinations.length ||
    !destinations.every((destination) =>
      config.mounts.some(
        (mount) =>
          mount.destination === destination &&
          mount.type &&
          typeof mount.type === 'object' &&
          Object.keys(mount.type).length === 1 &&
          mount.type.tmpfs &&
          Object.keys(mount.type.tmpfs).length === 0 &&
          mount.source === 'tmpfs',
      ),
    ) ||
    config.publishedSockets?.length ||
    config.ssh ||
    config.virtualization
  )
    throw new Error('MYSQL_PROBE_ISOLATION_UNKNOWN');
}

export async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('MYSQL_PROBE_PORT_UNKNOWN');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/** Only ECONNREFUSED proves that no listener survived cleanup. */
export async function assertPortClosed(port) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error('MYSQL_PROBE_PORT_STILL_OPEN'));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('MYSQL_PROBE_PORT_STATE_UNKNOWN'));
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
  });
}
