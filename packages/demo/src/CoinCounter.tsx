import { Text } from "@rge/runtime/jsx";

import { useGame } from "./GameState.ts";

/** Shows the coin count. It reads one leaf of the game's state, which the player's action changes: neither knows the other exists. */
export function CoinCounter() {
  const coins = useGame((s) => s.stats.coins);

  return (
    <Text size={16} color="gold">
      Coins: {coins}
    </Text>
  );
}
