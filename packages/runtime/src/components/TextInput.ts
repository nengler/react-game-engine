import { Flex, WIDGET_TEXT, type FlexProps } from "./Flex.ts";
import { Text } from "./Text.ts";

export interface TextInputProps extends FlexProps {
  /**
   * The text in the field. Typing changes it and tells `onChange`; setting the prop puts it there, so a field that keeps its text in
   * state (`value={s.name} onChange={(v) => { s.name = v; }}`) can also change or refuse what is typed. Default `""`.
   */
  value?: string;
  /** Shown, in `placeholderColor`, while the field is empty. Default none. */
  placeholder?: string;
  /** The most characters it takes; typing more does nothing. Default no limit. */
  maxLength?: number;
  /** Called with the new text when typing or Backspace changes it. */
  onChange?: (value: string) => void;
  /** Called with the text when Enter is pressed while the field has the focus. */
  onSubmit?: (value: string) => void;
  /** The text's CSS colour. Default the game's `textColor`, else white. */
  color?: string;
  /** The placeholder's CSS colour. Default `"#8088a0"`. */
  placeholderColor?: string;
  /** The text's size. Default the game's `textSize`. */
  textSize?: number;
  /** The caret's CSS colour, shown while the field has the focus. Default `"#f2d17a"`. */
  caretColor?: string;
}

/** The look a `<TextInput>` has when its props do not say otherwise. */
export const TEXT_INPUT_DEFAULTS = {
  width: 100,
  background: "#11131c",
  borderWidth: 1,
  borderColor: "#3d4a7a",
  focusBorderColor: "#f2d17a",
  borderRadius: 2,
  paddingX: 3,
  paddingY: 2,
  overflow: "scroll",
  scrollbar: false,
  focusable: true,
} as const;

const PLACEHOLDER_COLOR = "#8088a0";
const CARET_COLOR = "#f2d17a";
/** What `InputState.typed` holds for a Backspace. */
const BACKSPACE = "\b";

/**
 * A one-line text field: `<TextInput value={s.name} placeholder="Your name" maxLength={12} onChange={(v) => { s.name = v; }} />`.
 * Click it, or move the focus to it, and type: the characters the keyboard makes go in at the end (with the system's key repeat),
 * Backspace takes the last one off, and Enter calls `onSubmit`. While it has the focus, letter keys do not trigger the game's actions
 * (`confirm`, `back`, a `pressKey`): only the arrows, Enter and Escape move or leave it. A caret shows where the next character goes.
 * Text longer than the field scrolls to show its end. Every `<Flex>` prop works and replaces the default look (`TEXT_INPUT_DEFAULTS`).
 * It takes no children: its text is its own.
 */
export class TextInput<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  maxLength: number | undefined;
  onChange: ((value: string) => void) | undefined;
  onSubmit: ((value: string) => void) | undefined;
  caretColor: string;
  /** The text drawn in the field: the value, or the placeholder while it is empty. */
  readonly label: Text;
  #value = "";
  #placeholder: string | undefined;
  #color: string | undefined;
  #placeholderColor: string | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TextInputProps = {}, props?: P, defaults?: Partial<P>) {
    const given: Partial<TextInputProps> = {};
    for (const key of Object.keys(hostProps) as (keyof TextInputProps)[]) if (hostProps[key] !== undefined) (given as Record<string, unknown>)[key] = hostProps[key];
    super({ ...TEXT_INPUT_DEFAULTS, ...given }, props, defaults);
    this.widget = WIDGET_TEXT;
    this.label = new Text({ text: " " });
    if (hostProps.textSize !== undefined) this.label.size = hostProps.textSize;
    this.addChild(this.label);
    this.maxLength = hostProps.maxLength;
    this.onChange = hostProps.onChange;
    this.onSubmit = hostProps.onSubmit;
    this.caretColor = hostProps.caretColor ?? CARET_COLOR;
    this.#placeholder = hostProps.placeholder;
    this.#color = hostProps.color;
    this.#placeholderColor = hostProps.placeholderColor;
    this.value = hostProps.value ?? "";
  }

  get value(): string {
    return this.#value;
  }

  set value(value: string | undefined) {
    this.#value = value ?? "";
    this.#show();
  }

  get placeholder(): string | undefined {
    return this.#placeholder;
  }

  set placeholder(value: string | undefined) {
    this.#placeholder = value;
    this.#show();
  }

  get color(): string | undefined {
    return this.#color;
  }

  set color(value: string | undefined) {
    this.#color = value;
    this.#show();
  }

  get placeholderColor(): string | undefined {
    return this.#placeholderColor;
  }

  set placeholderColor(value: string | undefined) {
    this.#placeholderColor = value;
    this.#show();
  }

  get textSize(): number {
    return this.label.size;
  }

  set textSize(value: number | undefined) {
    this.label.size = value;
    this.label.markChanged();
  }

  /** Whether what the label shows is the placeholder (the field is empty): the caret then goes before it. */
  showsPlaceholder(): boolean {
    return this.#value === "" && (this.#placeholder ?? "") !== "";
  }

  /**
   * Take what was typed (`InputState.typed`): each character goes in at the end, up to `maxLength`, and each `"\b"` takes the last
   * one off. Tells `onChange` once, with the new text, if it changed. Called by the World while the field has the focus.
   */
  takeText(typed: string): void {
    if (typed === "" || this.disabled === true) return;
    let chars = [...this.#value];
    for (const char of typed) {
      if (char === BACKSPACE) chars.pop();
      else if (char >= " " && char !== "\u007f" && (this.maxLength === undefined || chars.length < this.maxLength)) chars.push(char);
    }
    if (this.maxLength !== undefined && chars.length > this.maxLength) chars = chars.slice(0, this.maxLength);
    const next = chars.join("");
    if (next === this.#value) return;
    this.value = next;
    this.markChanged();
    this.onChange?.(next);
  }

  /** Enter while it has the focus. */
  submit(): void {
    if (this.disabled !== true) this.onSubmit?.(this.#value);
  }

  /** Left and right stay in the field (they would only move the focus away while typing); up and down move it as usual. */
  override onNavigate(dx: number, dy: number): boolean {
    return dx !== 0 && dy === 0;
  }

  /** The label shows the value, or the placeholder while it is empty, or a space (so the field keeps a line's height). */
  #show(): void {
    const label = this.label as Text | undefined;
    if (label === undefined) return; // during construction, before the label exists
    const placeholder = this.showsPlaceholder();
    label.text = placeholder ? (this.#placeholder as string) : this.#value === "" ? " " : this.#value;
    label.color = placeholder ? (this.#placeholderColor ?? PLACEHOLDER_COLOR) : this.#color;
    label.markChanged();
    // Text longer than the field shows its end, where the caret is: layout clamps this to how far it can scroll.
    this.scrollX = placeholder ? 0 : Number.MAX_SAFE_INTEGER;
  }
}
