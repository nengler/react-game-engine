import { Collider, Entity, Shape } from "@tsengine/runtime/jsx";

interface BlockProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Something to stand on: a solid collider (a body's `move` stops at it) drawn as a rectangle. */
export function Block({ x, y, width, height }: BlockProps) {
  return (
    <Entity x={x} y={y}>
      <Shape kind="rect" width={width} height={height} color="#3b4766" />
      <Collider width={width} height={height} tag="ground" solid />
    </Entity>
  );
}
