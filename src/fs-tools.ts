import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import type { JsonObject, JsonValue, ToolDefinition } from './types.js';

const DEFAULT_MAX_READ_BYTES = 512_000;
const DEFAULT_MAX_READ_MANY_BYTES = 128_000;
const DEFAULT_MAX_READ_MANY_FILES = 20;
const DEFAULT_MAX_WRITE_BYTES = 512_000;
const DEFAULT_MAX_SEARCH_RESULTS = 50;
const DEFAULT_MAX_SEARCH_OUTPUT_BYTES = 64_000;
const DEFAULT_MAX_DIFF_BYTES = 96_000;
const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 96_000;
const DEFAULT_TREE_DEPTH = 2;
const DEFAULT_TREE_MAX_ENTRIES = 200;
const DEFAULT_IGNORED_NAMES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);

export interface FileToolOptions {
  allowEdits: boolean;
  maxReadBytes?: number;
  projectRoot: string;
}

export function createFileTools(options: FileToolOptions): ToolDefinition[] {
  const projectRoot = path.resolve(options.projectRoot);
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;

  return [
    {
      name: 'list_files',
      description: 'List files and directories under a project-relative directory.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Project-relative directory path. Use "." for the project root.',
          },
        },
        required: ['dir'],
        additionalProperties: false,
      },
      async execute(args) {
        const dir = getString(args, 'dir');
        const dirPath = await resolveInsideProject(projectRoot, dir);
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        return {
          dir,
          entries: entries
            .filter((entry) => !DEFAULT_IGNORED_NAMES.has(entry.name))
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      },
    },
    {
      name: 'list_tree',
      description:
        'List a depth-limited project tree under a project-relative directory, skipping generated and vendor directories.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: ['string', 'null'],
            description: 'Project-relative directory path. Defaults to ".".',
          },
          maxDepth: {
            type: ['integer', 'null'],
            description: 'Maximum directory depth to recurse. Defaults to 2 and caps at 5.',
          },
          maxEntries: {
            type: ['integer', 'null'],
            description: 'Maximum entries to return. Defaults to 200 and caps at 1000.',
          },
        },
        required: ['dir', 'maxDepth', 'maxEntries'],
        additionalProperties: false,
      },
      async execute(args) {
        const dir = getOptionalString(args, 'dir') ?? '.';
        const maxDepth = getOptionalInteger(args, 'maxDepth', DEFAULT_TREE_DEPTH, 0, 5);
        const maxEntries = getOptionalInteger(args, 'maxEntries', DEFAULT_TREE_MAX_ENTRIES, 1, 1000);
        const rootRealPath = await fs.realpath(projectRoot);
        const startPath = await resolveInsideProject(projectRoot, dir);
        const result = await buildTreeEntries({
          count: 0,
          entries: [],
          maxDepth,
          maxEntries,
          rootPath: rootRealPath,
          startPath,
          truncated: false,
        });

        return {
          dir,
          maxDepth,
          maxEntries,
          entryCount: result.entries.length,
          truncated: result.truncated,
          entries: result.entries,
        };
      },
    },
    {
      name: 'search_files',
      description:
        'Search text files under the project root using ripgrep. Returns project-relative file, line, and text matches.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Literal or regex search query passed to rg.',
          },
          path: {
            type: ['string', 'null'],
            description: 'Project-relative file or directory to search. Defaults to ".".',
          },
          glob: {
            type: ['string', 'null'],
            description: 'Optional rg glob, such as "*.ts" or "src/**/*.ts".',
          },
          maxResults: {
            type: ['integer', 'null'],
            description: 'Maximum number of matches to return. Defaults to 50 and caps at 200.',
          },
        },
        required: ['query', 'path', 'glob', 'maxResults'],
        additionalProperties: false,
      },
      async execute(args) {
        const query = getString(args, 'query');
        const requestedPath = getOptionalString(args, 'path') ?? '.';
        const glob = getOptionalString(args, 'glob');
        const maxResults = getOptionalInteger(args, 'maxResults', DEFAULT_MAX_SEARCH_RESULTS, 1, 200);
        const searchPath = await resolveInsideProject(projectRoot, requestedPath);
        const rootRealPath = await fs.realpath(projectRoot);
        const result = await runRipgrep({
          glob,
          maxResults,
          projectRoot: rootRealPath,
          query,
          searchPath,
        });

        return {
          query,
          path: requestedPath,
          ...(glob ? { glob } : {}),
          matchCount: result.matches.length,
          truncated: result.truncated,
          matches: result.matches,
        };
      },
    },
    {
      name: 'git_diff',
      description:
        'Show the current Git diff for the project, optionally scoped to one project-relative path. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: ['string', 'null'],
            description: 'Optional project-relative file or directory to diff.',
          },
          staged: {
            type: ['boolean', 'null'],
            description: 'When true, show staged changes with git diff --cached. Defaults to false.',
          },
          maxBytes: {
            type: ['integer', 'null'],
            description: 'Maximum diff output bytes. Defaults to 96000 and caps at 200000.',
          },
        },
        required: ['path', 'staged', 'maxBytes'],
        additionalProperties: false,
      },
      async execute(args) {
        const requestedPath = getOptionalString(args, 'path');
        const staged = getOptionalBoolean(args, 'staged', false);
        const maxBytes = getOptionalInteger(args, 'maxBytes', DEFAULT_MAX_DIFF_BYTES, 1, 200_000);
        const rootRealPath = await fs.realpath(projectRoot);
        let relativePath: string | undefined;

        if (requestedPath) {
          const absolutePath = await resolveInsideProject(projectRoot, requestedPath);
          relativePath = path.relative(rootRealPath, absolutePath) || '.';
        }

        const result = await runGitDiff({
          maxBytes,
          projectRoot: rootRealPath,
          relativePath,
          staged,
        });

        return {
          diff: result.diff,
          hasDiff: result.diff.length > 0,
          ...(requestedPath ? { path: requestedPath } : {}),
          staged,
          truncated: result.truncated,
        };
      },
    },
    {
      name: 'run_command',
      description:
        'Run a small allowlist of project verification commands. No arbitrary shell commands or custom arguments.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['pnpm test', 'pnpm build', 'pnpm lint', 'git status --short'],
            description: 'Allowlisted command to run.',
          },
          maxBytes: {
            type: ['integer', 'null'],
            description: 'Maximum stdout output bytes. Defaults to 96000 and caps at 200000.',
          },
        },
        required: ['command', 'maxBytes'],
        additionalProperties: false,
      },
      async execute(args) {
        const command = getString(args, 'command');
        const maxBytes = getOptionalInteger(
          args,
          'maxBytes',
          DEFAULT_MAX_COMMAND_OUTPUT_BYTES,
          1,
          200_000,
        );
        const rootRealPath = await fs.realpath(projectRoot);
        const result = await runAllowlistedCommand(command, rootRealPath, maxBytes);

        return {
          command,
          exitCode: result.exitCode,
          ok: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
        };
      },
    },
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file under the project root.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Project-relative file path.',
          },
        },
        required: ['file'],
        additionalProperties: false,
      },
      async execute(args) {
        const file = getString(args, 'file');
        return readTextFile(projectRoot, file, maxReadBytes);
      },
    },
    {
      name: 'read_many_files',
      description:
        'Read multiple UTF-8 text files under the project root in one call. Returns per-file results and errors.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            description: 'Project-relative file paths to read. Maximum 20 files.',
            items: {
              type: 'string',
            },
          },
          maxBytesPerFile: {
            type: ['integer', 'null'],
            description:
              'Optional per-file byte limit. Defaults to 128000 and caps at the configured read limit.',
          },
        },
        required: ['files', 'maxBytesPerFile'],
        additionalProperties: false,
      },
      async execute(args) {
        const files = getStringArray(args, 'files', 1, DEFAULT_MAX_READ_MANY_FILES);
        const requestedMaxBytes = getOptionalInteger(
          args,
          'maxBytesPerFile',
          DEFAULT_MAX_READ_MANY_BYTES,
          1,
          maxReadBytes,
        );
        const results: FileReadManyResult[] = [];

        for (const file of files) {
          try {
            results.push({
              ok: true,
              ...(await readTextFile(projectRoot, file, requestedMaxBytes)),
            });
          } catch (error) {
            results.push({
              ok: false,
              file,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        return {
          count: results.length,
          maxBytesPerFile: requestedMaxBytes,
          results,
        };
      },
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a UTF-8 text file under the project root. Dry-run unless edits are explicitly allowed.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Project-relative file path. Parent directory must already exist.',
          },
          content: {
            type: 'string',
            description: 'Full UTF-8 file content to write.',
          },
          overwrite: {
            type: ['boolean', 'null'],
            description: 'Set true to overwrite an existing file. Defaults to false.',
          },
        },
        required: ['file', 'content', 'overwrite'],
        additionalProperties: false,
      },
      async execute(args) {
        const file = getString(args, 'file');
        const content = getString(args, 'content', { allowEmpty: true });
        const overwrite = getOptionalBoolean(args, 'overwrite', false);
        const bytes = Buffer.byteLength(content, 'utf8');

        if (bytes > DEFAULT_MAX_WRITE_BYTES) {
          throw new Error(`${file} content is ${bytes} bytes, above the ${DEFAULT_MAX_WRITE_BYTES} byte limit.`);
        }

        if (content.includes('\u0000')) {
          throw new Error(`${file} content appears to be binary.`);
        }

        const filePath = await resolveInsideProject(projectRoot, file);
        const exists = await fileExists(filePath);
        if (exists && !overwrite) {
          return {
            written: false,
            dryRun: true,
            file,
            exists: true,
            reason: 'File exists. Pass overwrite=true and run with --allow-edits to replace it.',
          };
        }

        const result = {
          written: options.allowEdits,
          dryRun: !options.allowEdits,
          file,
          bytes,
          exists,
          overwrite,
        };

        if (!options.allowEdits) {
          return {
            ...result,
            reason: 'Run with --allow-edits to write this file.',
          };
        }

        await fs.writeFile(filePath, content, 'utf8');
        return result;
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace exactly one occurrence of oldText with newText in an existing UTF-8 project file. Returns a dry-run result unless edits are explicitly allowed.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Project-relative file path.',
          },
          oldText: {
            type: 'string',
            description: 'Exact existing text to replace. Must occur exactly once.',
          },
          newText: {
            type: 'string',
            description: 'Replacement text.',
          },
        },
        required: ['file', 'oldText', 'newText'],
        additionalProperties: false,
      },
      async execute(args) {
        const file = getString(args, 'file');
        const oldText = getString(args, 'oldText');
        const newText = getString(args, 'newText');
        const filePath = await resolveInsideProject(projectRoot, file);
        const original = await fs.readFile(filePath, 'utf8');

        if (original.includes('\u0000')) {
          throw new Error(`${file} appears to be binary.`);
        }

        const matchCount = countOccurrences(original, oldText);
        if (matchCount !== 1) {
          return {
            edited: false,
            reason: `Expected exactly one match for oldText, found ${matchCount}.`,
          };
        }

        const updated = original.replace(oldText, newText);
        const result = {
          edited: options.allowEdits,
          file,
          dryRun: !options.allowEdits,
          removedChars: oldText.length,
          addedChars: newText.length,
        };

        if (!options.allowEdits) {
          return {
            ...result,
            reason: 'Run with --allow-edits to write this change.',
          };
        }

        await fs.writeFile(filePath, updated, 'utf8');
        return result;
      },
    },
  ];
}

