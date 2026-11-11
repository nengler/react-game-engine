/**
 * What happened in a step, as the rules report it: a jump, a landing, a dash, a death, a new room. The rules push these
 * onto an array a caller passes in (and do nothing else about them), so they stay pure for the solver and the tests, and the
 * game state turns each one into sound, dust, a shake or a freeze. `x` and `y` are in the room: where the character's feet
 * are (for a death, its middle).
 */
export type GameEvent =
  | { readonly type: "jump"; readonly x: number; readonly y: number }
  /** `wall` is the side the wall was on: -1 left, 1 right. */
  | { readonly type: "wallJump"; readonly x: number; readonly y: number; readonly wall: number }
  | { readonly type: "dash"; readonly x: number; readonly y: number }
  | { readonly type: "land"; readonly x: number; readonly y: number }
  | { readonly type: "death"; readonly x: number; readonly y: number }
  | { readonly type: "room"; readonly x: number; readonly y: number; readonly room: number };
