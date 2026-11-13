import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { dialogueOf } from "./rules/view.ts";

/** The box a conversation is in: the speaker, and the page wrapped to the box, typing itself out (the rules count the characters). */
export function Dialogue() {
  const run = useGame((s) => s.run);
  const { name, page, shown, more } = dialogueOf(run);
  return (
    <Entity x={4} y={126}>
      <Shape kind="rect" width={312} height={50} color="#10131ce6" />
      <Text x={6} y={3}>{name}</Text>
      <Text x={6} y={16} color="#ffffff" maxWidth={300} lineGap={1} reveal={shown}>{page}</Text>
      <Text x={300} y={38}>{more}</Text>
    </Entity>
  );
}
