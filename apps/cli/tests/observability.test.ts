import { describe, expect, test } from "bun:test";
import { Effect, Layer, References } from "effect";
import { Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import { DebugFlag, DebugLayer } from "../src/observability.ts";

const capturingFetch = (): {
  fetch: typeof fetch;
  urls: () => ReadonlyArray<string>;
} => {
  const requested: Array<string> = [];
  const fetchFn = ((input: string | URL) => {
    requested.push(String(input));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, urls: () => requested };
};

/**
 * Runs a throwaway command wired with DebugFlag/DebugLayer, capturing the
 * MinimumLogLevel the handler observes. `mockFetch` stands in for the
 * network so OTLP exports (if any) never leave the process; use
 * `capturingFetch()`'s `urls()` to inspect what was requested. The handler
 * emits a debug log so the OTLP logger has a real signal to flush when the
 * debug layer is active, and wraps in a span so the OTLP tracer always has
 * something to export even when an explicit --log-level filters the debug
 * log out (tracing is independent of the log level).
 */
const runDebugTestCommand = (
  args: ReadonlyArray<string>,
  mockFetch: typeof fetch,
): Promise<string> => {
  const captured: Array<string> = [];

  const command = Command.make("test", {}, () =>
    Effect.gen(function* () {
      captured.push(yield* References.MinimumLogLevel);
      yield* Effect.logDebug("debug observability test");
    }).pipe(Effect.withSpan("test-command")),
  ).pipe(Command.withGlobalFlags([DebugFlag]), Command.provide(DebugLayer));

  const runCommand = Command.runWith(command, { version: "0.0.0" });

  return Effect.runPromise(
    runCommand(args).pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, mockFetch)),
        ),
      ),
    ),
  ).then(() => captured[0]!);
};

describe("DebugLayer", () => {
  test("without --debug: makes no OTLP requests and leaves log level at the default", async () => {
    const { fetch: mockFetch, urls } = capturingFetch();
    const level = await runDebugTestCommand([], mockFetch);
    expect(urls()).toEqual([]);
    expect(level).toBe("Info");
  });

  test("with --debug: exports to OTLP and raises log level to Debug", async () => {
    const { fetch: mockFetch, urls } = capturingFetch();
    const level = await runDebugTestCommand(["--debug"], mockFetch);
    expect(urls().length).toBeGreaterThan(0);
    expect(level).toBe("Debug");
  });

  test("with --debug --log-level warn: explicit log level wins, export still happens", async () => {
    const { fetch: mockFetch, urls } = capturingFetch();
    const level = await runDebugTestCommand(
      ["--debug", "--log-level", "warn"],
      mockFetch,
    );
    expect(urls().length).toBeGreaterThan(0);
    expect(level).toBe("Warn");
  });
});
