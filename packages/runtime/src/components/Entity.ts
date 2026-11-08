import { GameObject } from "../GameObject.ts";

export interface EntityProps {
  name?: string;
}

/** A named container: the only built-in that can have JSX children. Compiled components default to extending it. */
export class Entity<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  name: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: EntityProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.name = hostProps.name ?? "";
  }
}
