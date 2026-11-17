import { stories } from "@tsengine/player";
import { BUILTIN_FONTS } from "@tsengine/runtime";

import { FontSampler } from "../generated/FontSampler.ts";

/** The built-in fonts on a 480 × 270 screen: all of them, then the ones made for it, one at a time. */
export default stories(FontSampler, { size: [480, 270], scale: 2, background: "#10131c" });

export const All480x270 = { fonts: BUILTIN_FONTS, width: 480 };
export const M5x7 = { width: 480, font: "tse:m5x7" };
export const Silkscreen = { width: 480, font: "tse:silkscreen" };
export const Caps = { width: 480, font: "tse:caps" };
