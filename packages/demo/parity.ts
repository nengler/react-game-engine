/**
 * Plays the demo for 60 scripted frames against a recording backend and prints everything the player did as
 * one line of JSON (numbers rounded to 1e-9, so a last-bit difference in `Math.sin` between engines does not
 * show). It runs unchanged under Node and, bundled, under the Rust host (QuickJS-ng): the two outputs must be
 * identical, which is the parity check in `test/parity.test.ts`.
 *
 *   node packages/demo/parity.ts
 */
import { createPlayer, RecordingBackend, type InputFrame } from "@rge/player";
import { gameConfig } from "./game.ts";

const dt = 1 / 60;
const script: InputFrame[] = [];
for (let i = 0; i < 20; i++) script.push({ dt, down: ["ArrowRight"] }); // walk right
for (let i = 0; i < 10; i++) script.push({ dt, down: ["ArrowDown", "D"] }); // and down
script.push({ dt, mouse: { x: 300, y: 200 }, pressed: ["MouseLeft"] }); // a click that misses the button
script.push({ dt });
// The button is on the HUD, so walking has not moved it: it is at x 16-112, y 40-72.
script.push({ dt, mouse: { x: 60, y: 60 }, pressed: ["MouseLeft"] }); // a click on the button
for (let i = 0; i < 28; i++) script.push({ dt: 0.05, down: i % 2 === 0 ? ["A"] : ["W"] }); // wander; longer steps cycle the beacon

const backend = new RecordingBackend({ missingTextures: ["assets/beacon-gone.png"] });
const warnings: string[] = [];
for (const frame of script) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: (message) => warnings.push(message) });
for (let i = 0; i < 60; i++) player.step();
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(
  JSON.stringify(
    {
      frames: backend.frames,
      plays: backend.plays,
      soundLoads: backend.soundLoads,
      textureLoads: backend.textureLoads,
      warnings,
    },
    round,
  ),
);
