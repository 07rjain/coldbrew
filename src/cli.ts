#!/usr/bin/env node
import 'dotenv/config';

import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { createCodingAgentSession, runOpenAICodingAgent, type CodingAgentSession } from './openai-agent.js';
import type { AgentEvent, JsonObject } from './types.js';

interface CliOptions {
  allowEdits: boolean;
  interactive: boolean;
  maxToolRounds: number;
  model: string;
  prompt?: string;
  projectRoot: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to the environment or .env.');
  }

  printBanner();
  if (options.interactive) {
    await runInteractive(options);
    return;
  }

  await runSingleTask(requirePrompt(options.prompt), options);
}

async function runSingleTask(prompt: string, options: CliOptions): Promise<string> {
  printRunConfig(prompt, options);

  const startedAt = Date.now();
  const response = await runOpenAICodingAgent(prompt, {
    ...options,
    onEvent: renderAgentEvent,
  });

  printFinalResponse(response, Date.now() - startedAt);
  return response;
}

function parseArgs(args: string[]): CliOptions {
  let allowEdits = true;
  let interactive = false;
  let maxToolRounds = 6;
  let model = process.env.OPENAI_MODEL ?? 'gpt-5.4';
  let projectRoot = process.cwd();
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === '--allow-edits') {
      allowEdits = true;
      continue;
    }

    if (arg === '--dry-run') {
      allowEdits = false;
      continue;
    }

    if (arg === '--interactive' || arg === '-i') {
      interactive = true;
      continue;
    }

    if (arg === '--model') {
      model = readOptionValue(args, ++index, '--model');
      continue;
    }

    if (arg === '--root') {
      projectRoot = path.resolve(readOptionValue(args, ++index, '--root'));
      continue;
    }

    if (arg === '--max-tool-rounds') {
      maxToolRounds = Number(readOptionValue(args, ++index, '--max-tool-rounds'));
      if (!Number.isInteger(maxToolRounds) || maxToolRounds < 0) {
        throw new Error('--max-tool-rounds must be a non-negative integer.');
      }
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    promptParts.push(arg);
  }

  const prompt = promptParts.join(' ').trim();
  interactive = interactive || prompt.length === 0;

  return {
    allowEdits,
    interactive,
    maxToolRounds,
    model,
    projectRoot,
    ...(prompt ? { prompt } : {}),
  };
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printHelp(): void {
  printBanner();
  process.stdout.write(`Usage: coldbrew [options] "task"
       coldbrew --interactive

Options:
  --dry-run                  Preview write/edit/patch tools without changing files.
  --allow-edits              Enable writes. This is the default; kept for compatibility.
  --interactive, -i          Keep the agent running for a chat-style session.
  --root <path>              Project root the tools may access. Defaults to cwd.
  --model <model>            Model id. Defaults to OPENAI_MODEL or gpt-5.4.
  --max-tool-rounds <count>  Maximum model/tool loop rounds. Defaults to 6.

Examples:
  coldbrew "List the files in this project"
  coldbrew
  > :dry-run
  > list the files in src
  > summarize README.md
  coldbrew --dry-run "Preview a README.md update"
`);
}

function printBanner(): void {
  process.stdout.write(`${style.bold}
  ____      _     _ _
 / ___|___ | | __| | |__  _ __ _____      __
| |   / _ \\| |/ _\` | '_ \\| '__/ _ \\ \\ /\\ / /
| |__| (_) | | (_| | |_) | | |  __/\\ V  V /
 \\____\\___/|_|\\__,_|_.__/|_|  \\___| \\_/\\_/
${style.reset}
`);
}

async function runInteractive(options: CliOptions): Promise<void> {
  printInteractiveConfig(options);
  const rl = createInterface({ input, output });
  const session = await createCodingAgentSession({
    ...options,
    onEvent: renderAgentEvent,
  });

  try {
    while (true) {
      const line = (await rl.question(`${style.bold}>${style.reset} `)).trim();
      if (!line) {
        continue;
      }

      if (['exit', 'quit', ':q'].includes(line.toLowerCase())) {
        process.stdout.write('bye\n');
        return;
      }

      if (handleInteractiveCommand(line, options, session)) {
        continue;
      }

      await runSessionTask(line, options, session);
    }
  } finally {
    rl.close();
  }
}

