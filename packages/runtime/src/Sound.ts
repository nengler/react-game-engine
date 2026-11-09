/**
 * Where a sound goes when it is played. The runtime has no audio of its own: a player installs a
 * sink with `setSoundSink`, and every `Sound` reports to it. With no sink installed (the tests, a
 * game that is not running in a player) sounds only count their plays.
 */
export interface SoundSink {
  /** A sound was created: load it now, so it does not hitch the first time it plays. */
  load(path: string): void;
  /** A sound was played. Called after `plays` is counted; loads the file first if it was never loaded. */
  play(path: string): void;
}

let sink: SoundSink | null = null;

/** Install the sink sounds report to, or `null` to remove it. One sink at a time: the last one installed wins. */
export function setSoundSink(next: SoundSink | null): void {
  sink = next;
}

/** The installed sink, so a player can tell whether it is still the one in place when it closes. */
export function getSoundSink(): SoundSink | null {
  return sink;
}

/**
 * A sound a component can play (`const playHit = useSound("hit.wav")`). The runtime has no
 * audio backend: `play()` counts the call, so a game's logic can be tested, and reports to the
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

  play(): void {
    this.plays++;
    sink?.play(this.path);
  }
}
