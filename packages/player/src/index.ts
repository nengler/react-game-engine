export type { Backend, StorageBackend, WindowConfig } from "./backend.ts";
export { boundsOverlap, colliderBounds, CollisionTracker, type Bounds, type Overlaps } from "./collide.ts";
export { colorToHex, MAGENTA, packColor, parseColor, type PackedColor } from "./color.ts";
export {
  DrawList,
  estimateTextWidth,
  FrameBuilder,
  walkTree,
  type BuiltFrame,
  type ColliderEntry,
  type FrameBuilderOptions,
  type Size,
} from "./draw.ts";
export { FixedDriver, type StepRunner } from "./fixed.ts";
export { INTERPOLATE_SNAP, Interpolator } from "./interpolate.ts";
export { HOST_BACKEND_KEY, HOST_RUN_KEY, hostBackend } from "./host.ts";
export { PlayerInput } from "./input.ts";
export {
  createPlayer,
  DEFAULT_WINDOW,
  describeError,
  layoutError,
  MAX_DT,
  MAX_STEPS_PER_FRAME,
  run,
  type ErrorLine,
  type Player,
  type PlayerClock,
  type PlayerConfig,
} from "./loop.ts";
export { hashState, replayMoment, Rewind, type Moment, type RewindOptions } from "./rewind.ts";
export * from "./protocol.ts";
export {
  applyInputFrame,
  RecordingBackend,
  type DecodedRecord,
  type InputFrame,
  type RecordedFrame,
  type RecordingOptions,
} from "./recording.ts";
export { borderRects, fitScreen, onScreen, viewToWindow, type ScreenPlacement, type WindowRect } from "./screen.ts";
export { Warner } from "./warn.ts";
export { runScript, ScriptedInputBackend, type RunOptions, type RunResult } from "./harness.ts";
export { parseInputScript, scriptLength, type InputBindings, type ScriptFrame, type ScriptOptions } from "./script.ts";
export {
  gameLook,
  stories,
  storiesIn,
  story,
  storyRoot,
  type LoadedStory,
  type StoriesOf,
  type StoriesOptions,
  type Story,
  type StoryOptions,
  type StoryWindow,
} from "./stories.ts";
