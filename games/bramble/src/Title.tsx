import { Entity, Text, useMount } from "@rge/runtime/jsx";

import { Choices } from "./Choices.tsx";
import { useGame } from "./GameState.ts";
import { titleRows } from "./rules/menu.ts";

export function Title() {
  const hasSave = useGame((s) => s.hasSave);
  const start = useGame((s) => s.titleCursor);
  const { openTitle, choose } = useGame.actions();
  useMount(() => openTitle());
  return (
    <Entity>
      <Text x={0} y={30} width={320} align="center" size={30}>
        BRAMBLE
      </Text>
      <Choices top={90} rows={titleRows(hasSave)} start={start} onChoose={choose} />
    </Entity>
  );
}