export async function resolveInsideProject(projectRoot: string, requestedPath: string): Promise<string> {
  const rootRealPath = await fs.realpath(projectRoot);
  const resolved = path.resolve(rootRealPath, requestedPath);
  const parent = path.dirname(resolved);
  const parentRealPath = await fs.realpath(parent);
  const finalPath = path.join(parentRealPath, path.basename(resolved));

  if (finalPath !== rootRealPath && !finalPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`Path escapes project root: ${requestedPath}`);
  }

  return finalPath;
}

interface SearchMatch extends JsonObject {
  file: string;
  line: number;
  text: string;
}

interface TreeEntry extends JsonObject {
  depth: number;
  path: string;
  type: string;
}

async function buildTreeEntries(state: {
  count: number;
  entries: TreeEntry[];
  maxDepth: number;
  maxEntries: number;
  rootPath: string;
  startPath: string;
  truncated: boolean;
}): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  await visitTreeDirectory(state, state.startPath, 0);
  return {
    entries: state.entries,
    truncated: state.truncated,
  };
}

async function visitTreeDirectory(
  state: {
    count: number;
    entries: TreeEntry[];
    maxDepth: number;
    maxEntries: number;
    rootPath: string;
    truncated: boolean;
  },
  dirPath: string,
  depth: number,
): Promise<void> {
  if (state.truncated || depth > state.maxDepth) {
    return;
  }

  const dirents = (await fs.readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => !DEFAULT_IGNORED_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  for (const dirent of dirents) {
    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }

    const absolutePath = path.join(dirPath, dirent.name);
    const entry: TreeEntry = {
      depth,
      path: path.relative(state.rootPath, absolutePath) || '.',
      type: dirent.isDirectory()
        ? 'directory'
        : dirent.isSymbolicLink()
          ? 'symlink'
          : 'file',
    };
    state.entries.push(entry);
    state.count += 1;

    if (dirent.isDirectory() && depth < state.maxDepth) {
      await visitTreeDirectory(state, absolutePath, depth + 1);
    }
  }
}

