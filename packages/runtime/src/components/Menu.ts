import { Flex, type FlexProps } from "./Flex.ts";

export interface MenuProps extends FlexProps {
  /**
   * Whether the focus goes round: down from the last item to the first, up from the first to the last (and left and right in a row).
   * Default true.
   */
  loop?: boolean;
  /** Called when `back` (or, when the controls have no such action, Escape or PadB) is pressed while something in the menu has the focus. */
  onBack?: () => void;
}

/**
 * A menu: a `<Flex>` (a column unless it says `direction="row"`) whose focusable children are its items, usually `<Button>`s. While one of
 * them has the focus, the direction keys move it only among the menu's items, going round at the ends (`loop`), and `back` calls
 * `onBack`. Give the item to start on `autoFocus`. It adds no look of its own: style it as a `<Flex>`.
 */
export class Menu<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  loop: boolean;
  onBack: (() => void) | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: MenuProps = {}, props?: P, defaults?: Partial<P>) {
    super({ ...hostProps, direction: hostProps.direction ?? "column" }, props, defaults);
    this.loop = hostProps.loop ?? true;
    this.onBack = hostProps.onBack;
  }
}
