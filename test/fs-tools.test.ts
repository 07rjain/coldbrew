import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileTools, resolveInsideProject } from '../src/fs-tools.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'openai-agent-tools-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('filesystem tools', () => {
  it('keeps resolved paths inside the project root', async () => {
    await expect(resolveInsideProject(tempDir, '../outside.txt')).rejects.toThrow(
      'Path escapes project root',
    );
  });

  it('lists files and reads text files', async () => {
    await writeFile(path.join(tempDir, 'hello.txt'), 'hello', 'utf8');
    const [listFiles, readFileTool] = createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    });

    await expect(listFiles!.execute({ dir: '.' })).resolves.toMatchObject({
      entries: [{ name: 'hello.txt', type: 'file' }],
    });
    await expect(readFileTool!.execute({ file: 'hello.txt' })).resolves.toMatchObject({
      content: 'hello',
      file: 'hello.txt',
    });
  });

  it('dry-runs edits unless writes are allowed', async () => {
    const target = path.join(tempDir, 'hello.txt');
    await writeFile(target, 'hello world', 'utf8');
    const editFile = createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    })[2]!;

    await expect(
      editFile.execute({ file: 'hello.txt', oldText: 'world', newText: 'there' }),
    ).resolves.toMatchObject({
      dryRun: true,
      edited: false,
    });
    await expect(readFile(target, 'utf8')).resolves.toBe('hello world');
  });

  it('writes edits when explicitly allowed', async () => {
    const target = path.join(tempDir, 'hello.txt');
    await writeFile(target, 'hello world', 'utf8');
    const editFile = createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    })[2]!;

    await expect(
      editFile.execute({ file: 'hello.txt', oldText: 'world', newText: 'there' }),
    ).resolves.toMatchObject({
      edited: true,
    });
    await expect(readFile(target, 'utf8')).resolves.toBe('hello there');
  });

  it('does not edit ambiguous matches', async () => {
    await writeFile(path.join(tempDir, 'hello.txt'), 'x x', 'utf8');
    const editFile = createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    })[2]!;

    await expect(
      editFile.execute({ file: 'hello.txt', oldText: 'x', newText: 'y' }),
    ).resolves.toMatchObject({
      edited: false,
    });
  });

  it('allows root path itself', async () => {
    await expect(resolveInsideProject(tempDir, '.')).resolves.toBe(await realpath(tempDir));
  });
});
