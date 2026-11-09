import { useState, useUpdate, useInput, useSound, clamp, Entity, Sprite, Collider } from "@rge/runtime/jsx";

function Hero() {
  const [health, setHealth] = useState(100);
  const [poisoned, setPoisoned] = useState(false);
  // A sound is played by calling the function in a handler; it happens at once and renders nothing.
  const playHurt = useSound("hurt.wav");

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

  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
      <Collider
        width={16}
        height={24}
        onCollisionEnter={() => {
          playHurt();
          setHealth((h) => h - 10);
          setPoisoned(true);
        }}
      />
    </Entity>
  );
}
