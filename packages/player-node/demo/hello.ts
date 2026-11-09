/**
 * A stand-in game for `play.ts` until the real demo (N4): a square that moves with the arrow keys,
 * a label, and a camera that follows the square.
 *
 *   node packages/player-node/src/play.ts packages/player-node/demo/hello.ts
 */
import { Camera, Entity, GameObject, Shape, Text, type InputState } from "@rge/runtime";
import { hostBackend, run } from "@rge/player";

class Mover extends Entity {
  // Position is plain runtime state here; compiled components get it from `transform={{ x, y }}`.
  override onInput(input: InputState): void {
    const speed = 3;
    if (input.down("ArrowLeft") || input.down("A")) this.transform.x -= speed;
    if (input.down("ArrowRight") || input.down("D")) this.transform.x += speed;
    if (input.down("ArrowUp") || input.down("W")) this.transform.y -= speed;
    if (input.down("ArrowDown") || input.down("S")) this.transform.y += speed;
  }
}

run(hostBackend(), {
  width: 640,
  height: 360,
  title: "rge hello",
  background: "#1d2330",
  root: (): GameObject => {
    const world = new Entity();
    const mover = new Mover();
    mover.addChild(new Shape({ kind: "rect", width: 24, height: 24, color: "gold" }));
    const camera = new Camera();
    camera.addChild(mover);
    world.addChild(camera);
    world.addChild(new Shape({ kind: "circle", width: 40, height: 40, color: "tomato" }));
    world.addChild(new Text({ text: "Arrow keys or WASD to move", size: 16, color: "white" }));
    return world;
  },
});
