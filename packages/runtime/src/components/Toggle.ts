import { Flex, WIDGET_TOGGLE, type FlexProps } from "./Flex.ts";

export interface ToggleProps extends Omit<FlexProps, "onPress"> {
  /** Whether it is on. The toggle flips it itself when it is used and tells `onChange`; setting the prop sets it. Default false. */
  checked?: boolean;
  /** Called with the new state when the user flips it (a press, the confirm key or its `pressKey`). */
  onChange?: (checked: boolean) => void;
  /** A CSS colour for the track when it is on. Default a green. */
  onColor?: string;
  /** A CSS colour for the track when it is off. Default a grey. */
  offColor?: string;
  /** A CSS colour for the knob. Default white. */
  thumbColor?: string;
}

const DEFAULT_WIDTH = 36;
const DEFAULT_HEIGHT = 18;
const DEFAULT_ON = "#4caf50";
const DEFAULT_OFF = "#555a66";
const DEFAULT_THUMB = "#ffffff";

/**
 * An on and off switch: a pill-shaped track, in `onColor` or `offColor`, with a knob at its right end when it is on and its left
 * when it is off. A press, the confirm key while it has the focus, or its `pressKey` flips it. It is a `<Flex>` in every other way:
 * a `borderWidth` and `focusBorderColor` make a focus ring round the track, and it is sized, laid out, faded and disabled like one.
 */
export class Toggle<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  checked: boolean;
  onChange: ((checked: boolean) => void) | undefined;
  onColor: string;
  offColor: string;
  thumbColor: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ToggleProps = {}, props?: P, defaults?: Partial<P>) {
    super({ ...hostProps, width: hostProps.width ?? DEFAULT_WIDTH, height: hostProps.height ?? DEFAULT_HEIGHT, focusable: hostProps.focusable ?? true }, props, defaults);
    this.widget = WIDGET_TOGGLE;
    this.checked = hostProps.checked ?? false;
    this.onChange = hostProps.onChange;
    this.onColor = hostProps.onColor ?? DEFAULT_ON;
    this.offColor = hostProps.offColor ?? DEFAULT_OFF;
    this.thumbColor = hostProps.thumbColor ?? DEFAULT_THUMB;
    this.onPress = () => this.flip();
  }

  /** Switch it, and say so: what a press does. */
  flip(): void {
    this.checked = !this.checked;
    this.onChange?.(this.checked);
  }
}
