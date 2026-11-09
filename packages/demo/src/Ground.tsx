import { Entity, Shape, Sprite } from "@rge/runtime/jsx";

/** A few landmarks, so the camera's movement can be seen: shapes, and a plain sprite from the same art as the beacon. */
export function Ground() {
  return (
    <Entity name="Ground">
      <Shape kind="rect" width={48} height={48} color="#2b3550" transform={{ x: -240, y: 40 }} />
      <Shape kind="rect" width={64} height={32} color="#2b3550" transform={{ x: 200, y: 90 }} />
      <Shape kind="circle" width={56} height={56} color="#3a2b50" transform={{ x: -40, y: -140 }} />
      <Shape kind="circle" width={28} height={28} color="#3a2b50" transform={{ x: 260, y: -70 }} />
      <Sprite image="beacon-2.png" transform={{ x: 140, y: 120 }} />
    </Entity>
  );
}
