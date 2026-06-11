# Coldbrew

Coldbrew is a calm local coding-agent CLI inspired by Mihail Eric's article.

It uses the OpenAI Responses API with three local function tools:

- `list_files`
- `read_file`
- `edit_file`

Edits are dry-run by default. Pass `--allow-edits` to let `edit_file` write.

## Safety

This is a local coding-agent demo, not a full sandbox. It can read files under the configured project root, and it can edit files only when you pass `--allow-edits`.

The default mode is read-only/dry-run for edits.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm install:cli
```

Set `OPENAI_API_KEY` in your environment or `.env`. Optionally set `OPENAI_MODEL`; the CLI defaults to `gpt-5.5`.

After installing the wrapper, the `coldbrew` command is available from your shell. The installer also provides `agent` as a convenience alias.

By default `pnpm install:cli` writes small wrappers to `~/.local/bin/coldbrew` and `~/.local/bin/agent`. That directory is commonly on `PATH`. To choose another directory:

```bash
COLDBREW_BIN_DIR=/usr/local/bin pnpm install:cli
```

## Run

```bash
coldbrew "List the files in this project"
coldbrew --allow-edits "Update README.md to mention dry-run edits"
```

You can also run through pnpm during development:

```bash
pnpm coldbrew "List the files in this project"
```

Use `--root <path>` to point the tools at another project root.

## Interactive Chat Mode

Start the agent once:

```bash
coldbrew
```

Then type normally:

```text
list the files in src
summarize README.md
exit
```

Each line is sent to the agent as a new task. Type `exit`, `quit`, or `:q` to close the session.

## Verify

```bash
pnpm test
pnpm build
```

## Developer Docs

- [DEVELOPERS.md](./DEVELOPERS.md): architecture, tool loop, local command setup, and safety notes.
- [CONTRIBUTING.md](./CONTRIBUTING.md): contribution workflow and project expectations.
- [SECURITY.md](./SECURITY.md): vulnerability reporting and safety boundaries.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md): community expectations.

## License

MIT
