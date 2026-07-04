# Git/PR Workflow (issue start + AI commit) — Design

**Date:** 2026-07-04
**Status:** Draft

## Objective

`mono-cli` up to now only proved out the Jira integration concept (issue
view/move). The tool is meant to become a broader, multi-purpose CLI for
frontend dev workflows — starting with the piece the user needs most: tying
git branch/commit work to Jira issues, and generating AI-assisted commit
messages, usable both as a standalone terminal command and as an MCP tool
for AI coding agents.

## Scope

New top-level commands:

- `mono-cli git start <KEY>` — start work on a Jira issue: pick a base
  branch, create a new branch from a configurable template, transition the
  Jira issue to a configured status.
- `mono-cli git commit [--issue/-i KEY]` — build a structured context
  (staged diff + linked Jira issue + project commit convention) and print
  an AI-generated commit message. Does not run `git commit`.
- `mono-cli mcp` — stdio MCP server exposing a `get_commit_context` tool
  that returns the same structured context, for an MCP-capable agent
  (Claude Code, etc.) to generate the message itself.
- New project config file `mono-cli.config.json`, validated with Effect
  Schema, with a generated JSON Schema for editor autocompletion.

**Out of scope (explicitly deferred):**

- `mr create` / GitLab MR generation and creation
- General-purpose git helper commands (status, sync, cleanup)
- Plugin architecture (built-in vs. org-private plugins like `pm`) —
  revisited separately later
- Git worktree mode for `git start` (plain branch checkout only, for now)
- Non-interactive `git start` for CI/scripted use
- Storing AI provider API keys anywhere other than env vars
- Import linter for monorepo import rules

## Architecture

```
packages/
  git/                      new @mono/git — pure git operations (Bun.$ under the hood)
    src/GitClient.ts          currentBranch, createBranch(name, base), diffCached,
                               defaultRemoteBranch, log(range)
    src/errors.ts
  jira/                     existing, unchanged — reuses getIssue/getTransitions/transitionIssue
  ai/                       new @mono/ai — thin wrapper over effect/unstable/ai LanguageModel
    src/AiProvider.ts         picks a LanguageModel layer (Anthropic/OpenAI/OpenRouter/compat)
                               based on config
    src/generateCommitMessage.ts   (context, convention) => Effect<string, AiError>

apps/cli/src/
  config/                   new — mono-cli.config.json: Schema, loader, JSON Schema generator
  git/
    command.ts                `git` group: withSubcommands([startCommand, commitCommand])
    start.ts                  `start <key>` — orchestrates GitClient + JiraClient + config
    commit.ts                 `commit` — builds CommitContext, calls @mono/ai, prints result
    commit-context.ts          shared builder, used by both commit.ts and mcp/tools.ts
  mcp/
    command.ts                `mono-cli mcp` — McpServer.layerStdio + toolkit
    tools.ts                   Tool.make("get_commit_context", ...) → commit-context.ts
```

`@mono/git` and `@mono/ai` are packages because they're clean, testable,
non-CLI-specific concerns (same reasoning as `@mono/jira`) — potentially
reusable outside the CLI later. The orchestration itself (`git start`,
commit-context building) stays inside `apps/cli`, since today it only has
one consumer (this app — both the CLI command and the MCP tool are the
same binary). No second consumer exists yet, so it isn't extracted into its
own package (YAGNI); the boundary is clean enough to do that later if
needed.

## Configuration

`mono-cli.config.json` (project root), validated via Effect Schema:

```json
{
  "$schema": "./.mono-cli/schema.json",
  "git": {
    "baseBranches": ["main", "develop"],
    "branchTemplate": "{type}/{key}-{slug}",
    "issueTypeAliases": { "Bug": "bugfix" }
  },
  "jira": {
    "startTransitionStatus": "In Progress"
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "commitConvention": {
      "description": "Conventional Commits, scope = affected package name",
      "examples": [
        "feat(jira): add issue transition picker",
        "fix(git): handle detached HEAD"
      ]
    }
  }
}
```

- `git.baseBranches` — optional. If missing/empty, `git start` skips the
  prompt and uses the autodetected remote default branch directly.
- `git.branchTemplate` — placeholders `{type}`, `{key}`, `{slug}`.
  Default template if the config file or field is absent: `"{key}-{slug}"`.
  `{type}` defaults to the lowercased Jira issue type name;
  `issueTypeAliases` overrides specific types.
- `jira.startTransitionStatus` — optional. If absent, `git start` skips the
  Jira transition step entirely (branch is still created).
