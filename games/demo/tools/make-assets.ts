/**
 * Writes the demo's assets from Kenney's free CC0 packs (kenney.nl), copied into `tools/kenney/`: two 16 × 16 frames of a
 * waving flag for the beacon (Pixel Platformer's 18 × 18 tiles 111 and 112, shrunk) and a click (Interface Sounds). There is
 * deliberately no `beacon-gone.png`: the third frame of the beacon's animation is missing, to show the placeholder. Run with
 * `npm run demo:assets`; the outputs are committed.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { kenneyFolder, nearest, save } from "../../../tools/sprite-kit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kenney = kenneyFolder(join(here, "kenney"));
const assets = join(here, "../assets");
mkdirSync(assets, { recursive: true });

save(assets, "beacon-1.png", nearest(kenney("pixel-platformer-0111"), 16, 16));
save(assets, "beacon-2.png", nearest(kenney("pixel-platformer-0112"), 16, 16));
copyFileSync(join(here, "kenney", "interface-sounds-click-001.wav"), join(assets, "click.wav"));
console.log("wrote", assets);