function handleInteractiveCommand(
  line: string,
  options: CliOptions,
  session: CodingAgentSession,
): boolean {
  switch (line.toLowerCase()) {
    case ':status':
      printInteractiveConfig(options);
      process.stdout.write(`${style.dim}conversation messages: ${session.messageCount()}${style.reset}\n\n`);
      return true;
    case ':allow-edits':
      options.allowEdits = true;
      process.stdout.write(`${style.warning}writes enabled for this session${style.reset}\n`);
      return true;
    case ':dry-run':
      options.allowEdits = false;
      process.stdout.write(`${style.ok}dry-run edits enabled${style.reset}\n`);
      return true;
    case ':clear':
      session.clear();
      process.stdout.write('conversation memory cleared\n');
      return true;
    default:
      return false;
  }
}

function printInteractiveConfig(options: CliOptions): void {
  const editMode = options.allowEdits
    ? `${style.warning}writes enabled${style.reset}`
    : `${style.ok}dry-run edits${style.reset}`;

  process.stdout.write(`
${style.bold}Listening${style.reset}
  model: ${options.model}
  root: ${options.projectRoot}
  mode: ${editMode}
  max tool rounds: ${options.maxToolRounds}

Type a message and press Enter.
Commands: ${style.bold}:status${style.reset}, ${style.bold}:allow-edits${style.reset}, ${style.bold}:dry-run${style.reset}, ${style.bold}:clear${style.reset}
Type ${style.bold}exit${style.reset} to quit.

`);
}

async function runSessionTask(
  prompt: string,
  options: CliOptions,
  session: CodingAgentSession,
): Promise<void> {
  printRunConfig(prompt, options);

  const startedAt = Date.now();
  const response = await session.send(prompt);

  printFinalResponse(response, Date.now() - startedAt);
}

function printRunConfig(prompt: string, options: CliOptions): void {
  const editMode = options.allowEdits
    ? `${style.warning}writes enabled${style.reset}`
    : `${style.ok}dry-run edits${style.reset}`;

  process.stdout.write(`
${style.bold}Task${style.reset}
  ${prompt}

${style.bold}Run${style.reset}
  model: ${options.model}
  root: ${options.projectRoot}
  mode: ${editMode}
  max tool rounds: ${options.maxToolRounds}

${style.bold}Agent Activity${style.reset}
`);
}

function requirePrompt(prompt: string | undefined): string {
  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  return prompt;
}

function renderAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'model_request':
      process.stdout.write(`${style.dim}[round ${event.round + 1}]${style.reset} asking model...\n`);
      return;
    case 'model_response':
      process.stdout.write(
        `${style.dim}[round ${event.round + 1}]${style.reset} model responded` +
          ` (${event.toolCallCount} tool call${event.toolCallCount === 1 ? '' : 's'})` +
          `${event.responseId ? ` ${style.dim}${event.responseId}${style.reset}` : ''}\n`,
      );
      return;
    case 'tool_start':
      process.stdout.write(
        `  ${style.accent}-> tool${style.reset} ${event.name} ${style.dim}${formatArgs(event.args)}${style.reset}\n`,
      );
      return;
    case 'tool_finish':
      process.stdout.write(
        `  ${event.ok ? style.ok : style.error}${event.ok ? 'ok' : 'fail'}${style.reset} ${event.name}\n`,
      );
      return;
  }
}

function printFinalResponse(response: string, durationMs: number): void {
  process.stdout.write(`
${style.bold}Final Answer${style.reset} ${style.dim}(${formatDuration(durationMs)})${style.reset}
${line()}
${response}
${line()}
`);
}

function formatArgs(args: JsonObject): string {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return '{}';
  }

  return entries
    .map(([key, value]) => `${key}=${formatArgValue(value)}`)
    .join(' ');
}

function formatArgValue(value: unknown): string {
  if (typeof value === 'string') {
    const collapsed = value.replace(/\s+/g, ' ');
    return JSON.stringify(collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed);
  }

  return JSON.stringify(value);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function line(): string {
  return `${style.dim}${'-'.repeat(72)}${style.reset}`;
}

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const style = {
  accent: useColor ? '\u001b[36m' : '',
  bold: useColor ? '\u001b[1m' : '',
  dim: useColor ? '\u001b[2m' : '',
  error: useColor ? '\u001b[31m' : '',
  ok: useColor ? '\u001b[32m' : '',
  reset: useColor ? '\u001b[0m' : '',
  warning: useColor ? '\u001b[33m' : '',
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
