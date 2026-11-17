# Working on this game (for AI agents)

A 2D game made with **tse**: components are written in TSX like React, but a compiler turns each one into a TypeScript class.
There is no React, no DOM and no browser. Everything below runs headless (no window, no GPU) unless it says otherwise.

## Layout

```
src/*.tsx        components: the game's own code. Edit these.
src/*.ts         plain modules: the game state (GameState.ts), rules, tables, pure functions.
generated/       what the compiler writes from src/. Never edit it; `tse build` rewrites it.
game.ts          exports gameConfig (the root), bindings (action names for input scripts) and, optionally, screen.
main.ts          the entry the window and the packaged game run.
test/*.test.ts   node:test tests, importing the generated classes.
parity.ts        a short scripted run that must print the same under Node and the QuickJS host.
assets/          images, fonts, sounds, named by path from components.
```

## Commands

| What | Command |
| --- | --- |
| Compile src to generated | `npx tse build` (`--json` for the diagnostics as data) |
| Everything: compile, type-check, tests, previews, parity | `npx tse check` (`--json`: each step, with diagnostics and test failures as data) |
| One test file | `node --enable-source-maps --test test/hero.test.ts` (run `npx tse build` first) |
| Play it headless, step by step | `npx tse session` (below) |
| A PNG of a scripted run | `npx tse screenshot . --script "right*30" --at 29 --out shots` |
| Play in a window (a person, not you) | `npx tse dev` |

Run `npx tse check` before saying a change is done. Compiler errors are `TSE` codes with the `.tsx` file and line; fix them in
`src/`, never in `generated/`.

## Playing the game headless: `tse session` and `tse mcp`

`npx tse session` compiles the game, starts it without a window and reads one request a line on stdin, answering each with one
line of JSON on stdout. The game only moves when you play input or step it (60 steps a second of game time).

```sh
printf '%s\n' 'input right*30, _*10' 'map' 'observe components' 'press StartButton' 'watch Hero.s.hp' 'step 600' quit | npx tse session
```

| Request | Does |
| --- | --- |
| `input right*30, jump, _*10` | play an input script, one step a frame |
| `step 60`, or `{"cmd":"step","until":{"text":"GAME OVER"},"maxSteps":600}` | run steps with nothing pressed, or until something holds |
| `observe` / `observe components` | the scene as text: every object, its world position, texts, colliders, props and state, plus the game state |
| `map` / `map Hero` | the level drawn in characters, a tile each (`#` solid, other tiles by symbol, with a legend), the game's things marked by letter with their positions |
| `press StartButton` / `press Pad[key=7]` | click a thing by name, as a player would (2 steps); the error lists what can be pressed |
| `watch Play.s.lives` | follow a value: every answer then lists its changes with their frames |
| `state` / `state Hero` | the game state, or every `Hero`'s position and state |
| `texts` | every `<Text>` on screen |
| `snapshot name` / `restore name` | keep the game as it is, and go back to it |
| `reload` | compile the changed source and play this run's input again with the new code (snapshots are kept) |
| `save-test wave one leaks one enemy` | write this run as a test in `test/` (its input played again must end the same) and run it once |
| `replay` / `reset` / `hash` | play the run again exactly / start over / a number for the state (equal states, equal hashes) |
| `screenshot shots/now.png` | draw the game as it is now to a PNG (needs the headless libtse from @tsengine/native) |
| `help` | every command and its arguments |

Every answer also says what happened since the last one: `events` a line a frame (things that came and went, game-state changes,
new texts), `often` (what happened too often to list, counted), `sounds`, and the changes to watched values. A long `step` therefore
tells you what happened in it, not only how it ended.

The usual loop for a bug: play to it (`input`, `step` with `until`), `watch` the value that goes wrong, find the frame, fix the
source, `reload` (the same input plays with the new code), check the value, then `save-test` so it stays fixed.

A request is a JSON object (`{"cmd": "input", "script": "right*30"}`) or a command and its argument as words. `until` takes
`{"text"}`, `{"gone"}`, `{"component", "path"?, "equals"|"not"|"above"|"below", "absent"?}`, or `{"path", …}` on the game state
(`"path": "wave"`, `"path": "enemies.length"`).

`npx tse mcp` is the same session as an MCP server: tools `game_input`, `game_step`, `game_observe`, `game_state`,
`game_snapshot`, `game_restore`, `game_reload`, `game_screenshot` (which returns the picture), and the rest. The game's
`.mcp.json` registers it for Claude Code and other MCP clients that read that file.

### Input scripts

