import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { JsonObject, JsonValue, ToolDefinition } from './types.js';

const DEFAULT_MAX_READ_BYTES = 512_000;
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
        const filePath = await resolveInsideProject(projectRoot, file);
        const stat = await fs.stat(filePath);

        if (!stat.isFile()) {
          throw new Error(`${file} is not a file.`);
        }

        if (stat.size > maxReadBytes) {
          throw new Error(`${file} is ${stat.size} bytes, above the ${maxReadBytes} byte limit.`);
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

function getString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string argument "${key}".`);
  }

  return value;
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