interface FileReadResult extends JsonObject {
  bytes: number;
  content: string;
  file: string;
}

type FileReadManyResult = FileReadManySuccess | FileReadManyFailure;

interface FileReadManySuccess extends JsonObject {
  bytes: number;
  content: string;
  file: string;
  ok: true;
}

interface FileReadManyFailure extends JsonObject {
  error: string;
  file: string;
  ok: false;
}

async function readTextFile(
  projectRoot: string,
  file: string,
  maxBytes: number,
): Promise<FileReadResult> {
  const filePath = await resolveInsideProject(projectRoot, file);
  const stat = await fs.stat(filePath);

  if (!stat.isFile()) {
    throw new Error(`${file} is not a file.`);
  }

  if (stat.size > maxBytes) {
    throw new Error(`${file} is ${stat.size} bytes, above the ${maxBytes} byte limit.`);
  }

  const content = await fs.readFile(filePath, 'utf8');
  if (content.includes('\u0000')) {
    throw new Error(`${file} appears to be binary.`);
  }

  return {
    file,
    bytes: stat.size,
    content,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function runRipgrep(options: {
  glob?: string;
  maxResults: number;
  projectRoot: string;
  query: string;
  searchPath: string;
}): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const args = [
    '--line-number',
    '--no-heading',
    '--color',
    'never',
    '--max-count',
    String(options.maxResults + 1),
    options.query,
  ];

  if (options.glob) {
    args.push('--glob', options.glob);
  }

  args.push(options.searchPath);

  const output = await collectProcessOutput('rg', args, {
    cwd: options.projectRoot,
    maxOutputBytes: DEFAULT_MAX_SEARCH_OUTPUT_BYTES,
  });

  if (output.exitCode === 1 && output.stdout.length === 0) {
    return { matches: [], truncated: false };
  }

  if (output.exitCode !== 0 && output.exitCode !== 1) {
    throw new Error(output.stderr.trim() || `rg exited with code ${output.exitCode}.`);
  }

  const matches = output.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => parseRipgrepLine(options.projectRoot, line))
    .filter((match): match is SearchMatch => match !== null);

  return {
    matches: matches.slice(0, options.maxResults),
    truncated: output.truncated || matches.length > options.maxResults,
  };
}

