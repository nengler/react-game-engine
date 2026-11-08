/**
 * Where an Entity is: position in pixels (y points down), rotation in radians
 * (positive turns clockwise on a y-down screen), and scale. Components set it
 * with the `transform={{ x, y }}` attribute, usually from state; a renderer
 * reads it directly each frame.
 */
export class Transform {
  x = 0;
  y = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
}
