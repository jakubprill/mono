import { describe, expect, test } from "@effect/vitest";
import { Schema } from "effect";
import { RawTransition, toTransition } from "../src/Transition.ts";

const decodeRawTransition = Schema.decodeSync(RawTransition);

describe("toTransition", () => {
  test("maps id, action name, and destination status name", () => {
    const raw = decodeRawTransition({
      id: "21",
      name: "Start Progress",
      to: { name: "In Progress" },
    });

    const transition = toTransition(raw);

    expect(transition.id).toBe("21");
    expect(transition.name).toBe("Start Progress");
    expect(transition.toStatus).toBe("In Progress");
  });

  test("maps a transition whose action name matches its destination status name", () => {
    const raw = decodeRawTransition({
      id: "31",
      name: "Done",
      to: { name: "Done" },
    });

    const transition = toTransition(raw);

    expect(transition.name).toBe("Done");
    expect(transition.toStatus).toBe("Done");
  });
});
