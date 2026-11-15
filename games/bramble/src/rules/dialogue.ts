/**
 * What people say: a list of pages per person per state. A person's state changes once, when the bell nearest them is rung
 * (picked up); before that they say the first list, after it the second. No branching.
 */
export type NpcId = "guide" | "gardener" | "hermit" | "keeper";

export interface NpcLines {
  /** The name shown over the box. */
  readonly name: string;
  /** Pages said before the nearest bell is found, then after. */
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export const DIALOGUE: Readonly<Record<NpcId, NpcLines>> = {
  guide: {
    name: "Wren",
    before: [
      "The valley went quiet when the bells stopped.",
      "There is a lantern in the grass behind me. The cave to the east is dark without it.",
    ],
    after: ["You found the cave's bell! I can hear it from here.", "A key was in there too, wasn't it? The old house will want it."],
  },
  gardener: {
    name: "Moss",
    before: ["The house is locked, and I lost the key years ago.", "Try the cave. Things get lost there."],
    after: ["The house bell! It hums again.", "Take the shears I left inside: the hedge maze is thick with bushes."],
  },
  hermit: {
    name: "Fern",
    before: ["The maze has a bell at its heart.", "Bushes block the way. You need something sharp."],
    after: ["Three bells now? Then the gate will open.", "Ring them at the gate in the north."],
  },
  keeper: {
    name: "Gatekeeper",
    before: ["The gate opens for three bells, no fewer.", "One in the cave, one in the house, one in the maze."],
    after: ["All three! Go on, step up to the gate."],
  },
};

/** Which bell (by pickup id) decides each person's state. `keeper` waits for all three. */
export const NEAREST_BELL: Readonly<Record<NpcId, readonly string[]>> = {
  guide: ["bell-cave"],
  gardener: ["bell-house"],
  hermit: ["bell-maze"],
  keeper: ["bell-cave", "bell-house", "bell-maze"],
};
