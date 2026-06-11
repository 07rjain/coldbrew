# Security Policy

Coldbrew lets a model request local filesystem reads and edits. Treat new capabilities carefully.

## Supported Versions

Security fixes are accepted for the current `main` branch.

## Reporting A Vulnerability

Please open a private security advisory if the repository host supports it. If not, contact the maintainer privately before posting exploit details in a public issue.

Include:

- affected version or commit
- reproduction steps
- expected and actual behavior
- impact and suggested fix, if known

## Current Safety Boundaries

- Tools are scoped to `projectRoot`.
- Path escapes are rejected.
- Reads have a size limit.
- Binary-looking files are rejected.
- `edit_file` is dry-run by default.
- Writes require `--allow-edits`.
- Arbitrary shell command execution is not available. `run_command` supports only a small hardcoded verification allowlist.

These controls reduce risk but do not make this a full sandbox.

## Maintainer Guidance

Do not expand command execution, shell execution, network mutation tools, destructive file operations, or credential-reading tools without:

- explicit approval gates
- tests for denied and allowed paths
- documentation of risk
- clear default-off behavior
