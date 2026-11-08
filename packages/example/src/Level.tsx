import { useState, useRef, useUpdate, Entity, Sprite, Collider } from "@rge/runtime/jsx";
import Coin, { Trail } from "./Coin.tsx";

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

/** A record kept in array state: one per defeated enemy. */
interface Defeat {
  tint: "red" | "blue";
  wave: number;
}

function Level() {
  const [wave, setWave] = useState(1);
  const [score, setScore] = useState(0);
  // Array state is updated immutably: a setter only renders when it gets a new array.
  const [defeats, setDefeats] = useState<Defeat[]>([]);
  const bossVisible = defeats.some((d) => d.tint === "blue") && defeats.length >= 2;
  return (
    <Entity name="Level">
      <Enemy
        speed={wave}
        transform={{ x: 40 }}
        onDefeated={() => {
          setScore((score) => score + 1);
          setDefeats((list) => [...list, { tint: "red", wave }]);
        }}
      />
      <Enemy
        speed={wave * 2}
        tint="blue"
        transform={{ x: 80 }}
        onDefeated={() => {
          setScore((score) => score + 5);
          setDefeats((list) => [...list, { tint: "blue", wave }]);
        }}
      />
      {wave >= 3 && <Enemy speed={wave} transform={{ x: 120 }} />}
      <Coin value={score} transform={{ x: 160 }} />
      <Trail value={wave} transform={{ x: 200, y: 20 }} />
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
        </Entity>
      )}
    </Entity>
  );
}
