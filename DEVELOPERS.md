# Coldbrew Developer Guide

This project is a small LLMlibrary-backed coding agent CLI. It is intentionally simple: the model can ask for local function tools, LLMlibrary manages the conversation/tool loop, and Coldbrew executes guarded local tools.

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
coldbrew --dry-run "Preview a README.md update"
pnpm coldbrew "Run from source with tsx"
```

## Architecture

Main modules:

- `src/cli.ts`: command-line interface, banner, interactive chat mode, argument parsing, progress rendering.
- `src/openai-agent.ts`: LLMlibrary client/session setup, conversation creation, model registration fallback, and tool instrumentation.
- `src/fs-tools.ts`: local filesystem tools and path safety checks.
- `src/types.ts`: shared JSON, tool, agent option, and progress event types.

The loop is:

1. User enters a task.
2. CLI calls `runOpenAICodingAgent()`.
3. LLMlibrary sends the prompt and available canonical tools to the selected provider.
4. If the model returns a tool call, LLMlibrary dispatches the matching local tool.
5. LLMlibrary appends the tool result and continues the model/tool loop.
6. The loop repeats until the model returns text with no tool calls.

Interactive mode keeps one LLMlibrary `Conversation` alive so follow-up prompts can refer to prior turns. It does not persist memory after the process exits.

## Safety Model

Filesystem tools are intentionally constrained:

- Paths are resolved under `projectRoot`.
- Path escapes are rejected.
- Reads have a size limit.
- Binary-looking files are rejected.
- Search uses `rg` without a shell, with capped result count and output size.
- Git diff uses `git diff` without a shell, with optional path scoping and capped output.
- Command execution is allowlisted to `pnpm test`, `pnpm build`, `pnpm lint`, and `git status --short`.
- Tree listing is depth-limited, entry-limited, and skips generated/vendor directories.
- Common generated/vendor directories are hidden from `list_files`.
- `edit_file` supports dry-run mode.
- `write_file` supports dry-run mode and refuses existing files unless `overwrite=true`.
- `apply_patch` validates patch paths and runs `git apply --check`; applying is skipped in dry-run mode.
- Writes are enabled by default; use `--dry-run` or `:dry-run` for previews.
- `edit_file` only replaces text when `oldText` occurs exactly once.

Interactive users can return to dry-run mode with `:dry-run` and re-enable write access with `:allow-edits`.

This is not a full sandbox. Do not expand command execution, shell execution, or network tools without an explicit approval model and tests.

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

`src/openai-agent.ts` uses `LLMClient.fromEnv()` and `client.conversation()` from `unified-llm-client`. Tools are declared with LLMlibrary's `defineTool()` helper in `src/fs-tools.ts`.

Model switching is controlled by `--model` or `OPENAI_MODEL`. LLMlibrary's model registry is used when the model is known; Coldbrew registers an OpenAI-compatible fallback for unknown model IDs so model sweeps can still run.

Coldbrew passes `maxTokens` into the LLMlibrary conversation and defaults it to `16000`. This is intentionally higher than LLMlibrary's generic client default because coding-agent tool calls often need to carry complete file contents in `write_file` arguments.

The repository also carries a pnpm patch for `unified-llm-client` until the upstream package includes the same OpenAI adapter fixes:

- assistant history text is serialized as `output_text`
- incomplete OpenAI function calls are treated as `length` finishes instead of parsing truncated JSON arguments

## Release Notes For Maintainers

Before publishing or tagging:

```bash
pnpm test
pnpm build
coldbrew --help
```

Also verify one write-capable live task and one dry-run edit task.
