import { Collider, Entity, Shape } from "@rge/runtime/jsx";

/** Something that hurts while you stand on it. It only carries a tag: the player decides what touching it does. */
export function Spikes() {
  return (
    <Entity name="Spikes">
      <Shape kind="rect" width={24} height={24} color="#8b1e2d" />
      <Collider width={24} height={24} tag="spikes" />
    </Entity>
  );
}
