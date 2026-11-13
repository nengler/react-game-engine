/**
 * Stories: one component on its own, with given props, as Storybook shows a React component. A game keeps them in `stories/`, one
 * file per component, beside `test/`, and imports the generated class as a test does:
 *
 *     import { stories, story } from "@rge/player";
 *     import { HealthBar } from "../generated/HealthBar.ts";
 *
 *     export default stories(HealthBar, { size: [16, 6], origin: [8, 12] });
 *     export const Full = { hp: 10, maxHp: 10 };
 *     export const Hurt = { hp: 3, maxHp: 10 };
 *     export const Spent = story({ hp: 0, maxHp: 10 }, { setup: () => useGame.setState({ gold: 0 }) });
 *
 * Every other export is a story: its props, or `story(props, options)` for one that sets game state first or plays an input script
 * before it is looked at. `rge preview` shows them in a window with hot reload; `rge preview --screenshot` writes one PNG per story,
 * and `rge check` compares those with the stored ones.
 */
import { Entity, Game, GameObject, resetGameState, Screen, type GameProps } from "@rge/runtime";

/** What a stories file's default export says about all its stories. */
export interface StoriesOptions {
  /** The size of the screen the component is drawn on, in game pixels: `[width, height]`. */
  readonly size: readonly [number, number];
  /**
   * Where the component's own (0, 0) is on that screen. Default `[0, 0]`, the top left: right for a panel; a health bar drawn
   * around its owner's middle wants it inside.
   */
  readonly origin?: readonly [number, number];
  /** How many times larger a screenshot is than `size`. Default 4. */
  readonly scale?: number;
  /** The screen's colour. Default: the game's `<Game background>`. */
  readonly background?: string;
  /** Put the component inside something it needs: a `<Provider>`, a `<Flex>` that gives it a width. Returns the outer object. */
  readonly wrap?: (component: GameObject) => GameObject;
}

/** What a story may do besides giving props. */
export interface StoryOptions {
  /** Called before the component is made, after every game state was put back to its initial value: `useGame.setState(…)`. */
  readonly setup?: () => void;
  /**
   * An input script played before the story is looked at (`"right*10, confirm"`), in the format of the games' replays, with the
   * game's `bindings` (see `parseInputScript`). Default: none; one step is always run so the layout settles.
   */
  readonly input?: string;
}

const STORIES = Symbol.for("rge.stories");
const STORY = Symbol.for("rge.story");

type ComponentClass<P> = new (props: P) => GameObject;

export interface StoriesOf<P> extends StoriesOptions {
  readonly [STORIES]: true;
  readonly component: ComponentClass<P>;
}

export interface Story<P> {
  readonly [STORY]: true;
  readonly props: P;
  readonly options: StoryOptions;
}

/** A stories file's default export: the component (its generated class) and how its stories are shown. */
export function stories<P>(component: ComponentClass<P>, options: StoriesOptions): StoriesOf<P> {
  return { [STORIES]: true, component, ...options };
}

/** A story that does more than give props: sets game state first (`setup`) or plays an input script (`input`). */
export function story<P>(props: P, options: StoryOptions = {}): Story<P> {
  return { [STORY]: true, props, options };
}

/** One story of a stories file, ready to build. */
export interface LoadedStory {
  /** The component's class name (`HealthBar`). */
  readonly component: string;
  /** The export's name (`Hurt`). */
  readonly name: string;
  /** `HealthBar/Hurt`: what `rge preview --story` takes and what its screenshot is called. */
  readonly id: string;
  readonly of: StoriesOf<unknown>;
  readonly props: unknown;
  readonly options: StoryOptions;
}

/**
 * The stories of an imported stories file, by name (a module's exports are listed in alphabetical order, not in the order they are
 * written). Throws when its default export is not `stories(…)`.
 */
export function storiesIn(namespace: Record<string, unknown>, file: string): LoadedStory[] {
  const of = namespace.default as StoriesOf<unknown> | undefined;
  if (of === undefined || (of as Partial<StoriesOf<unknown>>)[STORIES] !== true) {
    throw new Error(`${file}: the default export must be stories(Component, { size: [width, height] }).`);
  }
  const [width, height] = of.size;
  if (!(width > 0 && height > 0)) throw new Error(`${file}: size must be two numbers above 0, [width, height].`);
  const component = of.component.name;
  const out: LoadedStory[] = [];
  for (const [name, value] of Object.entries(namespace)) {
    if (name === "default") continue;
    if (typeof value !== "object" || value === null) continue; // a helper function or a constant the stories share
    const tagged = (value as Partial<Story<unknown>>)[STORY] === true;
    out.push({
      component,
      name,
      id: `${component}/${name}`,
      of,
      props: tagged ? (value as Story<unknown>).props : value,
      options: tagged ? (value as Story<unknown>).options : {},
    });
  }
  return out;
}

/** The game's settings a story is drawn with: the root's `<Game>` assets, font, text and controls, never its window or save. */
export function gameLook(root: GameObject | null): GameProps {
  if (!(root instanceof Game)) return {};
  const look: GameProps = {
    background: root.background,
    assets: root.assets,
    font: root.font,
    smooth: root.smooth,
    upscale: root.upscale,
    controls: root.controls,
    textSize: root.textSize,
    textColor: root.textColor,
    fixedStep: root.fixedStep,
  };
  return Object.fromEntries(Object.entries(look).filter(([, value]) => value !== undefined)) as GameProps;
}

export interface StoryWindow {
  /** The window's size in pixels; default the story's size times its scale (what a screenshot is). */
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
}

/**
 * Build a story: every game state reset, the story's `setup`, then a `<Game>` with the game's look holding a `<Screen>` of the
 * story's size, and the component at its origin. The component sits in an entity keyed by the story's id, so a hot reload keeps
 * its state and switching to another story does not.
 */
export function storyRoot(loaded: LoadedStory, look: GameProps, window: StoryWindow = {}): GameObject {
  resetGameState();
  loaded.options.setup?.();
  const { of } = loaded;
  const [width, height] = of.size;
  const scale = of.scale ?? 4;
  const game = new Game({
    ...look,
    name: "Story",
    title: window.title ?? loaded.id,
    width: window.width ?? width * scale,
    height: window.height ?? height * scale,
    ...(of.background !== undefined ? { background: of.background } : {}),
    upscale: look.upscale ?? "nearest",
    vsync: false,
  });
  const screen = new Screen({ width, height, fit: "contain" });
  const holder = new Entity({ name: loaded.id });
  holder.hotKey = loaded.id;
  const [x, y] = of.origin ?? [0, 0];
  holder.transform.x = x;
  holder.transform.y = y;
  const component = new of.component(loaded.props);
  holder.addChild(of.wrap?.(component) ?? component);
  screen.addChild(holder);
  game.addChild(screen);
  return game;
}
