import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The box a conversation is in: the speaker, and the page wrapped to the box, typing itself out (the rules count the characters). */
export function Dialogue() {
  const speaker = useGame((s) => s.view.dialogue.name);
  const page = useGame((s) => s.view.dialogue.page);
  const shown = useGame((s) => s.view.dialogue.shown);
  const more = useGame((s) => s.view.dialogue.more);
  return (
    <Entity name="Dialogue" transform={{ x: 4, y: 126 }}>
      <Shape kind="rect" width={312} height={50} color="#10131ce6" />
      <Text transform={{ x: 6, y: 3 }} size={10} color="#e8d9a8" text={speaker} />
      <Text transform={{ x: 6, y: 16 }} size={10} color="#ffffff" maxWidth={300} lineGap={1} reveal={shown} text={page} />
      <Text transform={{ x: 300, y: 38 }} size={10} color="#e8d9a8" text={more} />
    </Entity>
  );
}
