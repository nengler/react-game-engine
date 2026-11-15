import { type Child, Entity, Sprite } from "@tsengine/runtime/jsx";

interface PanelProps {
  title: string;
  children: Child;
}

/**
 * A frame that holds whatever its parent passes. The parent builds and updates
 * the elements; `{children}` only says where they mount.
 */
export function Panel({ title, children }: PanelProps) {
  return (
    <Entity>
      <Sprite image={title === "hud" ? "panel-hud.png" : "panel.png"} />
      <Entity name="Content" y={16}>
        {children}
      </Entity>
    </Entity>
  );
}
