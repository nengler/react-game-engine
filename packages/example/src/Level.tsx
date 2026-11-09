import { useState, useRef, useUpdate, AnimatedSprite, Camera, Entity, Sprite, Collider, Pointer, Shape, Text } from "@rge/runtime/jsx";
import Coin, { Trail } from "./Coin.tsx";
import { Banner } from "./Banner.tsx";
import { Panel } from "./Panel.tsx";

interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  onDefeated?: () => void;
}

export function Enemy({ speed, tint = "red", onDefeated }: EnemyProps) {
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
      {/* A shape shows the collider's bounds while there is no art for it. */}
      <Shape kind="rect" width={20} height={20} color={hp <= 0 ? "gray" : "rgba(255, 0, 0, 0.3)"} />
    </Entity>
  );
}

/** A record kept in array state: one per defeated enemy. */
interface Defeat {
  tint: "red" | "blue";
  wave: number;
}

/** One live enemy: the list below keeps one <Enemy> per spawn, by `id`. */
interface Spawn {
  id: string;
  tint: "red" | "blue";
  x: number;
}

function Level() {
  const [wave, setWave] = useState(1);
  const [score, setScore] = useState(0);
  // Array state is updated immutably: a setter only renders when it gets a new array.
  const [spawns, setSpawns] = useState<Spawn[]>([
    { id: "red-1", tint: "red", x: 40 },
    { id: "blue-1", tint: "blue", x: 80 },
  ]);
  const [defeats, setDefeats] = useState<Defeat[]>([]);
  const bossVisible = defeats.some((d) => d.tint === "blue") && defeats.length >= 2;
  return (
    <Entity name="Level">
      {spawns.map((s) => (
        <Enemy
          key={s.id}
          speed={s.tint === "blue" ? wave * 2 : wave}
          tint={s.tint}
          transform={{ x: s.x }}
          onDefeated={() => {
            // `s` is the spawn's current value, looked up by its key.
            setScore((score) => score + (s.tint === "blue" ? 5 : 1));
            setDefeats((list) => [...list, { tint: s.tint, wave }]);
            setSpawns((list) => list.filter((other) => other.id !== s.id));
          }}
        />
      ))}
      {/* The camera follows its children: once the third enemy arrives the view centres on it, and zooms in from wave 6. */}
      <Camera zoom={wave > 5 ? 2 : 1}>{wave >= 3 && <Enemy speed={wave} transform={{ x: 120 }} />}</Camera>
      {/* A hit area: a press inside it calls the handler. Pair it with a Shape to draw the button. */}
      <Shape kind="rect" width={48} height={16} color="gray" transform={{ x: 160, y: 80 }} />
      <Pointer width={48} height={16} transform={{ x: 160, y: 80 }} onPress={() => setWave((wave) => wave + 1)} />
      <Panel title="hud" transform={{ x: 160 }}>
        <Coin value={score} />
        <Trail value={wave} transform={{ x: 40, y: 20 }} />
        {/* Text between the tags is the `text` prop: it follows `score` like any other value. */}
        <Text size={12} color={score >= 5 ? "gold" : "white"} transform={{ y: 40 }}>
          Score: {score} (wave {wave})
        </Text>
      </Panel>
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
          {/* Cycles its frames; a different list (from wave 9) restarts it, an equal one does not. */}
          <AnimatedSprite frames={wave > 8 ? ["boss-rage-1.png", "boss-rage-2.png"] : ["boss-1.png", "boss-2.png", "boss-3.png"]} fps={6} />
          <Banner text="boss" onDone={() => setWave((wave) => wave + 1)} />
        </Entity>
      )}
    </Entity>
  );
}
