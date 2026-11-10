/**
 * One input script per room, played one after the other from the start of the game: each finishes its room from where the
 * one before left the character, and waits out the camera's slide. Found by `tools/solve.ts`, which writes this file;
 * `test/rooms.test.ts` plays them. Rooms 1 and 2 are found without the dash.
 */
export const REPLAYS: readonly string[] = [
  // 1. First steps
  "right*4+jump*4, right*16, right*4+jump*4, _*4, right*12+jump*12, right*4, right*4+jump*4, _*4, right*4+jump*4, right*4, _*8, right*4+jump*4, _*8, right*8, right*4+jump*4, _*8, right*4, right*4+jump*4, jump*4, right*4+jump*4, right*8, right*4+jump*4, right*8, right*4+jump*4, _*4, right*8, right*4+jump*4, jump*8, right*4, right*4+jump*4, right*4, _*4, _*25",
  // 2. Stepping stones
  "right*16, right*4+jump*4, jump*4, right*4, right*4+jump*4, right*4, _*8, right*4+jump*4, _*8, right*4, right*4+jump*4, jump*8, right*4, right*4+jump*4, right*4, right*4+jump*4, _*4, right*12, right*4+jump*4, jump*4, right*4, right*4+jump*4, right*4, _*4, right*4, right*4+jump*4, _*8, right*4, right*4+jump*4, _*4, jump*4, right*8+jump*8, right*8, right*4+jump*4, _*4, right*4+jump*4, _*4, _*25",
  // 3. Dash across
  "right+down+dash, right*3+down*3, _*12, down+dash, down*3, dash, _*11, right*4, right*4+jump*4, _*4, dash, _*11, jump*4, _*8, dash, _*11, right*4, dash, _*11, right*4, dash, _*15, _*25",
  // 4. Dash up
  "dash, _*11, right*4, right+up+dash, right*3+up*3, _*4, jump*4, left*8+jump*8, right*8, right*4+jump*4, jump*4, right*8+jump*8, up+dash, up*3, _*8, right*12, _*25",
  // 5. The shaft
  "left*4+jump*4, jump*4, left*4, jump*12, right*4+jump*4, right*4, right*8+jump*8, up+dash, up*3, _*8, right*8, left*4+jump*4, jump*12, _*4, _*25",
  // 6. Spikes on the wall
  "right*20+jump*20, right*4, left*4+jump*4, right*4+jump*4, jump*8, right*4+jump*4, right*4, right*8+jump*8, right*4, _*4, jump*4, left*4+jump*4, jump*4, right*4+jump*4, right*4, right*12+jump*12, right*4, jump*12, right*12+jump*12, right*4, _*4, right*4, right*4+jump*4, jump*8, right*4+jump*4, right*4, right*8+jump*8, _*4, up+dash, up*3, _*8, right*4, right*4+jump*4, right*4, dash, _*11, right*4, dash, _*11, right*4+jump*4, _*8, _*25",
  // 7. Gem ledge
  "_*8, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right*4, right+down+dash, right*3+down*3, right*4, right+down+dash, right*3+down*3, right*12, right*4+jump*4, jump*4, right*8+jump*8, right*4, right*4+jump*4, up+dash, up*3, _*8, right*4, right*4+jump*4, right*4, dash, _*11, right*4+jump*4, _*16, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right+down+dash, right*3+down*3, right*4, dash, _*11, right*4+jump*4, _*4, _*25",
  // 8. Summit
  "jump*12, right*4, right*4+jump*4, jump*4, right*4+jump*4, dash, _*11, right*4, right+up+dash, right*3+up*3, _*4, right*4+jump*4, jump*4, _*4, left*4+jump*4, right*4+jump*4, right*4, right+jump+dash, right*3+jump*3, _*12, right*4+jump*4, jump*4, _*4, up+dash, up*3, _*8, right*4, right*4+jump*4, right*4, right+up+dash, right*3+up*3, _*8",
];
