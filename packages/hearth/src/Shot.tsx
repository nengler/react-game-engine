import { Collider, Entity, Shape, Sprite, useMutable, useUpdate } from "@rge/runtime/jsx";
import { fx, sfx } from "./effects.ts";

interface ShotProps {
  id: number;
  kind: "bolt" | "mortar" | "frost";
  x: number;
  y: number;
  tx: number;
  ty: number;
  flight: number;
  target: number;
  damage: number;
  radius: number;
  slow: number;
  /** Its flight is over: take it away. */
  onLanded: (id: number) => void;
}

/**
 * A shot. It flies from the tower to (tx, ty) over its flight (a bolt's tracer, a mortar shell in an arc, a frost pulse's
 * spreading ring) and hits as a `blast` collider for one step: a bolt and a frost pulse as they are fired, a shell when it
 * lands. Every enemy whose collider the blast touches decides whether it was hit (see `Enemy`).
 */
export function Shot({ id, kind, x, y, tx, ty, flight, target, damage, radius, slow, onLanded }: ShotProps) {
  const s = useMutable({ t: 0 });
  const k = Math.min(s.t / flight, 1);
  const arc = kind === "mortar" ? -Math.sin(k * Math.PI) * 14 : 0;
  const landing = kind === "mortar" ? s.t >= flight : s.t === 0;
  // The blast's box covers its circle, and the box of an enemy whose middle is in it (see `Enemy`'s collider).
  const reach = radius + 6;

  useUpdate((dt) => {
    if (s.t === 0 && kind === "bolt") fx.burst("hit", tx, ty);
    if (s.t >= flight) {
      onLanded(id);
      return;
    }
    const next = Math.min(flight, s.t + dt);
    if (kind === "mortar" && next >= flight) {
      sfx.play("boom");
      fx.burst("boom", tx, ty);
    }
    s.t = next;
  });

  return (
    <Entity>
      <Entity x={x + (tx - x) * k} y={y + (ty - y) * k + arc}>
        {kind === "frost" ? (
          <Shape kind="circle" width={radius * 2 * k} height={radius * 2 * k} color="#9ee7ff40" x={-radius * k} y={-radius * k} />
        ) : (
          <Sprite image="shots.png" frameWidth={8} frameHeight={8} frame={kind === "bolt" ? 0 : 1} originX={4} originY={4} />
        )}
      </Entity>
      {landing && (
        <Collider
          width={reach * 2}
          height={reach * 2}
          x={tx - reach} y={ty - reach}
          tag="blast"
          layer="blast"
          hits={["enemy"]}
          data={{ target, x: tx, y: ty, radius, damage, slow }}
        />
      )}
    </Entity>
  );
}
