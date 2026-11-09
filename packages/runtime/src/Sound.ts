/**
 * A sound a component can play (`const playHit = useSound("hit.wav")`). The
 * mock has no audio backend (a backend is a later step): `play()` only
 * records that it was called, so a game's logic can be tested. Playing is an
 * effect, not state: it takes place at once and never renders anything.
 */
export class Sound {
  readonly path: string;
  /** How many times `play()` has been called. */
  plays = 0;

  constructor(path: string) {
    this.path = path;
  }

  play(): void {
    this.plays++;
  }
}
