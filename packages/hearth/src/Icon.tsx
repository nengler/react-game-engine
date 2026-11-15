import { Sprite } from "@tsengine/runtime/jsx";

interface IconProps {
  /** Which of `icons.png`'s 10 × 10 pictures: 0 bolt, 1 mortar, 2 frost, 3 gold, 4 lives, 5 wave. */
  frame: number;
}

export function Icon({ frame }: IconProps) {
  return <Sprite image="icons.png" frameWidth={10} frameHeight={10} frame={frame} />;
}
