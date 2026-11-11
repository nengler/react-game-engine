/**
 * Where a sound goes when it is played. The runtime has no audio of its own: a player installs a
 * sink with `setSoundSink`, and every `Sound` reports to it. With no sink installed (the tests, a
 * game that is not running in a player) sounds only count their plays.
 */
export interface SoundSink {
  /** A sound was created: load it now, so it does not hitch the first time it plays. */
  load(path: string): void;
  /** A sound was played, at `volume` (0 to 1). Called after `plays` is counted; loads the file first if it was never loaded. A sound played again while it still sounds plays over itself. */
  play(path: string, volume: number): void;
  /** A `<Music>` was created: open the stream now. Optional: without it music is silent. */
  loadMusic?(path: string): void;
  /** Start the stream from the beginning at `volume`; `loop` repeats it. */
  playMusic?(path: string, volume: number, loop: boolean): void;
  setMusicVolume?(path: string, volume: number): void;
  stopMusic?(path: string): void;
}

let sink: SoundSink | null = null;
/** Files a sound store will play (`createSounds`): loaded by every sink when it is installed, as a `Sound` is when it is made. */
const preloads = new Set<string>();

/** Install the sink sounds report to, or `null` to remove it. One sink at a time: the last one installed wins. */
export function setSoundSink(next: SoundSink | null): void {
  sink = next;
  if (next !== null) for (const path of preloads) next.load(path);
}

/** Load `path` with the sink now, and with any sink installed later. What `createSounds` does for each of its files. */
export function addSoundPreload(path: string): void {
  if (preloads.has(path)) return;
  preloads.add(path);
  sink?.load(path);
}

/** The installed sink, so a player can tell whether it is still the one in place when it closes. */
export function getSoundSink(): SoundSink | null {
  return sink;
}

/**
 * A sound a component can play (`const playHit = useSound("hit.wav")`). The runtime has no
 * audio backend: `play(volume?)` counts the call, so a game's logic can be tested, and reports to the
 * installed `SoundSink`, if any. Playing is an effect, not state: it takes place at once and never
 * renders anything.
 */
export class Sound {
  readonly path: string;
  /** How many times `play()` has been called. */
  plays = 0;

  constructor(path: string) {
    this.path = path;
    sink?.load(path);
  }

  /** Play it, at `volume` (0 to 1, default 1), over any play of it that is still sounding. */
  play(volume = 1): void {
    this.plays++;
    sink?.play(this.path, volume);
  }
}
