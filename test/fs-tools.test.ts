import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileTools, resolveInsideProject } from '../src/fs-tools.js';
import type { ToolDefinition } from '../src/types.js';

let tempDir: string;
const execFileAsync = promisify(execFile);

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

  it('reads multiple files in one tool call', async () => {
    await writeFile(path.join(tempDir, 'a.txt'), 'alpha', 'utf8');
    await writeFile(path.join(tempDir, 'b.txt'), 'beta', 'utf8');
    const readManyFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'read_many_files');

    await expect(
      readManyFiles.execute({ files: ['a.txt', 'b.txt'], maxBytesPerFile: null }),
    ).resolves.toMatchObject({
      count: 2,
      results: [
        { ok: true, file: 'a.txt', content: 'alpha' },
        { ok: true, file: 'b.txt', content: 'beta' },
      ],
    });
  });

  it('returns per-file errors when read_many_files cannot read a file', async () => {
    await writeFile(path.join(tempDir, 'a.txt'), 'alpha', 'utf8');
    const readManyFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'read_many_files');

    await expect(
      readManyFiles.execute({ files: ['a.txt', 'missing.txt'], maxBytesPerFile: null }),
    ).resolves.toMatchObject({
      count: 2,
      results: [
        { ok: true, file: 'a.txt', content: 'alpha' },
        { ok: false, file: 'missing.txt' },
      ],
    });
  });

  it('enforces read_many_files item limit', async () => {
    const readManyFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'read_many_files');

    await expect(
      readManyFiles.execute({
        files: Array.from({ length: 21 }, (_, index) => `${index}.txt`),
        maxBytesPerFile: null,
      }),
    ).rejects.toThrow('between 1 and 20 items');
  });

  it('keeps read_many_files paths inside the project root', async () => {
    const readManyFiles = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'read_many_files');

    await expect(
      readManyFiles.execute({ files: ['../outside.txt'], maxBytesPerFile: null }),
    ).resolves.toMatchObject({
      results: [
        {
          ok: false,
          file: '../outside.txt',
          error: expect.stringContaining('Path escapes project root'),
        },
      ],
    });
  });

  it('shows unstaged git diffs', async () => {
    await initGitRepo(tempDir);
    await writeFile(path.join(tempDir, 'tracked.txt'), 'before\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: tempDir });
    await writeFile(path.join(tempDir, 'tracked.txt'), 'after\n', 'utf8');
    const gitDiff = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'git_diff');

    await expect(
      gitDiff.execute({ path: null, staged: false, maxBytes: null }),
    ).resolves.toMatchObject({
      hasDiff: true,
      staged: false,
      truncated: false,
      diff: expect.stringContaining('-before'),
    });
  });

  it('shows staged git diffs scoped to a file', async () => {
    await initGitRepo(tempDir);
    await writeFile(path.join(tempDir, 'tracked.txt'), 'staged\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: tempDir });
    const gitDiff = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'git_diff');

    await expect(
      gitDiff.execute({ path: 'tracked.txt', staged: true, maxBytes: null }),
    ).resolves.toMatchObject({
      hasDiff: true,
      path: 'tracked.txt',
      staged: true,
      diff: expect.stringContaining('+staged'),
    });
  });

  it('keeps git_diff paths inside the project root', async () => {
    await initGitRepo(tempDir);
    const gitDiff = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'git_diff');

    await expect(
      gitDiff.execute({ path: '../outside.txt', staged: false, maxBytes: null }),
    ).rejects.toThrow('Path escapes project root');
  });

  it('lists a depth-limited project tree', async () => {
    await mkdir(path.join(tempDir, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(path.join(tempDir, 'src', 'nested', 'deep.ts'), 'export {};\n', 'utf8');
    const listTree = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'list_tree');

    await expect(
      listTree.execute({ dir: '.', maxDepth: 1, maxEntries: 20 }),
    ).resolves.toMatchObject({
      entryCount: 3,
      entries: [
        { path: 'src', type: 'directory', depth: 0 },
        { path: 'src/nested', type: 'directory', depth: 1 },
        { path: 'src/index.ts', type: 'file', depth: 1 },
      ],
      truncated: false,
    });
  });

  it('hides ignored directories from list_tree', async () => {
    await mkdir(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(tempDir, 'src'), { recursive: true });
    const listTree = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'list_tree');

    await expect(
      listTree.execute({ dir: '.', maxDepth: 2, maxEntries: 20 }),
    ).resolves.toMatchObject({
      entries: [{ path: 'src', type: 'directory', depth: 0 }],
    });
  });

  it('truncates list_tree results at maxEntries', async () => {
    await writeFile(path.join(tempDir, 'a.txt'), 'a', 'utf8');
    await writeFile(path.join(tempDir, 'b.txt'), 'b', 'utf8');
    const listTree = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'list_tree');

    await expect(
      listTree.execute({ dir: '.', maxDepth: 1, maxEntries: 1 }),
    ).resolves.toMatchObject({
      entryCount: 1,
      truncated: true,
    });
  });

  it('keeps list_tree paths inside the project root', async () => {
    const listTree = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'list_tree');

    await expect(
      listTree.execute({ dir: '../outside', maxDepth: 1, maxEntries: 20 }),
    ).rejects.toThrow('Path escapes project root');
  });

  it('dry-runs write_file unless writes are allowed', async () => {
    const writeFileTool = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'write_file');

    await expect(
      writeFileTool.execute({ file: 'new.txt', content: 'hello', overwrite: null }),
    ).resolves.toMatchObject({
      dryRun: true,
      written: false,
      file: 'new.txt',
    });
    await expect(readFile(path.join(tempDir, 'new.txt'), 'utf8')).rejects.toThrow();
  });

  it('writes new files when explicitly allowed', async () => {
    const writeFileTool = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'write_file');

    await expect(
      writeFileTool.execute({ file: 'new.txt', content: 'hello', overwrite: null }),
    ).resolves.toMatchObject({
      written: true,
      file: 'new.txt',
      exists: false,
    });
    await expect(readFile(path.join(tempDir, 'new.txt'), 'utf8')).resolves.toBe('hello');
  });

  it('does not overwrite existing files unless overwrite is true', async () => {
    await writeFile(path.join(tempDir, 'existing.txt'), 'old', 'utf8');
    const writeFileTool = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'write_file');

    await expect(
      writeFileTool.execute({ file: 'existing.txt', content: 'new', overwrite: false }),
    ).resolves.toMatchObject({
      written: false,
      exists: true,
    });
    await expect(readFile(path.join(tempDir, 'existing.txt'), 'utf8')).resolves.toBe('old');
  });

  it('overwrites existing files when explicitly allowed', async () => {
    await writeFile(path.join(tempDir, 'existing.txt'), 'old', 'utf8');
    const writeFileTool = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'write_file');

    await expect(
      writeFileTool.execute({ file: 'existing.txt', content: 'new', overwrite: true }),
    ).resolves.toMatchObject({
      written: true,
      exists: true,
      overwrite: true,
    });
    await expect(readFile(path.join(tempDir, 'existing.txt'), 'utf8')).resolves.toBe('new');
  });

  it('keeps write_file paths inside the project root', async () => {
    const writeFileTool = getTool(createFileTools({
      allowEdits: true,
      projectRoot: tempDir,
    }), 'write_file');

    await expect(
      writeFileTool.execute({ file: '../outside.txt', content: 'nope', overwrite: null }),
    ).rejects.toThrow('Path escapes project root');
  });

  it('runs allowlisted commands', async () => {
    await initGitRepo(tempDir);
    await writeFile(path.join(tempDir, 'changed.txt'), 'changed', 'utf8');
    const runCommand = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'run_command');

    await expect(
      runCommand.execute({ command: 'git status --short', maxBytes: null }),
    ).resolves.toMatchObject({
      command: 'git status --short',
      exitCode: 0,
      ok: true,
      stdout: expect.stringContaining('changed.txt'),
      truncated: false,
    });
  });

  it('rejects commands outside the allowlist', async () => {
    const runCommand = getTool(createFileTools({
      allowEdits: false,
      projectRoot: tempDir,
    }), 'run_command');

    await expect(
      runCommand.execute({ command: 'rm -rf .', maxBytes: null }),
    ).rejects.toThrow('Command is not allowlisted');
  });
});

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
}

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
}
