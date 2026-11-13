/**
 * The authoring entry point: what component source imports.
 *
 *   import { useState, useUpdate, Entity, Sprite } from "@rge/runtime/jsx";
 *
 * Source TSX is compiled, never run, so everything here is a declaration that
 * exists for the type-checker (the functions throw if called). Prop types are
 * derived from the runtime's own classes, so they cannot drift from it, and a
 * test checks that this module exports exactly what the compiler accepts.
 */
import type { InputState } from "./input.ts";
import type { ShakeState, Vector2 } from "./math.ts";
import type { EntityProps } from "./components/Entity.ts";
import type { HudProps } from "./components/Hud.ts";
import type { GameProps } from "./components/Game.ts";
import type { SpriteProps } from "./components/Sprite.ts";
import type { ColliderProps } from "./components/Collider.ts";
import type { PointerProps } from "./components/Pointer.ts";
import type { TextProps } from "./components/Text.ts";
import type { ShapeProps } from "./components/Shape.ts";
import type { CameraProps } from "./components/Camera.ts";
import type { AnimatedSpriteProps } from "./components/AnimatedSprite.ts";
import type { FlexProps } from "./components/Flex.ts";
import type { ScreenProps } from "./components/Screen.ts";
import type { TilemapProps } from "./components/Tilemap.ts";
import type { ParticlesProps } from "./components/Particles.ts";
import type { ParticleLayerProps } from "./components/ParticleLayer.ts";
import type { FadeProps } from "./components/Fade.ts";
import type { MusicProps } from "./components/Music.ts";
import type { RouteProps, RouterProps } from "./components/Router.ts";
import type { Child, JSX } from "./jsx-runtime.ts";

export type { TransformProps, Child } from "./jsx-runtime.ts";

export { clamp, shakeOn, springBack } from "./math.ts";

// -- state and refs -----------------------------------------------------------

/** `useState(100)` infers `number`, not the literal `100`. Arrays and records are kept as written. */
type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean : T;

/** Primitive values, the only thing a ref holds. */
type Primitive = number | string | boolean;

export type Setter<T> = (value: T | ((previous: T) => T)) => void;

function compileTimeOnly(name: string): never {
  throw new Error(`${name} is a compile-time declaration: components are compiled by @rge/compiler, not executed.`);
}

/**
 * State: reads are a snapshot of the last render, as in React; setters batch
 * into one render per frame. Arrays and records need their type
 * (`useState<EnemyData[]>([])`) and are updated immutably: a setter only
 * renders when it is given a new value, so `setItems([...items, item])`, never
 * a mutation of `items`.
 */
export function useState<T>(_initial: () => T): [Widen<T>, Setter<Widen<T>>];
export function useState<T>(_initial: T): [Widen<T>, Setter<Widen<T>>];
/** `useState(() => makeThing())`: React's lazy initial value, made once per instance (an object with methods, such as an effect). */
export function useState<T>(_initial: T | (() => T)): [Widen<T>, Setter<Widen<T>>] {
  return compileTimeOnly("useState");
}

/**
 * Squash and stretch: a scale set at a moment that springs back to 1 at \`recover\` a second (default 1.75), as state.
 *
 *     const [squash, setSquash] = useSquash();
 *     setSquash({ x: 0.6, y: 1.4 });                 // in a handler: thin and tall
 *     <Sprite transform={{ scaleX: squash.x, scaleY: squash.y }} … />   // scales about the sprite's origin
 *
 * An ordinary hook the engine ships (\`useState\` and \`useUpdate\`, inlined like any custom hook).
 */
export function useSquash(_recover?: number): [Vector2, Setter<Vector2>] {
  return compileTimeOnly("useSquash");
}

/**
 * A shake of the view, as state: `setShake({ strength: 3, duration: 0.25 })` in a handler starts one, and it runs down by
 * itself in this component's update. Give it to the camera: `<Camera shake={shake}>`.
 *
 * An ordinary hook the engine ships (\`useState\` and \`useUpdate\`, inlined like any custom hook).
 */
export function useShake(): [ShakeState, Setter<ShakeState>] {
  return compileTimeOnly("useShake");
}

/**
 * Seconds since the component mounted, growing with each update: `const time = useTime();`, then
 * `color={time % 1 < 0.66 ? "white" : "black"}` to blink. The component renders every update while it is mounted.
 *
 * An ordinary hook the engine ships (\`useState\` and \`useUpdate\`, inlined like any custom hook).
 */
export function useTime(): number {
  return compileTimeOnly("useTime");
}

/**
 * A sound, played by calling the returned function in a handler:
 * `const playHit = useSound("hit.wav");` then `playHit();`, or `playHit(0.5)` at half volume (0 to 1). A sound played again
 * while it still sounds plays over itself, up to four at once, then the oldest is cut off. The path must be a
 * string literal. Sounds are not placed, so there is no `transform`.
 */
