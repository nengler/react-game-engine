import { useState, useRef, useUpdate, Entity, Sprite, Collider } from "@rge/runtime/jsx";

interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  onDefeated?: () => void;
}

function Enemy({ speed, tint = "red", onDefeated }: EnemyProps) {
  const [hp, setHp] = useState(3);
  const reported = useRef(false);

  useUpdate((dt) => {
    setHp((hp) => hp - dt * speed);
    if (hp <= 0 && !reported.current) {
      reported.current = true;
      onDefeated?.();
    }
  });

  return (
    <Entity name="Enemy">
      <Sprite image={tint === "red" ? "enemy-red.png" : "enemy-blue.png"} />
      <Collider width={20} height={20} />
    </Entity>
  );
}

function Level() {
  const [wave, setWave] = useState(1);
  const [score, setScore] = useState(0);
  const [bossVisible, setBossVisible] = useState(false);
  return (
    <Entity name="Level">
      <Enemy speed={wave} transform={{ x: 40 }} onDefeated={() => setScore((score) => score + 1)} />
      <Enemy speed={wave * 2} tint="blue" transform={{ x: 80 }} onDefeated={() => setScore((score) => score + 5)} />
      {wave >= 3 && <Enemy speed={wave} transform={{ x: 120 }} />}
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
        </Entity>
      )}
    </Entity>
  );
}
