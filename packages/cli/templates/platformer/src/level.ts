/** The level as data: solid boxes, in screen pixels. A plain `.ts` file, so a test or a tool can read it too. */
export interface Block {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const BLOCKS: readonly Block[] = [
  { id: "floor", x: 0, y: 164, width: 320, height: 16 },
  { id: "left", x: 40, y: 124, width: 64, height: 8 },
  { id: "middle", x: 128, y: 96, width: 64, height: 8 },
  { id: "right", x: 216, y: 124, width: 64, height: 8 },
];

/** Where the hero starts: standing on the floor. */
export const START = { x: 152, y: 148 };
