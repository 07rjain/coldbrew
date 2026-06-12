# Changelog

## 0.1.0

- Initial Coldbrew LLMlibrary-backed coding-agent CLI.
- Added guarded filesystem tools: `list_files`, `list_tree`, `search_files`, `git_diff`, `run_command`, `read_file`, `read_many_files`, `write_file`, `edit_file`, and `apply_patch`.
- Made write/edit/patch tools enabled by default, with `--dry-run` opt-out for previews.
- Added interactive chat mode through the `coldbrew` command.
- Switched interactive follow-up prompts to one LLMlibrary conversation.
- Patched LLMlibrary's OpenAI adapter so assistant conversation history is serialized as `output_text` on follow-up turns.
- Added interactive `:allow-edits`, `:dry-run`, `:status`, and `:clear` commands.
- Added developer, contributing, and security documentation.
