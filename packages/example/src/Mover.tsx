import { useMutable, useUpdate, Entity, Sprite } from "@tsengine/runtime/jsx";

function Mover() {
  const s = useMutable({ x: 0 });

  useUpdate((dt) => {
    s.x += 60 * dt;
  });

  return (
    <Entity x={s.x} y={0}>
      <Sprite image={s.x > 100 ? "run.png" : "idle.png"} />
    </Entity>
  );
}
