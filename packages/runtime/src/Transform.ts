/**
 * Position data that changes every frame. Not reactive: writing a field never
 * marks anything dirty, because a renderer reads transforms directly each frame.
 */
export class Transform {
  x = 0;
  y = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
}
