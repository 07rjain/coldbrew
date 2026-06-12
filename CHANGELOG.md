# Changelog

## 0.1.0

- Initial Coldbrew OpenAI-first coding-agent CLI.
- Added guarded filesystem tools: `list_files`, `list_tree`, `search_files`, `git_diff`, `run_command`, `read_file`, `read_many_files`, `write_file`, `edit_file`, and `apply_patch`.
- Added dry-run edits by default with `--allow-edits` opt-in.
- Added interactive chat mode through the `coldbrew` command.
- Added bounded in-process conversation memory for interactive follow-up prompts.
- Added interactive `:allow-edits`, `:dry-run`, `:status`, and `:clear` commands.
- Added developer, contributing, and security documentation.
