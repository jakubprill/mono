# mono

Bun monorepo with Effect TypeScript.

## Structure

```
apps/
  cli/       — @mono/cli, Effect-based CLI app
packages/    — shared packages
```

## Requirements

- [mise](https://mise.jdx.dev) — manages Bun, Biome, Lefthook versions

```bash
mise install
```

## Setup

```bash
bun install
```

## Scripts

| Command | Description |
|---|---|
| `bun run lint` | Lint all workspaces |
| `bun run typecheck` | Typecheck all workspaces |
| `bun run test` | Test all workspaces |

## Apps

### `@mono/cli`

```bash
cd apps/cli
bun run dev          # development
bun run build        # compile to dist/cli binary
mise run install-cli # install binary globally as mono-cli
```
