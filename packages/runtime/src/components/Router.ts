import { GameObject } from "../GameObject.ts";

/**
 * What a transition says about one moment of a screen change: how far along it is (`progress`, 0 to 1) is the function's
 * argument, and this is what it answers. Everything is optional: nothing says "as usual" (shown, in place, no cover).
 */
export interface TransitionFrame {
  /** Whether the screen being left is drawn (and can be pressed). Default true. */
  fromVisible?: boolean;
  /** Whether the screen being entered is drawn. Default true. */
  toVisible?: boolean;
  /** Where the screen being left is, as an offset in game pixels from its place. */
  fromX?: number;
  fromY?: number;
  /** Where the screen being entered is, as an offset from its place. */
  toX?: number;
  toY?: number;
  /** How covered the whole screen is by the router's `coverColor`, 0 (not at all) to 1: a fade through a colour. */
  cover?: number;
}

/** A transition between two screens: called every update while one runs, with its progress and the names of the two routes. */
export type Transition = (progress: number, from: string, to: string) => TransitionFrame;

export interface RouterProps {
  /** The name of the `<Route>` to show. Changing it switches screens, through `transition` if there is one. */
  route: string;
  /** How a screen change looks: a function of its progress. Left out, the screens switch at once. */
  transition?: Transition;
  /** Seconds a transition takes. Default 0.4. */
  duration?: number;
  /** The colour a `cover` fades to. Default black. */
  coverColor?: string;
}

export interface RouteProps {
  /** What the router's `route` calls this screen. */
  name: string;
  /**
   * Keep this screen's components (and their state) while another screen shows, instead of making them fresh each time it
   * comes back: a level select that remembers where it was scrolled. Default false, as React Router's routes.
   */
  keepAlive?: boolean;
}

/**
 * One screen of a `<Router>`: a container that is in the world only while the router shows it (and while it is being left or
 * entered). Its components are made when it comes and dropped once it has gone (the compiler shows a route's children only
 * while it is `active`), so each visit starts fresh, as with React Router; `keepAlive` keeps them, and their state, between
 * visits. Either way they join and leave the world with it, so `useMount` and `useUnmount` mean "the screen came" and
 * "the screen went".
 */
export class Route<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  name: string;
  keepAlive: boolean;
  /** False while a transition hides this screen: it is not drawn and nothing in it can be pressed or collide. */
  visible = true;
  /** Shown, or being left or entered: what the compiler shows the route's children on (unless `keepAlive`). Set by the router. */
  active = false;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: RouteProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.name = hostProps.name;
    this.keepAlive = hostProps.keepAlive ?? false;
  }
}

/**
 * Holds the screens of a game and shows the one `route` names: `<Router route={screen}><Route name="title">…</Route>…</Router>`.
 * Only the shown screen is in the world, so only it updates, draws and collides. When `route` changes, a `transition` (a function
 * of progress, from the game's own code) says where the two screens are, whether each is visible and how far a cover colour is over
 * the screen, for `duration` seconds; both screens are in the world meanwhile. The router counts time in `onUpdate`, so it follows
 * the fixed timestep. A change that comes while a transition runs finishes that one first.
 */
