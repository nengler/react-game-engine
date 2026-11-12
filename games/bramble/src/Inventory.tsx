import { Entity, Shape, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

interface SlotProps {
  x: number;
  y: number;
  filled: boolean;
  name: string;
  label: string;
}

/** One slot: a dark square, and, when it holds something, its name and count. (A list item's children may not hold a condition, so the item is a component.) */
function SlotBox({ x, y, filled, name, label }: SlotProps) {
  return (
    <Entity name="Slot" transform={{ x, y }}>
      <Shape kind="rect" width={42} height={36} color="#1b2036" />
      {filled && <Text transform={{ x: 3, y: 4 }} size={10} color="#e8d9a8" text={name} />}
      {filled && <Text transform={{ x: 3, y: 20 }} size={10} color="#a7b0c8" text={label} />}
    </Entity>
  );
}

/** Eight slots in two rows, filled in order; an empty slot is a dark square. */
export function Inventory() {
  const slots = useGame((s) => s.view.slots);
  return (
    <Entity name="Inventory">
      {slots.map((slot) => (
        <SlotBox key={slot.id} x={slot.x} y={slot.y} filled={slot.filled} name={slot.name} label={slot.label} />
      ))}
    </Entity>
  );
}
