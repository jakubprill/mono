# Work Start + Config File — Design

**Date:** 2026-07-04
**Status:** Draft

## Objective

`mono-cli` up to now only proved out the Jira integration concept (issue
view/move). The tool is meant to become a broader, multi-purpose CLI for
frontend dev workflows — starting with the piece that needs the least new
infrastructure to prove out: starting work on a Jira issue (branch + status
transition), driven by a per-project config file.

This iteration is deliberately narrowed to `work start` and the config file
mechanism it depends on. AI-assisted commit messages, the MCP server, and
the multi-provider AI abstraction from the earlier draft of this design are
real future needs, but they're a separate, independent slice (git diff +
Jira + an LLM call) that doesn't need to block this one — deferred until
after `work start` and the config file are in place.

## Scope

- `mono-cli work start <KEY>` — start work on a Jira issue: pick a base
  branch, create a new branch from a configurable template, transition the
  Jira issue to a configured status.
- New config mechanism, `mise`-style: a global user config
  (`~/.config/mono/config.json`) plus a per-project config
  (`mono.config.json`, discovered by walking up to the repo root), merged
  together — validated with Effect Schema, with a generated JSON Schema for
  editor autocompletion.

`start` lives under a new `work` command group rather than `git`, because
it orchestrates across git + Jira — it isn't a pure git operation. This
keeps `git` and `jira` free for future commands that are genuinely
single-domain (e.g. general git helpers, `jira issue create`). `work` is
expected to gain `commit` (and possibly others) later.

**Out of scope (explicitly deferred):**

- `mono-cli work commit`, `@mono/ai`, the `mono-cli mcp` server, and the
  `get_commit_context` tool — the whole AI-assisted-commit slice, taken up
  as its own design once `work start` and the config file are in place
- `mr create` / GitLab MR generation and creation
- General-purpose git helper commands (status, sync, cleanup)
- Plugin architecture (built-in vs. org-private plugins like `pm`) —
  revisited separately later
- Git worktree mode for `work start` (plain branch checkout only, for now)
- Non-interactive `work start` for CI/scripted use
- Import linter for monorepo import rules

## Architecture

```
packages/
  git/                      new @mono/git — pure git operations (Bun.$ under the hood)
    src/GitClient.ts          currentBranch, createBranch(name, base), defaultRemoteBranch
    src/errors.ts
  jira/                     existing, unchanged — reuses getIssue/getTransitions/transitionIssue

apps/cli/src/
  config/                   new — mono.config.json + global config: Schema, loader, JSON Schema generator
    Config.ts                 Effect Schema.Class for the config shape + defaults
    loadConfig.ts              finds global + project config, decodes, deep-merges
    schema.ts                  generates JSON Schema from Config.ts, backs `mono-cli config schema`
  work/
    command.ts                `work` group: withSubcommands([startCommand])
    start.ts                  `start <key>` — orchestrates GitClient + JiraClient + config
```

`@mono/git` is a package for the same reason `@mono/jira` is: a clean,
testable, non-CLI-specific concern, potentially reusable outside the CLI
later. `config/` and the `start` orchestration stay inside `apps/cli`,
since nothing outside this app consumes them yet (YAGNI) — `diffCached`
and `log(range)` are dropped from `GitClient` for now since only the
(deferred) commit slice needs them; they'll be added back with that
design.

## Configuration

### Two tiers, `mise`-style

The config directory and file are named `mono`, not `mono-cli` — the CLI is
one client of this config, and it's meant to stay reusable if a web client
shows up later.

- **Global** — `$XDG_CONFIG_HOME/mono/config.json` (falls back to
  `~/.config/mono/config.json` if `XDG_CONFIG_HOME` is unset). Holds
  user-wide defaults that apply across every project (e.g. a personal
  preferred base branch order). Optional — no file means no global
  overrides.
- **Project** — `mono.config.json`, discovered by walking up from the
  current working directory (same strategy as `tsconfig.json`/`package.json`
  resolution), stopping at the first git repo root it crosses (found via
  `git rev-parse --show-toplevel`) — so a config file outside the current
  repo is never picked up by accident, and the command works from any
  subdirectory of the project.

`loadConfig` reads both (either or both may be absent), decodes each
against the same `Config` schema, and deep-merges them field by field with
**project values winning** over global on conflicts (e.g. global sets
`git.baseBranches`, project overrides just `jira.startTransitionStatus` —
both apply; if project also sets `git.baseBranches`, project's list wins
outright, it doesn't concatenate with global's). Neither file existing is
valid — every field then falls back to its in-code default; `work start`
still works with zero configuration (base branch prompt uses only the
autodetected remote default, branch template is `"{key}-{slug}"`, Jira
transition step is skipped).

### Shape

Same shape for both tiers:

