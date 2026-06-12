# Coldbrew

Coldbrew is a calm local coding-agent CLI inspired by Mihail Eric's article.

It uses LLMlibrary conversations with local function tools:

- `list_files`
- `list_tree`
- `search_files`
- `git_diff`
- `run_command`
- `read_file`
- `read_many_files`
- `write_file`
- `edit_file`
- `apply_patch`

Write/edit/patch tools are enabled by default. Pass `--dry-run` to preview changes without writing.

## Safety

This is a local coding-agent demo, not a full sandbox. It can read and write files under the configured project root.

Use `--dry-run` when you want read-only previews.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm install:cli
```

Set `OPENAI_API_KEY` in your environment or `.env`. Optionally set `OPENAI_MODEL`; the CLI defaults to `gpt-5.4`.

Install `rg`/ripgrep for fast code search. On macOS:

```bash
brew install ripgrep
```

After installing the wrapper, the `coldbrew` command is available from your shell. The installer also provides `agent` as a convenience alias.

By default `pnpm install:cli` writes small wrappers to `~/.local/bin/coldbrew` and `~/.local/bin/agent`. That directory is commonly on `PATH`. To choose another directory:

```bash
COLDBREW_BIN_DIR=/usr/local/bin pnpm install:cli
```

## Run

```bash
coldbrew "List the files in this project"
coldbrew "Search for createFileTools in src"
coldbrew --dry-run "Preview a README.md update"
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
:allow-edits
create the file we discussed
exit
```

Each line is sent to the same LLMlibrary conversation, so follow-up requests can refer to prior turns. Type `exit`, `quit`, or `:q` to close the session.

Interactive commands:

- `:status` - show current model/root/edit mode and memory count
- `:allow-edits` - enable writes for the current session
- `:dry-run` - return to dry-run edit mode
- `:clear` - clear conversation memory

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