async function runGitDiff(options: {
  maxBytes: number;
  projectRoot: string;
  relativePath?: string;
  staged: boolean;
}): Promise<{ diff: string; truncated: boolean }> {
  const args = ['diff', '--no-ext-diff'];
  if (options.staged) {
    args.push('--cached');
  }

  if (options.relativePath) {
    args.push('--', options.relativePath);
  }

  const output = await collectProcessOutput('git', args, {
    cwd: options.projectRoot,
    maxOutputBytes: options.maxBytes,
  });

  if (output.exitCode !== 0) {
    throw new Error(output.stderr.trim() || `git diff exited with code ${output.exitCode}.`);
  }

  return {
    diff: output.stdout,
    truncated: output.truncated,
  };
}

async function runAllowlistedCommand(
  command: string,
  projectRoot: string,
  maxBytes: number,
): Promise<{ exitCode: number | null; stderr: string; stdout: string; truncated: boolean }> {
  const commandSpec = resolveAllowedCommand(command);
  if (!commandSpec) {
    throw new Error(`Command is not allowlisted: ${command}`);
  }

  return collectProcessOutput(commandSpec.executable, commandSpec.args, {
    cwd: projectRoot,
    maxOutputBytes: maxBytes,
  });
}

function resolveAllowedCommand(command: string): null | { args: string[]; executable: string } {
  switch (command) {
    case 'pnpm test':
      return { executable: 'pnpm', args: ['test'] };
    case 'pnpm build':
      return { executable: 'pnpm', args: ['build'] };
    case 'pnpm lint':
      return { executable: 'pnpm', args: ['lint'] };
    case 'git status --short':
      return { executable: 'git', args: ['status', '--short'] };
    default:
      return null;
  }
}

