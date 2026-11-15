import { Flex, type FlexProps } from "./Flex.ts";

export type ButtonProps = FlexProps;

/** The look a `<Button>` has when its props do not say otherwise. */
export const BUTTON_DEFAULTS = {
  background: "#2b3350",
  hoverBackground: "#36406a",
  focusBackground: "#3d4a7a",
  pressedBackground: "#1f2540",
  disabledBackground: "#24262e",
  focusBorderColor: "#f2d17a",
  borderWidth: 1,
  borderColor: "#2b3350",
  borderRadius: 2,
  paddingX: 6,
  paddingY: 3,
} as const;

/**
 * A button: a `<Flex>` that takes the focus, with colours for each state and its label as children
 * (`<Button onPress={start}><Text>Play</Text></Button>`). A click, the confirm key while it has the focus, or its `pressKey` presses
 * it. Every `<Flex>` prop works and overrides the default look (`BUTTON_DEFAULTS`): pass `background`, `focusBackground` and the rest
 * for a game's own style, or `backgroundImage` for a skin. Its children are centred on both axes unless it says otherwise.
 */
export class Button<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ButtonProps = {}, props?: P, defaults?: Partial<P>) {
    super(
      {
        ...BUTTON_DEFAULTS,
        alignItems: "center",
        justifyContent: "center",
        focusable: true,
        ...withoutUndefined(hostProps),
      },
      props,
      defaults
    );
  }
}

/** The props an element really set: an `undefined` one must not hide a default. */
function withoutUndefined<T extends object>(props: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(props) as (keyof T)[]) if (props[key] !== undefined) out[key] = props[key];
  return out;
}