`right*30, jump, right*20+dash, _*10, click@120,64` — items run in order; `name*N` holds for N steps; `+` starts terms together; a
name with no count is a one-step tap; `_` waits. A name is an action from `bindings` in `game.ts` or a key name (`ArrowRight`, `Z`,
`Space`, `Enter`, `Escape`, `PadA`, …). `click@x,y` clicks at a point of the game's canvas. Two taps in a row (`jump, jump`) are one
long press: put `_` between them. The same scripts drive the tests (`t.input(...)`), `runScript`, `tse screenshot` and replays.

## Writing components

A component is a function: hooks first, then **one** `return` of JSX. It is compiled, never run as written.

```tsx
import { Entity, Sprite, Collider, Text, useMutable, useUpdate, useInput, rollBetween } from "@tsengine/runtime/jsx";

export function Enemy({ hp = 3, onDefeated }: { hp?: number; onDefeated: () => void }) {
  const s = useMutable({ hp: hp, x: 0, seed: 1 });   // state: write it directly, s.hp -= 1 (fields are `name: value`)
  useUpdate((dt) => {                                 // every step; movement reads held keys here
    const r = rollBetween(s.seed, 10, 30);            // a random speed that repeats: keep the seed
    s.seed = r.seed;
    s.x += r.value * dt;
    if (s.hp <= 0) onDefeated();
  });
  useInput((input) => { if (input.pressed("Space")) s.hp -= 1; });  // presses go here
  return (
    <Entity x={s.x} y={0}>
      <Sprite image="enemy.png" />
      <Collider width={12} height={12} tag="enemy" onCollisionEnter={(other) => { if (other.tag === "shot") s.hp -= 1; }} />
      {s.hp <= 0 && <Text>down</Text>}
    </Entity>
  );
}
```

What trips people (and models) up:

- **Three zones.** The component body runs on every render and cannot set state. Handlers (`useUpdate`, `useInput`, collision
  callbacks, `onPress`) may change state and run loops. A plain `.ts` file allows anything. A refused call says which zone it is in.
- **Not React.** No `useEffect` (use `useMount` / `useUnmount`, timers `after(seconds, fn)` and `every(seconds, fn)`, or
  `useUpdate`), no `useState` setters, no `useReducer`, no `ref={…}`, no generic components, no `async` handlers, no spreading
  props onto a built-in, no render props. `setTimeout`, `Date.now` and `fetch` are refused, with what to use instead.
- **Random numbers repeat.** `Math.random()` is refused in a component body and warns in a handler: replays, tests and parity
  would not repeat. Use `roll`, `rollBetween`,
  `rollInt`, `rollPick` or `rollChance` from `@tsengine/runtime/jsx`; each returns `{ value, seed }`, and you keep the seed in
  state (`const r = rollInt(s.seed, 1, 6); s.seed = r.seed;`).
- **Placement.** Built-ins take `x` / `y`; a component is placed with `transform={{ x, y }}`. The origin is the top-left and y
  grows downward. Positions in `observe` are world space; a `<Camera>` decides what part of the world is on screen.
- **The game state** lives in `src/GameState.ts` (`createGameState(data, actions)`). Components read it with
  `useGame((s) => s.coins)` and change it only through actions (`const { collect } = useGame.actions(); collect()`).
- **Lists** in JSX need a `key` on each item. A `useMutable` list can be changed in a handler (`s.items.push(x)`), but a helper in
  a `.ts` file that changes one of its items in place is not seen: replace the item instead.
- **Collision callbacks run after `useUpdate`**: read tiles, not colliders, for movement and deaths.

Built-ins: `Entity Game Screen Hud Flex Sprite AnimatedSprite Text Shape Line Collider Camera Pointer Button Menu Slider Toggle
Tooltip TextInput Tilemap Particles ParticleLayer Fade Music Router Route Provider Layer Light Lighting`. Hooks: `useMutable
useUpdate useInput useMount useUnmount useBody useGame useStore useContext useTime useSound useSpring useTween useShake useSquash`.
The engine's authoring guide (`docs/` in the engine's repository) has every prop.

## Testing

Test one component alone with `@tsengine/testing`, as React Testing Library does; test the whole game with `runScript`:

```ts
import { render } from "@tsengine/testing";
import { Enemy } from "../generated/Enemy.ts";

const onDefeated = mock.fn();                               // from node:test
const t = render(Enemy, { hp: 3, onDefeated });
t.input("Space, _, Space");                                // an input script
t.collide("enemy", { tag: "shot" });                        // report a contact
t.stepUntil(() => onDefeated.mock.callCount() > 0, { maxSteps: 600 });  // step until it holds
console.log(t.describe());                                  // the component's tree as text, when a test fails
```

`t.state()` reads a component's own state by its source names (`{ s: { hp: 3 } }`); `t.find("Sprite")`, `t.texts()` and
`t.press("name")` read and click. Assert on behaviour (state, positions, texts), not on draw records. Keep the game
deterministic: the same input must give the same result, which `tse check`'s parity step checks.
