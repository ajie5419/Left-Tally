import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const configuration = JSON.parse(readFileSync('config/ci/tools.json', 'utf8'));
const directory = resolve('.tools/ci-tools');
mkdirSync(`${directory}/bin`, { recursive: true });
for (const [name, tool] of Object.entries(configuration)) {
  const asset = tool.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`Unsupported tool platform: ${name}`);
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Tool download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== asset.sha256)
    throw new Error(`Tool archive checksum mismatch: ${name}`);
  const archive = `${directory}/${name}.tar.gz`;
  writeFileSync(archive, data);
  const extraction = spawnSync(
    'tar',
    ['-xzf', archive, '-C', `${directory}/bin`, name],
    { encoding: 'utf8' },
  );
  if (extraction.status !== 0) throw new Error(extraction.stderr);
  chmodSync(`${directory}/bin/${name}`, 0o755);
  const version = spawnSync(
    `${directory}/bin/${name}`,
    [name === 'rtk' ? '--version' : '-version'],
    { encoding: 'utf8' },
  );
  if (version.status !== 0 || !version.stdout.includes(tool.version))
    throw new Error(`Tool version mismatch: ${name}`);
  console.log(`${name}: ${version.stdout.trim()}; SHA256 ${asset.sha256}`);
}
// The pinned proto release may create pnpm shims without executable bits.
for (const name of ['pnpm', 'pnpx']) {
  const shim = `.tools/proto-home/tools/pnpm/10.28.2/shims/${name}`;
  if (existsSync(shim)) chmodSync(shim, 0o755);
}
