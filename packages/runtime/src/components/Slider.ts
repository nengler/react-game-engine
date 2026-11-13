import { Flex, WIDGET_SLIDER, flexBorderRoom, type FlexProps } from "./Flex.ts";

export interface SliderProps extends FlexProps {
  /** Where the thumb is, from `min` to `max`. The slider moves it itself when it is used and tells `onChange`; setting the prop moves it there. Default `min`. */
  value?: number;
  /** The value at the left end. Default 0. */
  min?: number;
  /** The value at the right end. Default 1. */
  max?: number;
  /** A value is a whole number of these from `min`: 0 for any value (the default). With one, a key moves it by one step, and by a twentieth of the range without. */
  step?: number;
  /** Called with the new value when the user moves the thumb (by a press, a drag or a key), and only when it is a different one. */
  onChange?: (value: number) => void;
  /** A CSS colour for the part of the track left of the thumb. Default a blue; `"transparent"` for none. The track itself is the box's `background`. */
  fillColor?: string;
  /** A CSS colour for the thumb. Default white. */
  thumbColor?: string;
  /** How wide the thumb is, in pixels. Default 8. */
  thumbWidth?: number;
}

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 14;
const DEFAULT_TRACK = "#3a3f4b";
const DEFAULT_FILL = "#5b9bd5";
const DEFAULT_THUMB = "#ffffff";
const DEFAULT_THUMB_WIDTH = 8;
/** One key press moves a slider with no `step` by this share of its range. */
const KEY_SHARE = 1 / 20;

/**
 * A horizontal slider: a track (the box's own background, so it takes a border, a radius, an image and a colour for each state
 * like any `<Flex>`), the part of it up to the thumb in `fillColor`, and a thumb. A press puts the thumb under the mouse and a drag
 * moves it, even once the mouse has left the box. It takes the focus, and then the left and right keys move it (up and down move
 * the focus on). It is a `<Flex>` in every other way: it is sized, laid out, clipped, faded and disabled like one.
 */
export class Slider<P extends object = {}> extends Flex<P> {
  static override readonly intrinsic = true;

  value: number;
  min: number;
  max: number;
  step: number;
  onChange: ((value: number) => void) | undefined;
  fillColor: string;
  thumbColor: string;
  thumbWidth: number;
  readonly #point = new Float64Array(2);

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: SliderProps = {}, props?: P, defaults?: Partial<P>) {
    super({ ...hostProps, width: hostProps.width ?? DEFAULT_WIDTH, height: hostProps.height ?? DEFAULT_HEIGHT, background: hostProps.background ?? DEFAULT_TRACK, focusable: hostProps.focusable ?? true }, props, defaults);
    this.widget = WIDGET_SLIDER;
    this.min = hostProps.min ?? 0;
    this.max = hostProps.max ?? 1;
    this.step = hostProps.step ?? 0;
    this.value = hostProps.value ?? this.min;
    this.onChange = hostProps.onChange;
    this.fillColor = hostProps.fillColor ?? DEFAULT_FILL;
    this.thumbColor = hostProps.thumbColor ?? DEFAULT_THUMB;
    this.thumbWidth = hostProps.thumbWidth ?? DEFAULT_THUMB_WIDTH;
  }

  /** How far along the track the value is, 0 to 1 (0 for a range with no width, or a value that is not a number). */
  fraction(): number {
    const range = this.max - this.min;
    if (!(range > 0)) return 0;
    const t = (this.value - this.min) / range;
    return t >= 1 ? 1 : t > 0 ? t : 0;
  }

  /** How wide the thumb is drawn: its `thumbWidth` (or the default if that is not a number), at most the inside of the box. */
  thumbSize(): number {
    const inside = Math.max((this.box.size[0] as number) - 2 * flexBorderRoom(this), 0);
    const width = Number.isFinite(this.thumbWidth) && this.thumbWidth >= 0 ? this.thumbWidth : DEFAULT_THUMB_WIDTH;
    return Math.min(width, inside);
  }

  /** The value for a position `x` pixels from the box's left edge, with the thumb centred on it: kept in range and to the step. */
  valueAt(x: number): number {
    const edge = flexBorderRoom(this);
    const thumb = this.thumbSize();
    const travel = Math.max((this.box.size[0] as number) - 2 * edge - thumb, 0);
    const t = travel > 0 ? (x - edge - thumb / 2) / travel : 0;
    return this.#snap(this.min + (t >= 1 ? 1 : t > 0 ? t : 0) * (this.max - this.min));
  }

  /** A value kept between `min` and `max`, and to the step, with the rounding errors of a step like 0.1 taken off. */
  #snap(raw: number): number {
    const low = Math.min(this.min, this.max);
    const high = Math.max(this.min, this.max);
    let v = raw;
    if (this.step > 0 && Number.isFinite(this.step)) v = this.min + Math.round((raw - this.min) / this.step) * this.step;
    v = Math.round(v * 1e9) / 1e9;
    return v >= high ? high : v > low ? v : low;
  }

  /** Make `next` the value, if it is a different one, and say so. What the user's hand does goes through here. */
  #set(next: number): void {
    if (next === this.value || next !== next) return;
    this.value = next;
    this.onChange?.(next);
  }

  /** Put the thumb under a point of the layer's coordinates (what a press and a drag do). */
  moveTo(x: number, y: number): void {
    this.boxPoint(x, y, this.#point);
    this.#set(this.valueAt(this.#point[0] as number));
  }

  onPressAt(x: number, y: number): void {
    this.moveTo(x, y);
  }

  onDrag(x: number, y: number): void {
    this.moveTo(x, y);
  }

  /** Left and right move the thumb one step (a twentieth of the range with no step), and are used up even at an end; up and down are not, and move the focus. */
  onNavigate(dx: number, _dy: number): boolean {
    if (dx === 0) return false;
    const delta = this.step > 0 && Number.isFinite(this.step) ? this.step : (this.max - this.min) * KEY_SHARE;
    this.#set(this.#snap((Number.isFinite(this.value) ? this.value : this.min) + dx * delta));
    return true;
  }
}