export function useSound(_path: string): (volume?: number) => void {
  return compileTimeOnly("useSound");
}

/** A value that persists across frames but never renders. Read and write `.current` in handlers only. */
export function useRef<T extends Primitive>(_initial: T): { current: Widen<T> } {
  return compileTimeOnly("useRef");
}

// -- per-frame hooks ----------------------------------------------------------

/**
 * Runs every frame, after `useInput`. `dt` is the frame time in seconds (the fixed step, with a fixed timestep). `input` is the same
 * polled input `useInput` gets, for a game that reads its buttons where it steps: `useUpdate((dt, input) => { step(input, dt); })`.
 */
export function useUpdate(_handler: (dt: number, input: InputState) => void): void {
  return compileTimeOnly("useUpdate");
}

/** Runs every frame with the polled input state, before `useUpdate`. */
export function useInput(_handler: (input: InputState) => void): void {
  return compileTimeOnly("useInput");
}

/**
 * Runs once, when the component joins the world (after its children have).
 * Setting state here renders in the same frame. It may return a cleanup, a
 * function called once when the component leaves the world, after its
 * `useUnmount`: `useMount(() => settings.subscribe(() => setView(read())))`.
 */
export function useMount(_handler: () => void | (() => void)): void {
  return compileTimeOnly("useMount");
}

/**
 * Runs once, when the component leaves the world (a condition turning off, a
 * list item removed). It cannot set state, since the component is going away;
 * it can write refs and call callback props, which is how the parent finds out.
 */
export function useUnmount(_handler: () => void): void {
  return compileTimeOnly("useUnmount");
}

// -- elements -----------------------------------------------------------------

/** A named container; the usual root of a component. */
export function Entity(_props: EntityProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Entity");
}

/**
 * The root of a game and its configuration: the game's `id` (the folder its save and settings are kept in), the window (`title`, `width`, `height`, `resizable`, `vsync`, `smooth`, `fullscreenKey`, `fixedStep`, `gamepadDeadzone`, `upscale`, `showFps`, `fpsKey`),
 * the `background`, the `assets` folder and the `controls`. A container, like `<Entity>`, and
 * optional: a component whose root is `<Game …>` overrides the defaults, each prop only where it is written. Its
 * `width` and `height` are the window's; put a `<Screen width height>` inside it for the resolution the game is drawn
 * at. Settings are literals, and it is only ever a component's root.
 */
export function Game(_props: GameProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Game");
}

/** Draws an image. */
export function Sprite(_props: SpriteProps): JSX.Element {
  return compileTimeOnly("Sprite");
}

/** A hit area for collisions. */
export function Collider(_props: ColliderProps): JSX.Element {
  return compileTimeOnly("Collider");
}

/** A hit area for presses (clicks and taps). */
export function Pointer(_props: PointerProps): JSX.Element {
  return compileTimeOnly("Pointer");
}

/** What a `<Text>` may hold between its tags: text and `{expressions}` of strings or numbers. */
export type TextChild = string | number;

/**
 * The content is the element's children, and only them: `<Text size={12}>Score: {score}</Text>`. There is no `text` prop in JSX
 * (`Omit` takes it out of the props, so the type-check says it does not exist, and the compiler says where the words go).
 * Elements cannot be children of a `<Text>`.
 */
export type TextAttributes = Omit<TextProps, "text"> & { children: TextChild | readonly TextChild[] };

/**
 * A line of text (a label, a HUD readout). `shadow` and `outline` (with `shadowX`, `shadowY` and `outlineWidth`) draw the text again under
 * itself in another colour, to keep it readable over a busy picture; they take no room in a layout.
 */
export function Text(_props: TextAttributes): JSX.Element {
  return compileTimeOnly("Text");
}

/** A filled rectangle or circle, for debugging colliders and prototyping before art exists. */
export function Shape(_props: ShapeProps): JSX.Element {
  return compileTimeOnly("Shape");
}

/**
 * The viewport. Its `transform` is the view (moving it pans, `zoom` magnifies),
 * and it follows its children: `<Camera><Player /></Camera>` keeps the view on
 * the player. With no children it stays where it is.
 */
export function Camera(_props: CameraProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Camera");
}

/**
 * A sprite that cycles through `frames` at `fps`. `playing={false}` freezes it; a
 * different `frames` restarts it. Playing costs no renders.
 */
export function AnimatedSprite(_props: AnimatedSpriteProps): JSX.Element {
  return compileTimeOnly("AnimatedSprite");
}

