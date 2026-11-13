import { stories } from "@rge/player";
import { Title } from "../generated/Title.ts";

/** The title screen and its menu. */
export default stories(Title, { size: [320, 180], scale: 2 });

export const NoSave = {};