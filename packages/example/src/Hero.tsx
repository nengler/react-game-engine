import { useState, useUpdate, useInput, onCollisionEnter, clamp, Entity, Sprite, Collider } from "@rge/runtime/jsx";

function Hero() {
  const [health, setHealth] = useState(100);
  const [poisoned, setPoisoned] = useState(false);

  useInput((input) => {
    if (input.pressed("Space")) {
      setHealth(100);
      setPoisoned(false);
    }
  });

  useUpdate((dt) => {
    if (poisoned) {
      setHealth((h) => clamp(h - dt * 5, 0, 100));
    }
  });

  useUpdate((dt) => {
    if (health <= 0) {
      return;
    }
    const regen = poisoned ? 0 : dt;
    setHealth((health) => Math.min(health + regen, 100));
  });

  onCollisionEnter(() => {
    setHealth((h) => h - 10);
    setPoisoned(true);
  });

  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
      <Collider width={16} height={24} />
    </Entity>
  );
}
