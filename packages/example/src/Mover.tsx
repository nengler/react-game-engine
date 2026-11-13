import { useState, useUpdate, Entity, Sprite } from "@rge/runtime/jsx";

function Mover() {
  const [x, setX] = useState(0);

  useUpdate((dt) => {
    setX((previous) => previous + 60 * dt);
  });

  return (
    <Entity transform={{ x, y: 0 }}>
      <Sprite image={x > 100 ? "run.png" : "idle.png"} />
    </Entity>
  );
}