- `ai.provider` / `ai.model` — selects the `@mono/ai` layer
  (anthropic/openai/openrouter/openai-compat). The API key is always read
  from each provider's standard env var (e.g. `ANTHROPIC_API_KEY`) —
  never stored in the config file, consistent with `JIRA_TOKEN`.
- `ai.commitConvention` — free-form description + examples, injected into
  the generation prompt as style guidance.

A `mono-cli config schema` command generates the JSON Schema from the
Effect Schema definition (written to e.g. `.mono-cli/schema.json`), which
the config file's `$schema` field points to for editor autocompletion.

Missing config file or missing optional fields fall back to the defaults
described above — the config file itself is entirely optional for `git
start`/`git commit` to work in their simplest form (except the AI provider
API key, which is required for `git commit`).

## Flow: `mono-cli git start <KEY>`

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

## Flow: `mono-cli git commit` and MCP tool `get_commit_context`

Shared builder (`apps/cli/src/git/commit-context.ts`):

```
buildCommitContext(overrideIssueKey?: string):
  diff = yield* GitClient.diffCached()
  diff empty? → fail early ("nothing staged")
  key = overrideIssueKey
        ?? matchJiraKey(yield* GitClient.currentBranch())        // regex [A-Z][A-Z0-9]*-[0-9]+
        ?? matchJiraKey(yield* GitClient.log(`${defaultBranch}..HEAD`))
        ?? (interactive ? Prompt.text("Issue key?") : fail("no issue key found, pass --issue"))
  issue = key ? yield* JiraClient.getIssue(key) : none
  convention = config.ai.commitConvention
  → CommitContext { diff, issue, convention }
```

- `mono-cli git commit [--issue/-i KEY]`: builds `CommitContext`, passes it
  to `@mono/ai#generateCommitMessage`, `Console.log`s the resulting message
  only. Provider/model come from config.
- `mono-cli mcp`: `McpServer.layerStdio` + a `Toolkit` with a single
  `Tool.make("get_commit_context", ...)`, implemented via
  `buildCommitContext`, returning the structured data (diff, issue
  summary/description, convention) as JSON — **no AI call happens here**;
  the connecting agent generates the message itself using this context.

Jira-key detection is regex-based (rather than parsing `branchTemplate`
in reverse) — Jira keys have a fixed shape (`ABC-123`) regardless of the
rest of the branch name, so there's no need to invert an arbitrary
template.

## Testing

**`packages/git` (`@effect/vitest`):**
- `currentBranch` — returns branch name, run against a real temporary git
  repo (tmp dir + `git init`), not mocked — cheaper and more reliable than
  mocking the `git` binary for a thin CLI wrapper
- `createBranch(name, base)` — creates a branch from the given base; error
  when base doesn't exist
- `diffCached` — empty diff vs. diff with content; correct parsing
- `defaultRemoteBranch` — reads `refs/remotes/origin/HEAD`; no remote →
  clear error

**`packages/ai`:**
- `generateCommitMessage` — provider swapped for a fake `LanguageModel`
  test layer (deterministic text) — verifies the prompt includes
  diff/issue/convention, not that the AI "writes well"
- provider selection by `config.ai.provider` — correct mapping to the
  right layer; error on unknown provider

**`apps/cli`:**
- `config/` — decoding `mono-cli.config.json`: valid file, missing
  optional fields → defaults, invalid JSON/schema → clear error; JSON
  Schema generator — snapshot of the generated schema
- `git/start.ts` — orchestration with fake `GitClient`/`JiraClient` test
  layers: happy path; missing `startTransitionStatus` → transition skipped
  with a warning; no matching status → branch still created
- `git/commit-context.ts` — Jira key matcher: from branch name, from
  commits (when branch name doesn't match), from `--issue`, none found →
  clear failure; empty staged diff → early failure
- `git/commit.ts` — integration of builder → `generateCommitMessage` →
  `Console.log` only, no `git commit` call
- `mcp/tools.ts` — `get_commit_context` returns the same data shape as
  `commit-context.ts` (reuses the builder, so the test mainly checks JSON
  serialization matches the Tool schema)
- Manual verification: `mono-cli mcp` actually starts and responds to
  `tools/list`/`tools/call` through a real MCP client (e.g. Claude Code
  configured locally) — not practically unit-testable

## Out of scope (explicitly deferred)

- `mr create` and GitLab MR generation/creation
- General git helper commands (status, sync with main, post-merge cleanup)
- Plugin architecture (built-in vs. private org plugins like `pm`)
- Git worktree mode for `git start`
- Non-interactive `git start` for CI/scripts
- Import linter for monorepo import rules
