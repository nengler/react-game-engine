/**
 * The game's entry point. A host installs the backend and then loads this file:
 *
 *   npm run play:hearth
 */
import { hostBackend, run } from "@tsengine/player";

import { gameConfig } from "./game.ts";

run(hostBackend(), gameConfig);
