/**
 * The game's global state: every key `useGameState("key")` may name, with its starting value. The compiler reads this
 * file (it is never imported), so each value must be a number, string or boolean literal.
 */
export const gameState = {
  /** Coins picked up. Set by the player, shown by the HUD. */
  coins: 0,
};
