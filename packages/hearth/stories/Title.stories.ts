import { stories } from "@tsengine/player";

import { Title } from "../generated/Title.ts";

/** The title screen. */
export default stories(Title, { size: [320, 180], scale: 2 });

export const Default = {};
