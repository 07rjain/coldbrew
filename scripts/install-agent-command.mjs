#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const configuredBinDir = process.env.COLDBREW_BIN_DIR ?? process.env.AGENT_BIN_DIR;
const targetDir = configuredBinDir
  ? path.resolve(configuredBinDir)
  : path.join(os.homedir(), '.local', 'bin');
const commandNames = ['coldbrew', 'agent'];
const cliPath = path.join(repoRoot, 'dist', 'cli.js');
const marker = '# coldbrew wrapper';
const wrapper = (commandName) => [
  '#!/usr/bin/env sh',
  marker,
  `# command: ${commandName}`,
  `exec node ${JSON.stringify(cliPath)} "$@"`,
  '',
].join('\n');

await mkdir(targetDir, { recursive: true });

for (const commandName of commandNames) {
  const targetPath = path.join(targetDir, commandName);
  try {
    const existing = await readFile(targetPath, 'utf8');
    if (!existing.includes(marker) && process.argv.includes('--force') === false) {
      process.stderr.write(
        `Refusing to overwrite existing ${targetPath}. Re-run with --force if this is intentional.\n`,
      );
      process.exit(1);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  await writeFile(targetPath, wrapper(commandName), { mode: 0o755 });
  process.stdout.write(`Installed ${commandName} command at ${targetPath}\n`);
}

process.stdout.write(`If your shell cannot find it, add ${targetDir} to PATH.\n`);

function isMissingFile(error) {
  return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
