/**
 * The battle's random numbers: the runtime's seeded generator (`roll`), kept as a plain number in the battle's state, so the same
 * seed and the same commands always play the same battle, which is what a test, a replay and the balance table rely on.
 */
import { roll, type Rolled } from "@tsengine/runtime";

export { roll, type Rolled };

/** A number in [-1, 1). */
export function rollSigned(seed: number): Rolled {
  const r = roll(seed);
  return { value: r.value * 2 - 1, seed: r.seed };
}
