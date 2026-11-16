import { Camera, type CameraViewState, type GameObject } from "@tsengine/runtime";

/**
 * Something that moved further than this in one step, in its parent's pixels, is drawn where it is, not blended: a respawn, a door or
 * a teleport would otherwise slide across the screen for a frame.
 */
export const INTERPOLATE_SNAP = 64;

/**
 * `GameObject.interpolation`: the step before last (`PREV`, 10 numbers) and the last step (`CUR`): the transform's x, y, rotation,
 * scaleX and scaleY, then the placement's; and the step it was written at.
 */
const N = 10;
const PREV = 0;
const CUR = N;
const STAMP = 2 * N;
const SIZE = 2 * N + 1;

/** An object's transform and placement into `s` at `at`. */
function read(object: GameObject, s: Float64Array, at: number): void {
  const t = object.transform;
  const p = object.placement;
  s[at] = t.x;
  s[at + 1] = t.y;
  s[at + 2] = t.rotation;
  s[at + 3] = t.scaleX;
  s[at + 4] = t.scaleY;
  s[at + 5] = p.x;
  s[at + 6] = p.y;
  s[at + 7] = p.rotation;
  s[at + 8] = p.scaleX;
  s[at + 9] = p.scaleY;
}

/** `s` at `at` into an object's transform and placement. */
function write(object: GameObject, s: Float64Array, at: number): void {
  const t = object.transform;
  const p = object.placement;
  t.x = s[at] as number;
  t.y = s[at + 1] as number;
  t.rotation = s[at + 2] as number;
  t.scaleX = s[at + 3] as number;
  t.scaleY = s[at + 4] as number;
  p.x = s[at + 5] as number;
  p.y = s[at + 6] as number;
  p.rotation = s[at + 7] as number;
  p.scaleX = s[at + 8] as number;
  p.scaleY = s[at + 9] as number;
}

/** Is the object still where `s` says the last step left it? */
function unchanged(object: GameObject, s: Float64Array): boolean {
  const t = object.transform;
  const p = object.placement;
  return (
    t.x === s[CUR] &&
    t.y === s[CUR + 1] &&
    t.rotation === s[CUR + 2] &&
    t.scaleX === s[CUR + 3] &&
    t.scaleY === s[CUR + 4] &&
    p.x === s[CUR + 5] &&
    p.y === s[CUR + 6] &&
    p.rotation === s[CUR + 7] &&
    p.scaleX === s[CUR + 8] &&
    p.scaleY === s[CUR + 9]
  );
}

/** How a field may change in one step and still be blended: positions by `INTERPOLATE_SNAP`, rotations by half a turn, scales by any amount. */
const LIMIT = [
  INTERPOLATE_SNAP,
  INTERPOLATE_SNAP,
  Math.PI,
  Infinity,
  Infinity,
  INTERPOLATE_SNAP,
  INTERPOLATE_SNAP,
  Math.PI,
  Infinity,
  Infinity,
];

export class Interpolator {
  #stamp = 0;
  readonly #cameras = new Map<Camera, { prev: CameraViewState; cur: CameraViewState; stamp: number }>();
  /** The objects `blend` moved, for `restore`. */
  readonly #blended: GameObject[] = [];
  readonly #cameraViews: [Camera, CameraViewState][] = [];
  readonly #blendedCameras: Camera[] = [];

  /** Keep the transforms of everything under `root` as the last step left them. */
  capture(root: GameObject): void {
    const stamp = ++this.#stamp;
    this.#capture(root, stamp);
    for (const [camera, entry] of this.#cameras) if (entry.stamp !== stamp) this.#cameras.delete(camera);
  }

  #capture(object: GameObject, stamp: number): void {
    let s = object.interpolation;
    if (s === null) {
      s = object.interpolation = new Float64Array(SIZE);
      s[STAMP] = Number.NaN; // seen at no step
    }
    if (s[STAMP] === stamp - 1) {
      for (let i = 0; i < N; i++) s[PREV + i] = s[CUR + i] as number;
    } else read(object, s, PREV); // new, or not seen at the step before: nothing to blend from
    read(object, s, CUR);
    s[STAMP] = stamp;
    if (object instanceof Camera) {
      const view = object.saveView();
      const entry = this.#cameras.get(object);
      if (entry !== undefined && entry.stamp === stamp - 1) this.#cameras.set(object, { prev: entry.cur, cur: view, stamp });
      else this.#cameras.set(object, { prev: view, cur: view, stamp });
    }
    const children = object.children;
    for (let i = 0; i < children.length; i++) this.#capture(children[i] as GameObject, stamp);
  }

