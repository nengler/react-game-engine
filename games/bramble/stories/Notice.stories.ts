import { stories, story } from "@tsengine/player";

import { Notice } from "../generated/Notice.ts";

/** The card that says what just happened. It drops in: `input` waits for it to land. */
export default stories(Notice, { size: [320, 40], scale: 2 });

export const Item = story({ text: "Got the lantern!" }, { input: "_*45" });
export const Bell = story({ text: "Got a bell! (2 of 3)" }, { input: "_*45" });
