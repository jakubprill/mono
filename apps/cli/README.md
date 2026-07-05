# mono-cli

CLI for frontend dev workflows across git and Jira.

## Commands

- `mono-cli jira <issue> ...` — view/move Jira issues
- `mono-cli work start <KEY> [--source|-s <branch>]` — create a git branch for
  a Jira issue and (optionally) transition its status
- `mono-cli config schema` — write a JSON Schema for `mono.config.json` to
  `<repo-root>/.mono/schema.json`

## Configuration

Config is resolved from two layers, merged field by field (project wins over
global):

1. **Global** — `$XDG_CONFIG_HOME/mono/config.json`, falling back to
   `~/.config/mono/config.json` if `XDG_CONFIG_HOME` is unset.
   `XDG_CONFIG_HOME` is the [XDG Base Directory](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html)
   convention for where user-specific config files live (used here so a
   future non-CLI client, e.g. a web app, can share the same config).
2. **Project** — `mono.config.json`, discovered by walking up from the
   current directory to the git repo root.

Both files share the same shape:

```json
{
  "$schema": "./.mono/schema.json",
  "git": {
    "baseBranches": ["main", "develop"],
    "branchTemplate": "{type}/{key}-{slug}",
    "issueTypeAliases": { "Bug": "fix", "Story": "feat" }
  },
  "jira": {
    "startTransitionStatus": "In Progress"
  }
}
```

- `git.baseBranches` — if non-empty, `work start` prompts you to pick one
  instead of defaulting to the remote's default branch. Ignored when
  `--source`/`-s` is passed.
- `git.branchTemplate` — placeholders: `{type}` (resolved via
  `issueTypeAliases`, falling back to the Jira issue type name),
  `{key}` (the Jira issue key), `{slug}` (slugified issue summary).
- `git.issueTypeAliases` — maps a Jira issue type name to the `{type}` token.
- `jira.startTransitionStatus` — if set, `work start` transitions the issue
  to this status name after creating the branch (skipped with a warning if
  no matching transition exists).

Run `mono-cli config schema` to generate a schema file and reference it via
`$schema` for editor autocomplete.