```json
{
  "$schema": "./.mono/schema.json",
  "git": {
    "baseBranches": ["main", "develop"],
    "branchTemplate": "{type}/{key}-{slug}",
    "issueTypeAliases": { "Bug": "bugfix" }
  },
  "jira": {
    "startTransitionStatus": "In Progress"
  }
}
```

- `git.baseBranches` — optional. If missing/empty, `work start` skips the
  prompt and uses the autodetected remote default branch directly.
- `git.branchTemplate` — placeholders `{type}`, `{key}`, `{slug}`. Default
  if the config file or field is absent: `"{key}-{slug}"`. `{type}`
  defaults to the lowercased Jira issue type name; `issueTypeAliases`
  overrides specific types.
- `jira.startTransitionStatus` — optional. If absent, `work start` skips
  the Jira transition step entirely (branch is still created).

Every top-level section and every field within it is optional — a partial
or empty (`{}`) config file is valid, decoding to all-defaults.

### Schema validation and editor autocompletion

`Config.ts` defines the shape as an Effect `Schema.Class` (mirroring how
`Transition`/`Issue` are defined in `@mono/jira`). `loadConfig.ts` decodes
each file it finds (global, project) against this schema independently
before merging; a malformed file (bad JSON, wrong field types, unknown
keys) fails with a message naming both the offending field and which of
the two files it came from — same posture as existing Jira error handling
(`JiraAuthError`-style tagged errors), not a stack trace.

`mono-cli config schema` derives a JSON Schema from `Config.ts` (via
Effect's `JsonSchema` module — same one `effect/unstable/ai` uses
internally for tool parameters) and writes it to `.mono/schema.json` in the
current project. The config file's `$schema` field points at that
generated file so editors (VS Code, etc.) offer autocompletion and inline
validation. This is a one-time/occasional command a user runs after
changing `mono-cli` versions — not invoked automatically by `work start`,
so config loading never has a surprising side effect of writing files.

## Flow: `mono-cli work start <KEY>`

```
1. load config (missing → defaults)
2. yield* JiraClient.getIssue(KEY)              // summary + issue type
3. base branch:
     --source/-s given?              → use it directly
     else config.git.baseBranches non-empty? → Prompt.select from that list
     else                            → GitClient.defaultRemoteBranch(), no prompt
4. slug = slugify(issue.summary)
   type  = issueTypeAliases[issue.type] ?? lowercase(issue.type)
   name  = render(branchTemplate, { type, key: KEY, slug })
5. GitClient.createBranch(name, base)            // git checkout -b <name> <base>
6. if jira.startTransitionStatus is configured:
     transitions = yield* JiraClient.getTransitions(KEY)
     target = transitions.find(t => t.toStatus === startTransitionStatus)
     no match  → Console.error listing available statuses; branch stays created (not rolled back)
     match     → JiraClient.transitionIssue(KEY, target.id)
7. Console.log(`Created ${name} from ${base}, ${KEY} → ${startTransitionStatus}`)
```

A failure in step 6 does not roll back the created branch — the user
still wants to start working; the Jira status change is a side effect, not
a precondition.

## Testing

**`packages/git` (`@effect/vitest`):**
- `currentBranch` — returns branch name, run against a real temporary git
  repo (tmp dir + `git init`), not mocked — cheaper and more reliable than
  mocking the `git` binary for a thin CLI wrapper
- `createBranch(name, base)` — creates a branch from the given base; error
  when base doesn't exist
- `defaultRemoteBranch` — reads `refs/remotes/origin/HEAD`; no remote →
  clear error

**`apps/cli/src/config`:**
- `loadConfig` — only project file → its values + defaults for the rest;
  only global file → same; both present → project wins per-field on
  conflicts, non-conflicting fields from each still apply; neither present
  → all defaults; malformed JSON / wrong field type in either file → clear
  error naming the field and which file
- project file discovery — finds config in cwd; finds it when invoked from
  a subdirectory (walks up); does not cross the git repo root boundary
- global file discovery — reads from `$XDG_CONFIG_HOME/mono/config.json`
  when set, else `~/.config/mono/config.json`
- `schema.ts` — snapshot of the JSON Schema generated from `Config.ts`

**`apps/cli/src/work`:**
- `start.ts` — orchestration with fake `GitClient`/`JiraClient` test
  layers: happy path with `--source`; happy path with prompt (config list
  non-empty); happy path with no config (autodetected base, default
  template, no transition); missing `startTransitionStatus` → transition
  skipped with a warning; no matching status → branch still created with a
  clear message listing available statuses

## Out of scope (explicitly deferred)

- `mono-cli work commit`, `@mono/ai`, `mono-cli mcp` server, and the
  `get_commit_context` tool
- `mr create` and GitLab MR generation/creation
- General git helper commands (status, sync with main, post-merge cleanup)
- Plugin architecture (built-in vs. private org plugins like `pm`)
- Git worktree mode for `work start`
- Non-interactive `work start` for CI/scripts
- Import linter for monorepo import rules
