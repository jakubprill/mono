# mono-cli

CLI for frontend dev workflows across git and Jira.

## Commands

- `mono-cli jira <issue> ...` — view/move Jira issues
- `mono-cli work start <KEY> [--source|-s <branch>]` — create a git branch for
  a Jira issue and (optionally) transition its status
- `mono-cli init` — set up a consumer repo: creates `mono.config.json` skeleton if
  missing, generates `.mono/schema.json`, and updates `.gitignore`

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
  "work": {
    "sourceBranches": ["main", "develop"],
    "branchPattern": "{type}/{key}-{slug}",
    "branchTypeAliases": { "Bug": "fix", "Story": "feat" },
    "startStatus": "In Progress"
  }
}
```

- `work.sourceBranches` — if non-empty, `work start` prompts you to pick one
  instead of defaulting to the remote's default branch. Ignored when
  `--source`/`-s` is passed.
- `work.branchPattern` — placeholders: `{type}` (resolved via
  `branchTypeAliases`, falling back to the Jira issue type name),
  `{key}` (the Jira issue key), `{slug}` (slugified issue summary).
- `work.branchTypeAliases` — maps a Jira issue type name to the `{type}`
  token in `branchPattern`.
- `work.startStatus` — if set, `work start` transitions the issue to this
  status name after creating the branch (skipped with a warning if no
  matching transition exists).

Run `mono-cli init` to set up your repo with `mono.config.json` and `.mono/schema.json`
for editor autocomplete via the `$schema` field.

## Debugging / Tracing

Pass `--debug` (or `-d`) to any command to raise console log verbosity to
`Debug` and export distributed traces + logs over OTLP/HTTP to a local
collector:

```bash
docker compose -f apps/cli/docker-compose.yml up -d
mono-cli work start PROJ-123 --debug
```

Then open http://localhost:16686, select the `mono-cli` service, and
inspect the trace — it shows the full call tree (Jira API calls, git
subprocess calls) with timing for each step.

- `--debug` raises the console log level to `Debug`, unless `--log-level`
  is passed explicitly (which always wins).
- The OTLP endpoint defaults to `http://localhost:4318` (matching
  `docker-compose.yml`'s Jaeger container) and can be overridden with the
  `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable.
- If the collector isn't reachable, the export fails silently in the
  background — it never blocks or fails the command itself.
