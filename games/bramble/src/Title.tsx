import { Entity, Text, useInput, useMount, useState } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Menu } from "./Menu.tsx";
import { titleRows, wrap } from "./rules/menu.ts";

export function Title() {
  const hasSave = useGame((s) => s.hasSave);
  const start = useGame((s) => s.titleCursor);
  const openTitle = useGame((s) => s.openTitle);
  const choose = useGame((s) => s.choose);
  const [cursor, setCursor] = useState(0);
  const rows = titleRows(hasSave);
  useMount(() => {
    openTitle();
    setCursor(start);
  });
  useInput((input) => {
    if (input.pressed("up")) setCursor((c) => wrap(c - 1, rows.length));
    if (input.pressed("down")) setCursor((c) => wrap(c + 1, rows.length));
    if (input.pressed("confirm")) choose(rows[cursor]?.id ?? "");
  });
  return (
    <Entity name="Title">
      <Text transform={{ x: 0, y: 30 }} width={320} align="center" size={30} color="#e8d9a8" text="BRAMBLE" />
      <Menu top={90} rows={rows} cursor={cursor} />
    </Entity>
  );
}
