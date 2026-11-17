import { Collider, Entity, Sprite, useMutable, useUpdate } from "@tsengine/runtime/jsx";

/** Seconds a bolt flies before it fades out. */
const LIFE = 1.1;

interface ShotProps {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  /** How many enemies it goes through before it is spent. */
  pierce: number;
  /** It is spent, or flew its time: take it away. */
  onDone: (id: number) => void;
}

/** A bolt from the wand: it flies straight, hurts each enemy its collider touches, and is spent after `pierce` of them. */
export function Shot({ id, x, y, vx, vy, damage, pierce, onDone }: ShotProps) {
  const s = useMutable({ x: x, y: y, t: 0, left: pierce });

  useUpdate((dt) => {
    if (s.left <= 0 || s.t >= LIFE) {
      onDone(id);
      return;
    }
    s.t += dt;
    s.x += vx * dt;
    s.y += vy * dt;
  });

  return (
    <Entity x={s.x} y={s.y} rotation={Math.atan2(vy, vx)}>
      <Sprite image="sprites.png" frameWidth={16} frameHeight={16} frame={10} originX={8} originY={8} />
      <Collider
        width={6}
        height={6}
        x={-3}
        y={-3}
        tag="shot"
        layer="shot"
        hits={["enemy"]}
        data={{ damage, x: s.x - vx * 0.05, y: s.y - vy * 0.05, knock: 60 }}
        onCollisionEnter={(other) => {
          if (other.tag === "enemy") s.left -= 1;
        }}
      />
    </Entity>
  );
}
