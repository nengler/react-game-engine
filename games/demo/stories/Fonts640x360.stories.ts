import { stories } from "@tsengine/player";
import { BUILTIN_FONTS } from "@tsengine/runtime";

import { FontSampler } from "../generated/FontSampler.ts";

/** The built-in fonts on a 640 × 360 screen: all of them, then the ones made for it, one at a time. */
export default stories(FontSampler, { size: [640, 360], scale: 2, background: "#10131c" });

export const All640x360 = { fonts: BUILTIN_FONTS, width: 640 };
export const Arcade = { width: 640, font: "tse:arcade" };
export const Unscii = { width: 640, font: "tse:unscii" };
export const UnsciiThin = { width: 640, font: "tse:unscii-thin" };
export const Jersey10 = { width: 640, font: "tse:jersey10" };
export const UnsciiTall = { width: 640, font: "tse:unscii-tall" };
