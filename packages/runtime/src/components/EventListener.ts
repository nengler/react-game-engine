import { GameObject } from "../GameObject.ts";
import type { EventChannel } from "../effects.ts";

export interface EventListenerProps<T> {
  /** The channel to listen to: `createEvents<T>()`, kept in a module. */
  events: EventChannel<T>;
  /** Called with each event sent while this is in the world. */
  onEvent: (event: T) => void;
}

/**
 * Listens to an event channel while it is in the world, as an element: `<EventListener events={gameEvents} onEvent={(e) => …} />`.
 * It joins with the component that holds it and stops when that leaves, so a component answers events with its own state, in
 * a handler like any other. Draws nothing; a leaf.
 */
// `any` by default: a field typed plainly `EventListener` (what generated code writes) holds a listener of any channel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventListener<T = any, P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  events: EventChannel<T>;
  onEvent: (event: T) => void;
  #unsubscribe: (() => void) | null = null;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: EventListenerProps<T>, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.events = hostProps.events;
    this.onEvent = hostProps.onEvent;
  }

  override onMount(): void {
    // The handler is read when an event comes, so a new one from a render is the one called.
    this.#unsubscribe = this.events.subscribe((event) => this.onEvent(event));
  }

  override onUnmount(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
