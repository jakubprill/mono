# mono-cli config: `work` namespace + renamed keys

## Problem

`mono.config.json` currently splits related settings across two namespaces
that mirror implementation details (`git`, `jira`) rather than the user-facing
concept they configure (`mono-cli work start`). The field names also don't
clearly convey what they do:

```json
{
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

- `git`/`jira` namespaces leak the underlying client used, not the workflow
  being configured. All four fields only affect `work start`.
- `issueTypeAliases` doesn't indicate it exists specifically to feed the
  `{type}` token in `branchTemplate`.
- `startTransitionStatus` reads awkwardly — word order obscures "the status to
  move to after start".

## Scope

Pure reshape/rename. No new behavior, no backwards-compatibility shim for the
old `git`/`jira` shape — mono-cli has no external users yet (see
`mono-cli-versioning-deferred` memory), so old config files simply fail to
decode into the new shape rather than being migrated.

## New shape

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

| Old key | New key | Rationale |
|---|---|---|
| `git.baseBranches` | `work.sourceBranches` | Matches existing `--source`/`-s` flag on `work start` — same concept, same word. |
| `git.branchTemplate` | `work.branchPattern` | "Pattern" signals a string with placeholders more clearly than "template". |
| `git.issueTypeAliases` | `work.branchTypeAliases` | These aren't generic Jira type aliases — they specifically resolve the `{type}` token in `branchPattern`. Name ties the two together. |
| `jira.startTransitionStatus` | `work.startStatus` | Word order now reads as "the status after start" instead of "the startup transition's status". |

## Code changes

### `apps/cli/src/config/Config.ts`

- Remove `GitConfig` and `JiraWorkConfig`. Add a single `WorkConfig` class
  with fields `sourceBranches`, `branchPattern`, `branchTypeAliases`,
  `startStatus` (same optionality/types as today, just renamed).
- `MonoConfig` gets a `work: Schema.optional(WorkConfig)` field replacing
  `git`/`jira`.
- `ResolvedConfig` fields renamed to match: `sourceBranches`,
  `branchPattern`, `branchTypeAliases`, `startStatus` (replacing
  `baseBranches`, `branchTemplate`, `issueTypeAliases`,
  `startTransitionStatus`). This keeps naming consistent end-to-end rather
  than translating at the JSON boundary only.
- `defaultConfig` updated to the new field names (values unchanged).
- `mergeConfig` reads `project?.work?.X ?? global?.work?.X ?? defaultConfig.X`
  for all four fields (all now under the same `work` namespace on both
  sides, instead of split across `git`/`jira`).

### `apps/cli/src/config/schema.ts` / `command.ts`

No structural changes — the JSON Schema is generated from `MonoConfig` via
`Schema.toJsonSchemaDocument`, so the new shape flows through automatically.
`$defs` will contain `WorkConfig` instead of `GitConfig`/`JiraWorkConfig`.

### `apps/cli/src/work/start.ts`

Update field references: `config.baseBranches` → `config.sourceBranches`,
`config.branchTemplate` → `config.branchPattern`,
`config.issueTypeAliases` → `config.branchTypeAliases`,
`config.startTransitionStatus` → `config.startStatus` (including the
"No transition to..." error message and the transition-target lookup).

### `apps/cli/src/work/branchName.ts`

No changes — `renderBranchName`/`resolveBranchType` take positional
params/local names (`template`, `aliases`), not tied to config field names.

### `apps/cli/README.md`

Update the "Configuration" section: JSON example and the field-by-field
bullet list to use the new `work.*` names.

## Testing

Update existing tests to the new shape/names — no new test cases needed,
since coverage (decode, merge precedence, defaults, schema generation,
start-flow) is unchanged in kind:

- `tests/config/Config.test.ts` — decode/merge tests use `work: {...}`
  and renamed fields.
- `tests/config/schema.test.ts` — expects `work` (not `git`/`jira`) in
  `MonoConfig` properties, and `WorkConfig` (not `GitConfig`/
  `JiraWorkConfig`) in `$defs`.
- `tests/config/loadConfig.test.ts` — fixture config JSON uses new shape.
- `tests/work/start.test.ts` — `ResolvedConfig` fixtures use new field names.
