/** A project of prefabs, shared by the scene tests (scenes.test.ts) and the Tiled importer (tilemap.test.ts). */
export const WORLD = `
import { type Child, Entity, Sprite, useMount, useMutable, useUpdate } from "@tsengine/runtime/jsx";

interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  bounds?: number[];
  style?: { bold: boolean };
  onDefeated?: () => void;
}

export function Enemy({ speed, tint = "red", bounds = [0, 10] }: EnemyProps) {
  return (
    <Entity name="Enemy">
      <Sprite image={tint === "red" ? "enemy-red.png" : "enemy-blue.png"} />
    </Entity>
  );
}

interface FrameProps {
  title: string;
  children: Child;
}

export function Frame({ title, children }: FrameProps) {
  return (
    <Entity name="Frame">
      <Sprite image={title + ".png"} />
      <Entity name="Content">{children}</Entity>
    </Entity>
  );
}

export function Marker() {
  return <Entity name="Marker" />;
}

interface MoverProps {
  speed?: number;
}

export function Mover({ speed = 10 }: MoverProps) {
  const s = useMutable({ x: 0 });
  useUpdate((dt) => { s.x += dt * speed; });
  return <Entity name="Mover" x={s.x} />;
}

interface ProbeProps {
  tag: string;
}

export function Probe({ tag }: ProbeProps) {
  const s = useMutable({ mounted: 0 });
  useMount(() => {
    s.mounted += 1;
  });
  return <Entity name={tag} />;
}

function Hidden() {
  return <Entity name="Hidden" />;
}

export function Level() {
  return (
    <Entity name="Level">
      <Frame title="hud">
        <Enemy speed={1} />
        <Enemy speed={2} tint="blue" />
      </Frame>
      <Hidden />
    </Entity>
  );
}
`;
