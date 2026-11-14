import { useMutable, Entity, Sprite, Collider } from "@rge/runtime/jsx";
import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const s = useMutable({ health: 100 });
  return (
    <Entity>
      <Sprite image={s.health > 50 ? "normal.png" : "hurt.png"} />
      <Collider width={16} height={24} />
      {s.health < 25 && <WarningIcon />}
    </Entity>
  );
}
