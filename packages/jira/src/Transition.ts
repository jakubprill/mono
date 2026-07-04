import { Schema } from "effect";

class RawTransitionTo extends Schema.Class<RawTransitionTo>("RawTransitionTo")({
  name: Schema.String,
}) {}

export class RawTransition extends Schema.Class<RawTransition>("RawTransition")(
  {
    id: Schema.String,
    name: Schema.String,
    to: RawTransitionTo,
  },
) {}

export class RawTransitionsResponse extends Schema.Class<RawTransitionsResponse>(
  "RawTransitionsResponse",
)({
  transitions: Schema.Array(RawTransition),
}) {}

export class Transition extends Schema.Class<Transition>("Transition")({
  id: Schema.String,
  name: Schema.String,
  toStatus: Schema.String,
}) {}

export const toTransition = (raw: RawTransition): Transition =>
  new Transition({ id: raw.id, name: raw.name, toStatus: raw.to.name });
