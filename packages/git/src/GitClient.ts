import { Effect, Layer, Stream } from "effect";
import * as Context from "effect/Context";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { GitCommandError } from "./errors.ts";

export class GitClient extends Context.Service<
  GitClient,
  {
    readonly repoRoot: Effect.Effect<string, GitCommandError>;
    readonly currentBranch: Effect.Effect<string, GitCommandError>;
    readonly defaultRemoteBranch: Effect.Effect<string, GitCommandError>;
    readonly createBranch: (
      name: string,
      base: string,
    ) => Effect.Effect<void, GitCommandError>;
  }
>()("@mono/GitClient") {
  static readonly layer = Layer.effect(
    GitClient,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner;

      const run = (
        args: ReadonlyArray<string>,
      ): Effect.Effect<string, GitCommandError> =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(ChildProcess.make("git", args));
            const [stdout, stderr, exitCode] = yield* Effect.all([
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ]);
            return {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              exitCode: Number(exitCode),
            };
          }),
        ).pipe(
          Effect.mapError(
            (error) =>
              new GitCommandError({
                command: `git ${args.join(" ")}`,
                stderr: String(error),
              }),
          ),
          Effect.flatMap(({ stdout, stderr, exitCode }) =>
            exitCode === 0
              ? Effect.succeed(stdout)
              : Effect.fail(
                  new GitCommandError({
                    command: `git ${args.join(" ")}`,
                    stderr,
                  }),
                ),
          ),
          Effect.withSpan(`git.${args[0] ?? "unknown"}`, {
            attributes: { "git.args": args.join(" ") },
          }),
        );

      const repoRoot = run(["rev-parse", "--show-toplevel"]);
      const currentBranch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
      const defaultRemoteBranch = run([
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]).pipe(Effect.map((ref) => ref.replace("refs/remotes/origin/", "")));
      const createBranch = (name: string, base: string) =>
        run(["checkout", "-b", name, base]).pipe(Effect.asVoid);

      return { repoRoot, currentBranch, defaultRemoteBranch, createBranch };
    }),
  );
}
