import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileTools, resolveInsideProject } from '../src/fs-tools.js';
import type { ToolDefinition } from '../src/types.js';

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
    const tools = createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    });
    const listFiles = getTool(tools, 'list_files');
    const readFileTool = getTool(tools, 'read_file');

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
    const editFile = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'edit_file');

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
    const editFile = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'edit_file');

    await expect(
      editFile.execute({ file: 'hello.txt', oldText: 'world', newText: 'there' }),
    ).resolves.toMatchObject({
      edited: true,
    });
    await expect(readFile(target, 'utf8')).resolves.toBe('hello there');
  });

  it('does not edit ambiguous matches', async () => {
    await writeFile(path.join(tempDir, 'hello.txt'), 'x x', 'utf8');
    const editFile = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'edit_file');

    await expect(
      editFile.execute({ file: 'hello.txt', oldText: 'x', newText: 'y' }),
    ).resolves.toMatchObject({
      edited: false,
    });
  });

  it('allows root path itself', async () => {
    await expect(resolveInsideProject(tempDir, '.')).resolves.toBe(await realpath(tempDir));
  });

  it('searches files with ripgrep', async () => {
    await writeFile(path.join(tempDir, 'hello.ts'), 'const greeting = "hello";\n', 'utf8');
    await writeFile(path.join(tempDir, 'notes.md'), 'hello from docs\n', 'utf8');
    const searchFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'search_files');

    await expect(searchFiles.execute({ query: 'hello', maxResults: 10 })).resolves.toMatchObject({
      matchCount: 2,
      matches: expect.arrayContaining([
        { file: 'hello.ts', line: 1, text: 'const greeting = "hello";' },
        { file: 'notes.md', line: 1, text: 'hello from docs' },
      ]),
      truncated: false,
    });
  });

  it('supports glob filtering in search', async () => {
    await writeFile(path.join(tempDir, 'hello.ts'), 'hello from ts\n', 'utf8');
    await writeFile(path.join(tempDir, 'notes.md'), 'hello from docs\n', 'utf8');
    const searchFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'search_files');

    await expect(
      searchFiles.execute({ query: 'hello', glob: '*.ts', maxResults: 10 }),
    ).resolves.toMatchObject({
      matchCount: 1,
      matches: [{ file: 'hello.ts', line: 1, text: 'hello from ts' }],
    });
  });

  it('returns an empty match list when search has no results', async () => {
    await writeFile(path.join(tempDir, 'hello.txt'), 'hello', 'utf8');
    const searchFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'search_files');

    await expect(searchFiles.execute({ query: 'missing' })).resolves.toMatchObject({
      matchCount: 0,
      matches: [],
      truncated: false,
    });
  });

  it('keeps search paths inside the project root', async () => {
    const searchFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'search_files');

    await expect(searchFiles.execute({ query: 'hello', path: '../outside' })).rejects.toThrow(
      'Path escapes project root',
    );
  });
});

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
}
