import { useMutable, useUpdate, AnimatedSprite, Camera, Entity, Sprite, Collider, Pointer, Shape, Text } from "@tsengine/runtime/jsx";

import { Banner } from "./Banner.tsx";
import Coin, { Trail } from "./Coin.tsx";
import { Panel } from "./Panel.tsx";

interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  onDefeated?: () => void;
}

export function Enemy({ speed, tint = "red", onDefeated }: EnemyProps) {
  const s = useMutable({ hp: 3, reported: false });

  useUpdate((dt) => {
    s.hp -= dt * speed;
    if (s.hp <= 0 && !s.reported) {
      s.reported = true;
      onDefeated?.();
    }
  });

  return (
    <Entity>
      <Sprite image={tint === "red" ? "enemy-red.png" : "enemy-blue.png"} />
      <Collider width={20} height={20} />
      {/* A shape shows the collider's bounds while there is no art for it. */}
      <Shape kind="rect" width={20} height={20} color={s.hp <= 0 ? "gray" : "rgba(255, 0, 0, 0.3)"} />
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
  const st = useMutable({
    wave: 1,
    score: 0,
    // Array state is updated immutably: a setter only renders when it gets a new array.
    spawns: [
      { id: "red-1", tint: "red", x: 40 },
      { id: "blue-1", tint: "blue", x: 80 },
    ] as Spawn[],
    defeats: [] as Defeat[],
  });
  const bossVisible = st.defeats.some((d) => d.tint === "blue") && st.defeats.length >= 2;
  return (
    <Entity>
      {st.spawns.map((s) => (
        // A component is placed by an <Entity> around it.
        <Entity key={s.id} x={s.x}>
          <Enemy
            speed={s.tint === "blue" ? st.wave * 2 : st.wave}
            tint={s.tint}
            onDefeated={() => {
              // `s` is the spawn's current value, looked up by its key.
              st.score += s.tint === "blue" ? 5 : 1;
              st.defeats = [...st.defeats, { tint: s.tint, wave: st.wave }];
              st.spawns = st.spawns.filter((other) => other.id !== s.id);
            }}
          />
        </Entity>
      ))}
      {/* The camera follows its children: once the third enemy arrives the view centres on it, and zooms in from wave 6. */}
      <Camera zoom={st.wave > 5 ? 2 : 1}>
        {st.wave >= 3 && (
          <Entity x={120}>
            <Enemy speed={st.wave} />
          </Entity>
        )}
      </Camera>
      {/* A hit area: a press inside it calls the handler. Pair it with a Shape to draw the button. */}
      <Shape kind="rect" width={48} height={16} color="gray" x={160} y={80} />
      <Pointer
        width={48}
        height={16}
        x={160}
        y={80}
        onPress={() => {
          st.wave += 1;
        }}
      />
      <Entity x={160}>
        <Panel title="hud">
          <Coin value={st.score} />
          <Entity x={40} y={20}>
            <Trail value={st.wave} />
          </Entity>
          {/* Text between the tags is the `text` prop: it follows `score` like any other value. */}
          <Text size={12} color={st.score >= 5 ? "gold" : "white"} y={40}>
            Score: {st.score} (wave {st.wave})
          </Text>
        </Panel>
      </Entity>
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={st.wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
          {/* Cycles its frames; a different list (from wave 9) restarts it, an equal one does not. */}
          <AnimatedSprite
            frames={st.wave > 8 ? ["boss-rage-1.png", "boss-rage-2.png"] : ["boss-1.png", "boss-2.png", "boss-3.png"]}
            fps={6}
          />
          <Banner
            text="boss"
            onDone={() => {
              st.wave += 1;
            }}
          />
        </Entity>
      )}
    </Entity>
  );
}
