import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { slotsOf } from "./rules/run.ts";

/** Eight slots in two rows, filled in order: a dark square, and, when it holds something, its name and count. */
export function Inventory() {
  const run = useGame((s) => s.run);
  return (
    <Entity>
      {slotsOf(run).map((slot) => (
        <Entity key={slot.id} name="Slot" transform={{ x: slot.x, y: slot.y }}>
          <Shape kind="rect" width={42} height={36} color="#1b2036" />
          {slot.filled && (
            <>
              <Text transform={{ x: 3, y: 4 }} size={10} color="#e8d9a8">{slot.name}</Text>
              <Text transform={{ x: 3, y: 20 }} size={10} color="#a7b0c8">{slot.label}</Text>
            </>
          )}
        </Entity>
      ))}
    </Entity>
  );
}