export class Router<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  transition: Transition | undefined;
  duration: number;
  coverColor: string;
  /** How covered the screen is right now, 0 to 1 (the player draws `coverColor` this strongly over everything). */
  cover = 0;
  #route: string;
  readonly #routes = new Map<string, Route>();
  #current: Route | null = null;
  #leaving: Route | null = null;
  #elapsed = 0;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: RouterProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.#route = hostProps.route;
    this.transition = hostProps.transition;
    this.duration = hostProps.duration ?? 0.4;
    this.coverColor = hostProps.coverColor ?? "black";
  }

  get route(): string {
    return this.#route;
  }

  set route(next: string | undefined) {
    const name = next ?? "";
    if (name === this.#route) return;
    const from = this.#route;
    this.#route = name;
    if (this.#routes.size > 0) this.#switch(from, name);
  }

  /** The route being shown, or being entered during a transition. */
  get current(): string {
    return this.#current?.name ?? "";
  }

  /** Whether a transition is running. */
  get transitioning(): boolean {
    return this.#leaving !== null;
  }

  /** A `<Route>` is kept by name and attached only when it is the one shown; anything else is a child like any other. */
  override addChild(child: GameObject, slot: number = Infinity, order: number = 0): void {
    if (!(child instanceof Route)) {
      super.addChild(child, slot, order);
      return;
    }
    const known = this.#routes.get(child.name);
    if (known === child) {
      // A route this router already holds, coming back into the world (a switch queued it).
      super.addChild(child, slot, order);
      return;
    }
    if (known !== undefined) throw new Error(`<Router> has two routes named '${child.name}'.`);
    this.#routes.set(child.name, child);
    if (child.name === this.#route) {
      this.#current = child;
      this.#activate(child, true);
      super.addChild(child, slot, order);
    }
  }

  #find(name: string): Route {
    const route = this.#routes.get(name);
    if (route === undefined) throw new Error(`<Router route="${name}">: there is no <Route name="${name}"> (routes: ${[...this.#routes.keys()].join(", ")}).`);
    return route;
  }

  #switch(from: string, to: string): void {
    this.#finish();
    const entering = this.#find(to);
    const leaving = this.#current;
    this.#current = entering;
    this.#activate(entering, true);
    if (leaving === null) {
      this.queueAddChild(entering);
      return;
    }
    this.queueAddChild(entering);
    if (this.transition === undefined || !(this.duration > 0)) {
      this.queueRemoveChild(leaving);
      this.#activate(leaving, false);
      return;
    }
    this.#leaving = leaving;
    // The screen being left still animates but no longer hears the buttons: they are the next screen's.
    this.world?.setInert(leaving, true);
    this.#elapsed = 0;
    this.#apply(0, from, to);
  }

  /** End a running transition at once: the old screen leaves, the new one is in place. */
  #finish(): void {
    const leaving = this.#leaving;
    if (leaving === null) return;
    this.#leaving = null;
    this.world?.setInert(leaving, false);
    this.queueRemoveChild(leaving);
    this.#activate(leaving, false);
    this.#settle(leaving);
    if (this.#current !== null) this.#settle(this.#current);
    this.cover = 0;
    this.markChanged();
  }

  /**
   * A route comes or goes: its children are made or dropped by the component that wrote them, which renders again to see it.
   * That is a compiled component above this router (marking all of them is harmless: a render with nothing changed does
   * nothing).
   */
  #activate(route: Route, active: boolean): void {
    if (route.active === active) return;
    route.active = active;
    for (let at: GameObject | null = this.parent; at !== null; at = at.parent) {
      if ((at.constructor as { readonly managed?: boolean }).managed === true) at.markDirty();
    }
  }

  #settle(route: Route): void {
    route.visible = true;
    route.transform.x = 0;
    route.transform.y = 0;
    route.markChanged();
  }

  #apply(progress: number, from: string, to: string): void {
    const leaving = this.#leaving;
    const entering = this.#current;
    if (leaving === null || entering === null || this.transition === undefined) return;
    const frame = this.transition(progress, from, to);
    leaving.visible = frame.fromVisible ?? true;
    leaving.transform.x = frame.fromX ?? 0;
    leaving.transform.y = frame.fromY ?? 0;
    entering.visible = frame.toVisible ?? true;
    entering.transform.x = frame.toX ?? 0;
    entering.transform.y = frame.toY ?? 0;
    this.cover = Math.min(1, Math.max(0, frame.cover ?? 0));
    leaving.markChanged();
    entering.markChanged();
    this.markChanged();
  }

  override onUpdate(dt: number): void {
    const leaving = this.#leaving;
    if (leaving === null || this.#current === null) return;
    this.#elapsed += Math.max(0, dt);
    const progress = Math.min(1, this.#elapsed / this.duration);
    if (progress >= 1) {
      this.#finish();
      return;
    }
    this.#apply(progress, leaving.name, this.#current.name);
  }
}
