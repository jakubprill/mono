# Work Workflow (issue start + AI commit) — Design

**Date:** 2026-07-04
**Status:** Draft

## Objective

`mono-cli` up to now only proved out the Jira integration concept (issue
view/move). The tool is meant to become a broader, multi-purpose CLI for
frontend dev workflows — starting with the piece the user needs most: tying
git branch/commit work to Jira issues, and generating an AI-assisted commit
message as a standalone terminal command.

This iteration is deliberately narrowed to just the `work` commands. The
MCP server and the multi-provider AI abstraction from the original design
are real future needs, but add architecture (a second entrypoint, a
provider-selection layer) before there's a working end-to-end flow to
build them against — deferred until `work start`/`work commit` prove out.

## Scope

New top-level commands:

- `mono-cli work start <KEY>` — start work on a Jira issue: pick a base
  branch, create a new branch from a configurable template, transition the
  Jira issue to a configured status.
- `mono-cli work commit [--issue/-i KEY]` — build a structured context
  (staged diff + linked Jira issue + project commit convention), call
  Anthropic directly, and print the generated commit message. Does not run
  `git commit`.
- New project config file `mono-cli.config.json`, validated with Effect
  Schema, with a generated JSON Schema for editor autocompletion.

Both `start` and `commit` live under a new `work` command group rather
than `git`, because both orchestrate across git + Jira (+ AI, for
`commit`) — they aren't pure git operations. This keeps `git` and `jira`
free for future commands that are genuinely single-domain (e.g. general
git helpers, `jira issue create`).

**Out of scope (explicitly deferred):**

- `mono-cli mcp` server and the `get_commit_context` MCP tool — revisited
  once `work commit` is proven out standalone
- Multi-provider AI abstraction (OpenAI/OpenRouter/compat) — `@mono/ai`
  calls Anthropic directly for now; the seam to swap providers later is
  the point where `generateCommitMessage` calls `LanguageModel`, not a
  config-driven selector
- `mr create` / GitLab MR generation and creation
- General-purpose git helper commands (status, sync, cleanup)
- Plugin architecture (built-in vs. org-private plugins like `pm`) —
  revisited separately later
- Git worktree mode for `work start` (plain branch checkout only, for now)
- Non-interactive `work start` for CI/scripted use
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
  ai/                       new @mono/ai — thin wrapper over effect/unstable/ai LanguageModel,
                               wired directly to @effect/ai-anthropic (no provider selection yet)
    src/AnthropicLayer.ts     reads ANTHROPIC_API_KEY, provides the LanguageModel layer
    src/generateCommitMessage.ts   (context, convention) => Effect<string, AiError>

apps/cli/src/
  config/                   new — mono-cli.config.json: Schema, loader, JSON Schema generator
  work/
    command.ts                `work` group: withSubcommands([startCommand, commitCommand])
    start.ts                  `start <key>` — orchestrates GitClient + JiraClient + config
    commit.ts                 `commit` — builds CommitContext, calls @mono/ai, prints result
    commit-context.ts          shared builder, used by commit.ts (and later by an MCP tool)
```

`@mono/git` and `@mono/ai` are packages because they're clean, testable,
non-CLI-specific concerns (same reasoning as `@mono/jira`) — potentially
reusable outside the CLI later. The orchestration itself (`work start`,
commit-context building) stays inside `apps/cli`, since today it only has
one consumer (this app). No second consumer exists yet, so it isn't
extracted into its own package (YAGNI); `commit-context.ts` is already
factored out as its own module so a future MCP tool can import it without
restructuring.

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

- `git.baseBranches` — optional. If missing/empty, `work start` skips the
  prompt and uses the autodetected remote default branch directly.
- `git.branchTemplate` — placeholders `{type}`, `{key}`, `{slug}`.
  Default template if the config file or field is absent: `"{key}-{slug}"`.
  `{type}` defaults to the lowercased Jira issue type name;
  `issueTypeAliases` overrides specific types.
- `jira.startTransitionStatus` — optional. If absent, `work start` skips the
  Jira transition step entirely (branch is still created).
- `ai.model` — passed to the Anthropic layer (e.g. `claude-sonnet-5`). The
  API key is always read from `ANTHROPIC_API_KEY` — never stored in the
  config file, consistent with `JIRA_TOKEN`.
- `ai.commitConvention` — free-form description + examples, injected into
  the generation prompt as style guidance.

A `mono-cli config schema` command generates the JSON Schema from the
Effect Schema definition (written to e.g. `.mono-cli/schema.json`), which
the config file's `$schema` field points to for editor autocompletion.

Missing config file or missing optional fields fall back to the defaults
described above — the config file itself is entirely optional for `work
start`/`work commit` to work in their simplest form (except the AI provider
API key, which is required for `work commit`).

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

## Flow: `mono-cli work commit`

Shared builder (`apps/cli/src/work/commit-context.ts`), factored out on its
own so a future MCP tool can reuse it without touching this flow:

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

`mono-cli work commit [--issue/-i KEY]` builds `CommitContext`, passes it
to `@mono/ai#generateCommitMessage` (Anthropic, model from config), and
`Console.log`s the resulting message only.

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
- `generateCommitMessage` — Anthropic layer swapped for a fake
  `LanguageModel` test layer (deterministic text) — verifies the prompt
  includes diff/issue/convention, not that the AI "writes well"

**`apps/cli`:**
- `config/` — decoding `mono-cli.config.json`: valid file, missing
  optional fields → defaults, invalid JSON/schema → clear error; JSON
  Schema generator — snapshot of the generated schema
- `work/start.ts` — orchestration with fake `GitClient`/`JiraClient` test
  layers: happy path; missing `startTransitionStatus` → transition skipped
  with a warning; no matching status → branch still created
- `work/commit-context.ts` — Jira key matcher: from branch name, from
  commits (when branch name doesn't match), from `--issue`, none found →
  clear failure; empty staged diff → early failure
- `work/commit.ts` — integration of builder → `generateCommitMessage` →
  `Console.log` only, no `git commit` call

## Out of scope (explicitly deferred)

- `mono-cli mcp` server and the `get_commit_context` MCP tool
- Multi-provider AI abstraction (OpenAI/OpenRouter/compat)
- `mr create` and GitLab MR generation/creation
- General git helper commands (status, sync with main, post-merge cleanup)
- Plugin architecture (built-in vs. private org plugins like `pm`)
- Git worktree mode for `work start`
- Non-interactive `work start` for CI/scripts
- Import linter for monorepo import rules
