# Coldbrew Developer Guide

This project is a small OpenAI-first coding agent CLI. It is intentionally simple: the model can ask for local function tools, the host process executes those tools, and tool results are sent back to the model until the model returns a final answer.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm test
```

Set `OPENAI_API_KEY` in your shell or `.env`.

To use the command as `coldbrew` instead of `pnpm coldbrew`:

```bash
pnpm install:cli
coldbrew
```

This writes small wrappers to `~/.local/bin/coldbrew` and `~/.local/bin/agent` by default. If your shell cannot find `coldbrew`, make sure `~/.local/bin` is on your `PATH`.

To install elsewhere:

```bash
COLDBREW_BIN_DIR=/usr/local/bin pnpm install:cli
```

## Commands

```bash
coldbrew "List files in this project"
coldbrew
coldbrew --root /path/to/project "Inspect this repo"
coldbrew --allow-edits "Update README.md"
pnpm coldbrew "Run from source with tsx"
```

## Architecture

Main modules:

- `src/cli.ts`: command-line interface, banner, interactive chat mode, argument parsing, progress rendering.
- `src/openai-agent.ts`: OpenAI Responses API loop, function-call dispatch, tool-result feedback.
- `src/fs-tools.ts`: local filesystem tools and path safety checks.
- `src/types.ts`: shared JSON, tool, agent option, and progress event types.

The loop is:

1. User enters a task.
2. CLI calls `runOpenAICodingAgent()`.
3. OpenAI receives the prompt and available function tools.
4. If the model returns `function_call`, the host executes the matching local tool.
5. The host sends `function_call_output` back to the model.
6. The loop repeats until the model returns text with no tool calls.

## Safety Model

Filesystem tools are intentionally constrained:

- Paths are resolved under `projectRoot`.
- Path escapes are rejected.
- Reads have a size limit.
- Binary-looking files are rejected.
- Search uses `rg` without a shell, with capped result count and output size.
- Common generated/vendor directories are hidden from `list_files`.
- `edit_file` is dry-run by default.
- Writes require `--allow-edits`.
- `edit_file` only replaces text when `oldText` occurs exactly once.

This is not a full sandbox. Do not add shell execution or network tools without an explicit approval model and tests.

## Adding Tools

Add tools in `src/fs-tools.ts` or a new module that returns `ToolDefinition` objects.

Each tool needs:

- `name`
- `description`
- JSON-schema-like `parameters`
- `execute(args)` function

Keep tool output structured JSON. Avoid returning huge strings unless the model needs the content.

## Testing

Run:

```bash
pnpm test
pnpm build
```

Tests currently cover filesystem tool safety and edit behavior. New tools should include tests for:

- successful execution
- invalid arguments
- path or permission boundaries
- dry-run behavior for writes
- ambiguous edit prevention
- capped search behavior
- no-result search behavior

## OpenAI API Boundary

`src/openai-agent.ts` uses the Responses API function-calling flow. The SDK's generated TypeScript unions can be narrower than the dynamic response item array we maintain locally, so casts are isolated at the `client.responses.create()` boundary.

Keep provider-specific code in `openai-agent.ts`. This makes it easier to add an LLMlibrary-backed runtime later without rewriting CLI and tool code.

## Release Notes For Maintainers

Before publishing or tagging:

```bash
pnpm test
pnpm build
coldbrew --help
```

Also verify one read-only live task and one dry-run edit task.
