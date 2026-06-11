# Contributing

Contributions are welcome. Keep the project small, explicit, and easy to audit.

## Development Flow

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build and test:

   ```bash
   pnpm build
   pnpm test
   ```

3. Install the CLI wrapper if you want the `coldbrew` command locally:

   ```bash
   pnpm install:cli
   coldbrew --help
   ```

## Contribution Guidelines

- Keep filesystem writes opt-in.
- Add tests for new tools and safety boundaries.
- Keep provider-specific logic out of the CLI.
- Prefer structured JSON tool results over prose.
- Do not print secrets or read `.env` values directly in logs.
- Keep prompts and instructions concise.
- Avoid adding dependencies unless they remove meaningful complexity.

## Good First Issues

- Add more filesystem tests.
- Improve dry-run edit previews.
- Add a unified diff output for proposed edits.
- Add transcript logging behind an explicit flag.
- Add a mock OpenAI client test for the tool loop.

## Security Expectations

This project lets a model request local file reads and edits. Treat new capabilities carefully:

- Do not add shell command execution by default.
- Do not allow writes outside `projectRoot`.
- Do not follow user-provided paths without normalization and boundary checks.
- Do not make destructive tools available without approval gates.

## Before Opening A PR

Run:

```bash
pnpm build
pnpm test
```

Include a short summary of behavior changes and any safety implications.
