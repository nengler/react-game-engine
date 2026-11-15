import { useMutable, useUpdate, useInput, useSound, clamp, Entity, Sprite, Collider } from "@tsengine/runtime/jsx";

function Hero() {
  const s = useMutable({ health: 100, poisoned: false });
  // A sound is played by calling the function in a handler; it happens at once and renders nothing.
  const playHurt = useSound("hurt.wav");

  useInput((input) => {
    if (input.pressed("Space")) {
      s.health = 100;
      s.poisoned = false;
    }
  });

  useUpdate((dt) => {
    if (s.poisoned) {
      s.health = clamp(s.health - dt * 5, 0, 100);
    }
  });

  useUpdate((dt) => {
    if (s.health <= 0) {
      return;
    }
    const regen = s.poisoned ? 0 : dt;
    s.health = Math.min(s.health + regen, 100);
  });

  return (
    <Entity>
      <Sprite image={s.poisoned ? "poisoned.png" : "normal.png"} />
      <Collider
        width={16}
        height={24}
        onCollisionEnter={() => {
          playHurt();
          s.health -= 10;
          s.poisoned = true;
        }}
      />
    </Entity>
  );
}
