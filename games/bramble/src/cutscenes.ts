import { call, easeOut, sequence, tween, wait, type Sequence } from "@tsengine/runtime";

/** No cutscene: a sequence with nothing in it, already done. What a component's cutscene field starts as. */
export function noCutscene(): Sequence {
  return sequence([]);
}

/** How long the cave's cutscene holds the world: its waits and its tween, added up. */
export const CAVE_INTRO_SECONDS = 0.4 + 1.2 + 1.8;

/**
 * The first time the character steps into the cave: the world waits while the lantern's light grows out of the dark, a line says what
 * it is for, and play goes on. `light` sets how far the lantern reaches (0 to 1 of its full radius) and `say` the line ("" for none).
 */
export function caveIntro(light: (reach: number) => void, say: (line: string) => void): Sequence {
  return sequence([
    call(() => light(0)),
    wait(0.4),
    tween(1.2, light, easeOut),
    call(() => say("The lantern pushes the dark back.")),
    wait(1.8),
    call(() => say("")),
  ]);
}