/**
 * A container that places its children in a row or a column. It takes the props of CSS flexbox (`direction`,
 * `alignItems`, `justifyContent`, `gap`, `padding`) and sizes itself the way Clay does: each axis is `"fit"` (the
 * default), `"grow"`, a number of pixels or a percentage such as `"50%"`, with optional `minWidth` / `maxWidth` /
 * `minHeight` / `maxHeight`. A child's own `transform` moves it within its slot. `background` fills the box, and `borderWidth`, `borderColor` and `borderRadius`
 * give it a border (which takes room like padding) and rounded corners; `hoverBackground`, `hoverBorderColor`, `focusBackground` and `focusBorderColor`
 * are the colours it is drawn in while the mouse is over it or it has the focus; `pressedBackground` / `pressedBorderColor` while the button is held on it;
 * `disabled` switches it off (and shows `disabledBackground` / `disabledBorderColor` over every other state). `transition` fades between the colours of those states over that many seconds instead of snapping.
 * `opacity` fades the box and everything in it (with a `transition`, over time).
 * `backgroundImage` and `slice` skin it with a nine-slice picture (and `hoverBackgroundImage` and the like swap it by state).
 * `overflow` clips children that stick out of the box (`"hidden"`) and lets the mouse wheel scroll them (`"scroll"`, with `scrollX` / `scrollY`).
 */
export function Flex(_props: FlexProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Flex");
}

/**
 * A grid of tiles from a sheet, with no object per tile: `<Tilemap map="room1" image="tiles.png" />` draws the registered Tiled map
 * `room1` with the tiles of `tiles.png`; without `image`, each tile comes from its own tileset's sheet, as saved in Tiled. The same
 * map, as `getTilemap("room1")`, is the solid grid that movement code reads. Placed by `transform` at the map's top left; `layer` draws one layer only. A leaf.
 */
export function Tilemap(_props: TilemapProps): JSX.Element {
  return compileTimeOnly("Tilemap");
}

/**
 * An emitter of small squares for dust, a dash's trail or a death, with no game object per particle: `rate` a second while `emitting`,
 * `burst` at once when it turns on (or when it is made), each living `lifetime` seconds, thrown at `speed` toward `angle` ± `spread`,
 * pulled by `gravity`, fading or shrinking. `space="world"` leaves them where they were made. A leaf, placed by `transform`.
 */
export function Particles(_props: ParticlesProps): JSX.Element {
  return compileTimeOnly("Particles");
}

/**
 * Where a particle store's bursts are drawn, as a `<Toaster />` is for toasts: `const fx = createParticles({ dust: { … } })` in a
 * `.ts` module, `<ParticleLayer particles={fx} />` once (inside the `<Camera>`, for bursts at world positions), then
 * `fx.burst("dust", x, y)` from an action, a plain function or a handler. A leaf.
 */
export function ParticleLayer(_props: ParticleLayerProps): JSX.Element {
  return compileTimeOnly("ParticleLayer");
}

/**
 * A cover that fades the screen to a colour and back: put it in a `<Hud>` and switch `on`. `duration` is the seconds a full fade
 * takes. For a death, a room change, a scene change.
 */
export function Fade(_props: FadeProps): JSX.Element {
  return compileTimeOnly("Fade");
}

/**
 * Music that streams from a file, loops, fades and stops: `<Music src="theme.ogg" volume={0.6} playing={!paused} />`. It plays for as
 * long as it is mounted, so put it in the root, where room and screen changes do not touch it. `fade` is the seconds a full
 * fade takes, in and out. A leaf with no position.
 */
export function Music(_props: MusicProps): JSX.Element {
  return compileTimeOnly("Music");
}

/**
 * The screens of a game, and which one shows: `<Router route={screen} transition={slide}><Route name="title"><Title /></Route>…</Router>`.
 * Only the shown `<Route>` is in the world. When `route` changes, `transition` (a function you write in a `.ts` file, called with the
 * progress from 0 to 1 and the two route names, returning where each screen is, whether it is visible and how far a cover colour
 * is over the screen) runs for `duration` seconds with both screens in the world; without one the screens switch at once.
 */
export function Router(_props: RouterProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Router");
}

/** One screen of a `<Router>`, named for its `route`. It is in the world only while shown (or being left or entered). */
export function Route(_props: RouteProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Route");
}

/**
 * Pause every `useUpdate` for the next `steps` fixed steps: the freeze frames of a hit or a dash. Call it as a statement in a
 * handler. `useInput` keeps running and a press during the freeze is kept for the first step after it.
 */
export function freeze(_steps: number): void {
  return compileTimeOnly("freeze");
}

/**
 * A layer that stays on the screen while the camera moves, drawn after the world: a score, a health bar, a button.
 * Its coordinates are screen pixels (game pixels under a `<Screen>`). `transform` moves the whole layer.
 */
export function Hud(_props: HudProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Hud");
}

/**
 * The game's screen, at a fixed resolution: `<Screen width={320} height={180}>` as the root of the game draws
 * everything at 320 × 180 and scales it to fit the window (`fit`), with `border` around it. Only the root's
 * `<Screen>` does this; it cannot be placed with `transform`.
 */
export function Screen(_props: ScreenProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Screen");
}
