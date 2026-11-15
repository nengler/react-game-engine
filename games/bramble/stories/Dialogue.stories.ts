import { stories, story } from "@tsengine/player";

import { Dialogue } from "../generated/Dialogue.ts";
import { useGame } from "../src/GameState.ts";
import type { NpcId } from "../src/rules/dialogue.ts";
import { newRun } from "../src/rules/run.ts";

/** The box a conversation is in, at the bottom of the screen. */
export default stories(Dialogue, { size: [320, 180], scale: 2 });

/** A run talking to `npc`, `shown` characters into its first page. */
const talking = (npc: NpcId, shown: number) => () => useGame.setState({ run: { ...newRun(), talk: { npc, page: 0, shown } } });

/** Halfway through typing the page out. */
export const Typing = story({}, { setup: talking("guide", 20) });
/** The whole page shown, with more to come (`>`). */
export const PageDone = story({}, { setup: talking("guide", 999) });
/** Another speaker, on the last page of what they say (`>` for more). */
export const OtherSpeaker = story({}, { setup: talking("hermit", 999) });
