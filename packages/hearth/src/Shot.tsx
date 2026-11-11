import { Entity, Shape, Sprite } from "@rge/runtime/jsx";

interface ShotProps {
  kind: "bolt" | "mortar" | "frost";
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
  flight: number;
  radius: number;
}

/** A shot in the air: a bolt's dot or a mortar shell flying from the tower to where it lands (the shell in an arc), or the ring a frost pulse spreads. */
export function Shot({ kind, x, y, tx, ty, t, flight, radius }: ShotProps) {
  const k = Math.min(t / flight, 1);
  const arc = kind === "mortar" ? -Math.sin(k * Math.PI) * 14 : 0;
  return (
    <Entity name="Shot" transform={{ x: x + (tx - x) * k, y: y + (ty - y) * k + arc }}>
      {kind === "frost" ? (
        <Shape kind="circle" width={radius * 2 * k} height={radius * 2 * k} color="#9ee7ff40" transform={{ x: -radius * k, y: -radius * k }} />
      ) : (
        <Sprite image="shots.png" frameWidth={8} frameHeight={8} frame={kind === "bolt" ? 0 : 1} originX={4} originY={4} />
      )}
    </Entity>
  );
}
