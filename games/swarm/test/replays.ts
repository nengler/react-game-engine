/**
 * Input scripts that play the game. The player walks a slow figure of eight, so the crowd follows them round and the ground keeps
 * scrolling, and presses 1 every second or so, which takes the first upgrade whenever a level-up is waiting (and does nothing
 * otherwise).
 */
const LOOP = [
  "right*90+one",
  "right*30+down*60",
  "down*60+one",
  "left*90",
  "left*30+up*60+one",
  "up*60",
  "left*90+one",
  "left*30+down*60",
  "down*60+one",
  "right*90",
  "right*30+up*60+one",
  "up*60",
];

/** `seconds` of walking the loop, after starting from the title. */
export function walk(seconds: number): string {
  const out: string[] = ["confirm", "_*5"];
  let frames = 0;
  for (let i = 0; frames < seconds * 60; i++) {
    const item = LOOP[i % LOOP.length]!;
    out.push(item, "_");
    frames += Math.max(...[...item.matchAll(/\*(\d+)/g)].map((m) => Number(m[1]))) + 1;
  }
  return out.join(", ");
}