  /**
   * Put everything `t` (0 to just under 1) of the way from the step before last to the last step: at 0, where the step before last
   * left it. Returns whether anything moved; when it did, `restore` must follow once the frame is built.
   */
  blend(root: GameObject, t: number): boolean {
    if (!(t >= 0 && t < 1) || this.#stamp === 0) return false;
    const stamp = this.#stamp;
    this.#blend(root, 1 - t, stamp);
    // Drawing a camera's view writes what it remembers of the last view (from the blended children, here): every camera's state is
    // kept, to be put back after the frame, whether or not it is blended itself.
    for (const camera of this.#cameras.keys()) this.#cameraViews.push([camera, camera.saveView()]);
    let cameras = 0;
    for (const [camera, entry] of this.#cameras) {
      if (entry.stamp !== stamp || entry.prev === entry.cur) continue;
      const a = entry.prev;
      const b = entry.cur;
      // A camera whose bounds changed (a door) jumps, as everything that moved far does.
      if (a.lastBounds !== b.lastBounds && !sameBounds(a.lastBounds, b.lastBounds)) continue;
      const af = a.followed;
      const bf = b.followed;
      if (af !== null && bf !== null && (Math.abs(bf.x - af.x) > INTERPOLATE_SNAP || Math.abs(bf.y - af.y) > INTERPOLATE_SNAP)) continue;
      camera.blendView(a, b, t);
      camera.markChanged();
      this.#blendedCameras.push(camera);
      cameras++;
    }
    if (this.#blended.length > 0 || cameras > 0) return true;
    this.#cameraViews.length = 0;
    return false;
  }

  /** `back` is 1 − t: how far back from the last step to draw. */
  #blend(object: GameObject, back: number, stamp: number): void {
    const s = object.interpolation;
    // Only what is still as the last step left it (a frame with no step may have settled a render since), and only a change small
    // enough to be motion rather than a jump.
    if (s !== null && s[STAMP] === stamp && unchanged(object, s)) {
      let moved = false;
      let jumped = false;
      for (let i = 0; i < N; i++) {
        const d = (s[CUR + i] as number) - (s[PREV + i] as number);
        if (d !== 0) moved = true;
        if (Math.abs(d) > (LIMIT[i] as number)) jumped = true;
      }
      if (moved && !jumped) {
        const t = object.transform;
        const p = object.placement;
        t.x = (s[CUR] as number) - ((s[CUR] as number) - (s[PREV] as number)) * back;
        t.y = (s[CUR + 1] as number) - ((s[CUR + 1] as number) - (s[PREV + 1] as number)) * back;
        t.rotation = (s[CUR + 2] as number) - ((s[CUR + 2] as number) - (s[PREV + 2] as number)) * back;
        t.scaleX = (s[CUR + 3] as number) - ((s[CUR + 3] as number) - (s[PREV + 3] as number)) * back;
        t.scaleY = (s[CUR + 4] as number) - ((s[CUR + 4] as number) - (s[PREV + 4] as number)) * back;
        p.x = (s[CUR + 5] as number) - ((s[CUR + 5] as number) - (s[PREV + 5] as number)) * back;
        p.y = (s[CUR + 6] as number) - ((s[CUR + 6] as number) - (s[PREV + 6] as number)) * back;
        p.rotation = (s[CUR + 7] as number) - ((s[CUR + 7] as number) - (s[PREV + 7] as number)) * back;
        p.scaleX = (s[CUR + 8] as number) - ((s[CUR + 8] as number) - (s[PREV + 8] as number)) * back;
        p.scaleY = (s[CUR + 9] as number) - ((s[CUR + 9] as number) - (s[PREV + 9] as number)) * back;
        object.markMoved();
        this.#blended.push(object);
      }
    }
    const children = object.children;
    for (let i = 0; i < children.length; i++) this.#blend(children[i] as GameObject, back, stamp);
  }

  /** Put back what `blend` moved: every transform and camera exactly as the last step left it. */
  restore(): void {
    const blended = this.#blended;
    for (let i = 0; i < blended.length; i++) {
      const object = blended[i] as GameObject;
      write(object, object.interpolation as Float64Array, CUR);
      object.markMoved();
    }
    blended.length = 0;
    for (const [camera, view] of this.#cameraViews) camera.restoreView(view);
    this.#cameraViews.length = 0;
    for (const camera of this.#blendedCameras) camera.markChanged();
    this.#blendedCameras.length = 0;
  }
}

function sameBounds(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
