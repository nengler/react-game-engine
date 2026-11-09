import { useGameState, Text } from "@rge/runtime/jsx";

/** Shows the coin count. It reads the game's `coins`, which the player sets: neither knows the other exists. */
export function Hud() {
  const [coins] = useGameState("coins");

  return (
    <Text size={16} color="gold">
      Coins: {coins}
    </Text>
  );
}