function parseRipgrepLine(projectRoot: string, line: string): SearchMatch | null {
  const firstColon = line.indexOf(':');
  if (firstColon === -1) {
    return null;
  }

  const secondColon = line.indexOf(':', firstColon + 1);
  if (secondColon === -1) {
    return null;
  }

  const absoluteFile = line.slice(0, firstColon);
  const lineNumber = Number(line.slice(firstColon + 1, secondColon));
  if (!Number.isInteger(lineNumber)) {
    return null;
  }

  return {
    file: path.relative(projectRoot, absoluteFile) || '.',
    line: lineNumber,
    text: line.slice(secondColon + 1),
  };
}

function collectProcessOutput(
  command: string,
  args: string[],
  options: { cwd: string; maxOutputBytes: number },
): Promise<{ exitCode: number | null; stderr: string; stdout: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      if (stdout.length >= options.maxOutputBytes) {
        truncated = true;
        return;
      }

      stdout += chunk;
      if (stdout.length > options.maxOutputBytes) {
        stdout = stdout.slice(0, options.maxOutputBytes);
        truncated = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to run ${command}. Is ripgrep installed? ${error.message}`));
    });

    child.on('close', (exitCode) => {
      resolve({ exitCode, stderr, stdout, truncated });
    });
  });
}

function getString(args: JsonObject, key: string, options: { allowEmpty?: boolean } = {}): string {
  const value = args[key];
  if (typeof value !== 'string' || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`Expected non-empty string argument "${key}".`);
  }

  return value;
}

function getOptionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected optional argument "${key}" to be a non-empty string.`);
  }

  return value;
}

function getOptionalInteger(
  args: JsonObject,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected optional argument "${key}" to be an integer between ${min} and ${max}.`);
  }

  return value;
}

function getOptionalBoolean(args: JsonObject, key: string, defaultValue: boolean): boolean {
  const value = args[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`Expected optional argument "${key}" to be a boolean.`);
  }

  return value;
}

function getStringArray(args: JsonObject, key: string, minItems: number, maxItems: number): string[] {
  const value = args[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected argument "${key}" to be an array.`);
  }

  if (value.length < minItems || value.length > maxItems) {
    throw new Error(`Expected argument "${key}" to contain between ${minItems} and ${maxItems} items.`);
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(`Expected "${key}[${index}]" to be a non-empty string.`);
    }

    return item;
  });
}

function countOccurrences(input: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (true) {
    const nextIndex = input.indexOf(search, index);
    if (nextIndex === -1) {
      return count;
    }

    count += 1;
    index = nextIndex + search.length;
  }
}

export function jsonStringifyResult(value: JsonValue): string {
  return JSON.stringify(value);
}
