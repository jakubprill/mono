import { describe, expect, test } from "bun:test";
import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { GitClient } from "@mono/git";
import { Issue, JiraClient, Transition } from "@mono/jira";
import { type Cause, Effect, Layer, Option, Queue, Terminal } from "effect";
import { defaultConfig } from "../../src/config/Config.ts";
import { startWork } from "../../src/work/start.ts";

const issue = new Issue({
  key: "PROJ-1",
  summary: "Fix login redirect loop!",
  status: "To Do",
  assignee: null,
  description: null,
  issueType: "Bug",
});

const fakeJira = (
  overrides: {
    transitions?: ReadonlyArray<Transition>;
    onTransition?: (key: string, transitionId: string) => void;
  } = {},
) =>
  Layer.succeed(JiraClient, {
    getIssue: () => Effect.succeed(issue),
    getTransitions: () => Effect.succeed(overrides.transitions ?? []),
    transitionIssue: (key: string, transitionId: string) =>
      Effect.sync(() => {
        overrides.onTransition?.(key, transitionId);
      }),
  });

const fakeGit = (
  overrides: {
    defaultRemoteBranch?: string;
    onCreateBranch?: (name: string, base: string) => void;
  } = {},
) =>
  Layer.succeed(GitClient, {
    repoRoot: Effect.succeed("/repo"),
    currentBranch: Effect.succeed("main"),
    defaultRemoteBranch: Effect.succeed(
      overrides.defaultRemoteBranch ?? "main",
    ),
    createBranch: (name: string, base: string) =>
      Effect.sync(() => {
        overrides.onCreateBranch?.(name, base);
      }),
  });

const key = (name: string): Terminal.Key => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
});

/**
 * A fake `Terminal` whose `readInput` queue is pre-loaded with a scripted
 * sequence of key events, driving `Prompt.select`'s real cursor-movement and
 * submit logic (see `handleSelectProcess` in `effect/unstable/cli/Prompt.ts`)
 * without touching a real TTY.
 */
const fakeTerminal = (events: ReadonlyArray<Terminal.UserInput>) =>
  Layer.effect(
    Terminal.Terminal,
    Effect.sync(() =>
      Terminal.make({
        columns: Effect.succeed(80),
        rows: Effect.succeed(24),
        display: () => Effect.succeed(undefined),
        readLine: Effect.die("readLine is not supported by fakeTerminal"),
        readInput: Effect.gen(function* () {
          const queue = yield* Queue.unbounded<
            Terminal.UserInput,
            Cause.Done
          >();
          yield* Queue.offerAll(queue, events);
          return queue;
        }),
      }),
    ),
  );

describe("startWork", () => {
  test("uses --source directly, skipping the remote lookup", async () => {
    const created: Array<[string, string]> = [];
    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", defaultConfig).pipe(
        Effect.provide(fakeJira()),
        Effect.provide(
          fakeGit({
            onCreateBranch: (name, base) => created.push([name, base]),
          }),
        ),
      ),
    );
    expect(created).toEqual([["PROJ-1-fix-login-redirect-loop", "develop"]]);
    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from develop");
  });

  test("falls back to the autodetected remote default branch with no config", async () => {
    const created: Array<[string, string]> = [];
    const result = await Effect.runPromise(
      startWork("PROJ-1", undefined, defaultConfig).pipe(
        Effect.provide(fakeJira()),
        Effect.provide(
          fakeGit({
            defaultRemoteBranch: "main",
            onCreateBranch: (name, base) => created.push([name, base]),
          }),
        ),
      ),
    );
    expect(created).toEqual([["PROJ-1-fix-login-redirect-loop", "main"]]);
    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from main");
  });

  test("prompts for a base branch when config.baseBranches is non-empty, and creates the branch from the selected choice", async () => {
    const created: Array<[string, string]> = [];
    const config = {
      ...defaultConfig,
      baseBranches: ["main", "develop", "staging"],
    };

    // Script: one "down" (moves the highlighted choice from "main" to
    // "develop"), then "enter" (submits the highlighted choice). This drives
    // Prompt.select's real render/process loop end-to-end via a fake
    // Terminal, rather than sidestepping it with a pure helper.
    const events: ReadonlyArray<Terminal.UserInput> = [
      { input: Option.none(), key: key("down") },
      { input: Option.none(), key: key("enter") },
    ];

    const result = await Effect.runPromise(
      startWork("PROJ-1", undefined, config).pipe(
        Effect.provide(fakeJira()),
        Effect.provide(
          fakeGit({
            onCreateBranch: (name, base) => created.push([name, base]),
          }),
        ),
        Effect.provide(fakeTerminal(events)),
        Effect.provide(BunFileSystem.layer),
        Effect.provide(BunPath.layer),
      ),
    );

    expect(created).toEqual([["PROJ-1-fix-login-redirect-loop", "develop"]]);
    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from develop");
  });

  test("transitions the issue when a matching status is configured", async () => {
    const transitioned: Array<[string, string]> = [];
    const config = { ...defaultConfig, startTransitionStatus: "In Progress" };
    const transitions = [
      new Transition({
        id: "21",
        name: "Start Progress",
        toStatus: "In Progress",
      }),
    ];

    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", config).pipe(
        Effect.provide(
          fakeJira({
            transitions,
            onTransition: (key, transitionId) =>
              transitioned.push([key, transitionId]),
          }),
        ),
        Effect.provide(fakeGit()),
      ),
    );

    expect(transitioned).toEqual([["PROJ-1", "21"]]);
    expect(result).toBe(
      "Created PROJ-1-fix-login-redirect-loop from develop, PROJ-1 → In Progress",
    );
  });

  test("still creates the branch when no transition matches the configured status", async () => {
    const config = { ...defaultConfig, startTransitionStatus: "In Progress" };

    const result = await Effect.runPromise(
      startWork("PROJ-1", "develop", config).pipe(
        Effect.provide(fakeJira({ transitions: [] })),
        Effect.provide(fakeGit()),
      ),
    );

    expect(result).toBe("Created PROJ-1-fix-login-redirect-loop from develop");
  });
});
