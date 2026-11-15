import type { GameObject } from "../GameObject.ts";
import { Flex, type FlexProps } from "./Flex.ts";

export interface TooltipProps extends FlexProps {
  /**
   * Whether it shows: `true` always, `false` never, and left out (the usual) while the mouse is over the box it is in, or that box has
   * the focus.
   */
  show?: boolean;
}

/** The look a `<Tooltip>` has when its props do not say otherwise. */
export const TOOLTIP_DEFAULTS = {
  background: "#11131cee",
  borderWidth: 1,
  borderColor: "#3d4a7a",
  borderRadius: 2,
  paddingX: 4,
  paddingY: 2,
  float: true,
  anchor: "bottom-center",
  to: "top-center",
  offsetY: -2,
} as const;

/**
 * A tip that shows while the mouse is over the box it is in, or that box has the focus: a floating `<Flex>` above its parent, drawn over
 * what is near it (z 100) and taking no space. Put it inside the box it explains, among the box's children:
 *
 *   <Button onPress={sell}><Text>Sell</Text><Tooltip><Text>Sells for 5 gold</Text></Tooltip></Button>
 *
 * Its parent takes the mouse for it (as a box with a `hover*` prop does), so any `<Flex>` can have one. Every `<Flex>` prop works and
 * replaces the default look (`TOOLTIP_DEFAULTS`): `anchor` and `to` put it somewhere else (`anchor="center-left" to="center-right"` beside
 * its parent). A tooltip inside an `overflow` box is clipped with what is in the box.
 */
export class Tooltip<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  show: boolean | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TooltipProps = {}, props?: P, defaults?: Partial<P>) {
    const given: Partial<TooltipProps> = {};
    for (const key of Object.keys(hostProps) as (keyof TooltipProps)[])
      if (hostProps[key] !== undefined) (given as Record<string, unknown>)[key] = hostProps[key];
    super({ ...TOOLTIP_DEFAULTS, ...given }, props, defaults);
    this.show = hostProps.show;
    this.transform.z = 100;
  }

  /** Whether it is drawn now: `show`, or else whether the box it is in has the mouse or the focus. */
  shown(): boolean {
    if (this.show !== undefined) return this.show;
    const host = this.world;
    if (host === null) return false;
    let parent: GameObject | null = this.parent;
    while (parent !== null && parent.layoutContents) parent = parent.parent;
    return parent !== null && ((host.hovered as unknown) === parent || (host.focused as unknown) === parent);
  }
}
