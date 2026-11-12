/** Packed 0xRRGGBBAA, as an unsigned integer. */
export type PackedColor = number;

export const MAGENTA: PackedColor = 0xff00ffff;

export function packColor(r: number, g: number, b: number, a: number): PackedColor {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

/** `#rrggbbaa`, for tests and logs. */
export function colorToHex(color: PackedColor): string {
  return `#${(color >>> 0).toString(16).padStart(8, "0")}`;
}

// The CSS named colours, as 0xRRGGBB.
const NAMED: Readonly<Record<string, number>> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4, azure: 0xf0ffff,
  beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd, blue: 0x0000ff,
  blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00,
  chocolate: 0xd2691e, coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c,
  cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9,
  darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3, deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969,
  dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4,
  indianred: 0xcd5c5c, indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6, lightcoral: 0xf08080,
  lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3, lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a, lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899, lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff,
  maroon: 0x800000, mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585, midnightblue: 0x191970, mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1, moccasin: 0xffe4b5, navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6,
  olive: 0x808000, olivedrab: 0x6b8e23, orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd,
  powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57,
  seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f, steelblue: 0x4682b4,
  tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8, tomato: 0xff6347, turquoise: 0x40e0d0,
  violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00,
  yellowgreen: 0x9acd32,
};

/** How many named colours the table holds (CSS Color 4 has 148). */
export const NAMED_COLOR_COUNT = Object.keys(NAMED).length;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FUNCTION = /^rgba?\(([^)]*)\)$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/;

/** A number, or a percentage of `full`; null if it is neither. */
function channel(text: string, full: number): number | null {
  const percent = text.endsWith("%");
  const body = percent ? text.slice(0, -1) : text;
  if (!NUMBER.test(body)) return null;
  const value = Number(body);
  return percent ? (value / 100) * full : value;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Parse a CSS colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` (commas or
 * spaces, alpha as a number from 0 to 1 or a percentage), a named colour, or `transparent`.
 * Null if the text is none of these.
 */
export function parseColor(input: string): PackedColor | null {
  const text = input.trim().toLowerCase();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1] as string;
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    if (digits.length === 6) digits += "ff";
    return Number.parseInt(digits, 16) >>> 0;
  }
  const fn = FUNCTION.exec(text);
  if (fn) {
    const parts = (fn[1] as string).split(/[\s,/]+/).filter((part) => part !== "");
    if (parts.length !== 3 && parts.length !== 4) return null;
    const rgb = parts.slice(0, 3).map((part) => channel(part, 255));
    const alpha = parts.length === 4 ? channel(parts[3] as string, 1) : 1;
    if (alpha === null || rgb.some((value) => value === null)) return null;
    const [r, g, b] = rgb as number[];
    return packColor(Math.round(clamp(r as number, 0, 255)), Math.round(clamp(g as number, 0, 255)), Math.round(clamp(b as number, 0, 255)), Math.round(clamp(alpha, 0, 1) * 255));
  }
  if (text === "transparent") return 0;
  if (Object.hasOwn(NAMED, text)) return (((NAMED[text] as number) << 8) | 0xff) >>> 0;
  return null;
}

/** The colour `t` of the way (0 to 1) from `a` to `b`, channel by channel. */
export function mixColors(a: PackedColor, b: PackedColor, t: number): PackedColor {
  const mix = (shift: number): number => Math.round(((a >>> shift) & 255) * (1 - t) + ((b >>> shift) & 255) * t);
  return (((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0);
}
