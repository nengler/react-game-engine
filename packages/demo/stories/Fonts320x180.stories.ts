import { stories } from "@tsengine/player";
import { BUILTIN_FONTS } from "@tsengine/runtime";

import { FontSampler } from "../generated/FontSampler.ts";

/** The built-in fonts on a 320 × 180 screen: all of them, then the ones made for it, one at a time. */
export default stories(FontSampler, { size: [320, 180], scale: 3, background: "#10131c" });

export const All320x180 = { fonts: BUILTIN_FONTS, width: 320 };
export const Small = { width: 320, font: "tse:small" };
export const Micro5 = { width: 320, font: "tse:micro5" };
export const Tiny5 = { width: 320, font: "tse:tiny5" };
