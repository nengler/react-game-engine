/**
 * Compiles components, imports the generated TypeScript, and exercises the
 * resulting classes against the mock runtime.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, GameObject, Sprite, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, sameOrder, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

type Setter<T> = (value: T | ((previous: T) => T)) => void;

interface PlayerInstance extends Entity {
  health: number;
  setHealth: Setter<number>;
  readonly sprite: Sprite;
  readonly collider: Collider;
  warningIcon: Entity | null;
}

interface LevelInstance extends Entity {
  wave: number;
  bossVisible: boolean;
  setWave: Setter<number>;
  setBossVisible: Setter<boolean>;
  readonly enemy: Entity;
  readonly enemy2: Entity;
  enemy3: Entity | null;
  entity: Entity | null;
  sprite: Sprite | null;
  collider: Collider | null;
}

const PLAYER = `
function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity name="Player">
      <Sprite image={health > 50 ? "normal.png" : "hurt.png"} />
      <Collider width={16} height={24} />
      {health < 25 && <WarningIcon />}
    </Entity>
  );
}

function WarningIcon() {
  return (
    <Entity name="Warning">
      <Sprite image="warning.png" />
    </Entity>
  );
}
`;

const LEVEL = `
function Enemy() {
  return (
    <Entity name="Enemy">
      <Sprite image="enemy.png" />
      <Collider width={20} height={20} />
    </Entity>
  );
}

function Level() {
  const [wave, setWave] = useState(1);
  const [bossVisible, setBossVisible] = useState(false);
  return (
    <Entity name="Level">
      <Enemy />
      <Enemy />
      {wave >= 3 && <Enemy />}
      {bossVisible && (
        <Entity name="Boss">
          <Sprite image={wave > 5 ? "boss-enraged.png" : "boss.png"} />
          <Collider width={64} height={64} />
        </Entity>
      )}
    </Entity>
  );
}
`;

let Player: new () => PlayerInstance;
let WarningIcon: new () => Entity;
let Level: new () => LevelInstance;
let Enemy: new () => Entity;

before(async () => {
  ({ Player, WarningIcon } = await load<{ Player: typeof Player; WarningIcon: typeof WarningIcon }>(compile(PLAYER, "Player.tsx")));
  ({ Level, Enemy } = await load<{ Level: typeof Level; Enemy: typeof Enemy }>(compile(LEVEL, "Level.tsx")));
});

function mountPlayer(): { world: World; player: PlayerInstance } {
  const world = new World();
  const player = new Player();
  world.mount(player);
  return { world, player };
}

describe("generated component instances", () => {
  it("are ordinary classes extending the runtime Entity", () => {
    const player = new Player();
    assert.ok(player instanceof Entity);
    assert.ok(player instanceof GameObject);
    assert.equal(player.name, "Player");
  });

  it("hold state as persistent instance fields", () => {
    const player = new Player();
    assert.equal(player.health, 100);
    assert.ok(Object.hasOwn(player, "health"));
  });

  it("instantiate static children once, as persistent fields attached to the instance", () => {
    const player = new Player();
    assert.ok(player.sprite instanceof Sprite);
    assert.ok(player.collider instanceof Collider);
    sameOrder(player.children, [player.sprite, player.collider]);
    assert.equal(player.sprite.parent, player);
    assert.equal(player.sprite.image, "normal.png");
    assert.equal(player.collider.width, 16);
    assert.equal(player.collider.height, 24);
    assert.equal(player.warningIcon, null);
  });
});

describe("state setters", () => {
  it("mark the object dirty and apply the value at the next render (React's snapshot semantics)", () => {
    const { world, player } = mountPlayer();
    assert.equal(player.isDirty, false);
    player.setHealth(80);
    assert.equal(player.isDirty, true);
    assert.equal(player.health, 100, "reads keep the value from the last render until it re-renders");
    world.flush();
    assert.equal(player.health, 80);
  });

  it("accept an updater function, chained on pending updates", () => {
    const { world, player } = mountPlayer();
    player.setHealth((previous) => previous - 30);
    player.setHealth((previous) => previous - 30);
    world.flush();
    assert.equal(player.health, 40);
  });

  it("with a plain value, last write wins, as in React's `setN(n + 1); setN(n + 1)`", () => {
    const { world, player } = mountPlayer();
    player.setHealth(player.health - 10);
    player.setHealth(player.health - 10);
    world.flush();
    assert.equal(player.health, 90);
  });

  it("do not mark the object dirty when the value is unchanged", () => {
    const player = new Player();
    player.setHealth(100);
    assert.equal(player.isDirty, false);
  });

  it("schedule a single render per flush, however many times state changes", () => {
    const { world, player } = mountPlayer();
    player.setHealth(90);
    player.setHealth(60);
    player.setHealth(40);
    assert.equal(world.flush(), 1);
    assert.equal(player.isDirty, false);
    assert.equal(world.flush(), 0);
  });

  it("do not change dependent props until the world renders", () => {
    const { world, player } = mountPlayer();
    player.setHealth(10);
    assert.equal(player.sprite.image, "normal.png");
    world.flush();
    assert.equal(player.sprite.image, "hurt.png");
  });
});

describe("updaters written in place", () => {
  // In a hook, `setN((n) => …)` with one expression is generated as an assignment to the pending value, not a call.
  const COUNTER = `
interface CounterProps { step: number }
function Counter({ step }: CounterProps) {
  const [n, setN] = useState(0);
  const [still, setStill] = useState(7);
  const [items, setItems] = useState<number[]>([]);
  const [big, setBig] = useState(0);
  useUpdate((dt) => {
    const n2 = n;
    setN((n) => n + step);
    setN((n) => n + step);
    setN((dt) => dt + n2 * 0);
    setStill((s) => s);
    setBig((b) => { if (b > 2) return 0; return b + 1; });
  });
  useInput((input) => {
    if (input.down("A")) setItems((items) => [...items, items.length]);
  });
  return <Entity name="Counter"><Pointer width={1} height={1} onPress={() => setN((n) => n + 100)} /></Entity>;
}

function Idle() {
  const [still, setStill] = useState(7);
  useUpdate(() => { setStill((s) => s); });
  return <Entity name="Idle" />;
}
`;
  interface CounterInstance extends Entity {
    n: number;
    still: number;
    items: number[];
    big: number;
    setN: Setter<number>;
  }
  let Counter: new (props: { step: number }) => CounterInstance;
  let Idle: new () => Entity;
  let code = "";

  before(async () => {
    const compiled = compile(COUNTER);
    code = compiled.code;
    assert.deepEqual(typeCheck(compiled).map((d) => d.message), [], "the generated code type-checks");
    ({ Counter, Idle } = await load<{ Counter: typeof Counter; Idle: typeof Idle }>(compiled));
  });

  it("are assignments in a hook, and stay calls in a callback and when the updater has statements", () => {
    assert.match(code, /const n = this\.#nNext;\n\s+this\.#nNext = n \+ this\.props\.step;\n\s+if \(this\.#nNext !== n\) this\.markDirty\(\);/);
    assert.equal(code.match(/this\.setN\(/g)?.length, 1, "only the callback calls the setter");
    assert.match(code, /onPress: \(\) => \{ this\.setN\(\(n: number\) => n \+ 100\); \}/);
    assert.match(code, /this\.setBig\(\(b: number\) => \{/);
    assert.doesNotMatch(code, /this\.setStill\(|this\.setItems\(/);
  });

  it("chain on the pending value, show at the next render, and render once", () => {
    const world = new World();
    const counter = new Counter({ step: 3 });
    world.mount(counter);
    assert.equal(world.tick(0.5), 1, "one render for the frame's five updates");
    assert.equal(counter.n, 6, "the second updater saw what the first left; the third added nothing");
    assert.equal(counter.big, 1);
    world.tick(0.5);
    assert.equal(counter.n, 12);
    // A call to the setter and an updater in place work on the same pending value.
    counter.setN((n) => n + 100);
    world.tick(0.5);
    assert.equal(counter.n, 118);
  });

  it("take the updater's parameter over a state, a local or the hook's own parameter of the same name", () => {
    const world = new World();
    const counter = new Counter({ step: 1 });
    world.mount(counter);
    // `setN((dt) => dt + n2 * 0)` is the previous n, not the frame's dt; `(n) => n + step` reads the pending n, not the rendered one.
    world.tick(1000);
    assert.equal(counter.n, 2);
  });

  it("do not ask for a render when the value comes out the same", () => {
    const world = new World();
    const idle = new Idle();
    world.mount(idle);
    world.flush();
    assert.equal(world.tick(0.1), 0);
    assert.equal(idle.isDirty, false);
  });

  it("ask for one when it comes out different by identity, as for a new array", () => {
    const world = new World();
    const counter = new Counter({ step: 0 });
    world.mount(counter);
    world.tick(0.1, { down: (key: string) => key === "A", pressed: () => false, released: () => false, lastPressed: () => undefined, pointerX: 0, pointerY: 0 });
    world.tick(0.1, { down: (key: string) => key === "A", pressed: () => false, released: () => false, lastPressed: () => undefined, pointerX: 0, pointerY: 0 });
    assert.deepEqual(counter.items, [0, 1]);
  });
});

describe("what a render reports", () => {
  // A generated `render()` writes only what differs and tells the object it wrote to: `markMoved` for a transform,
  // `markChanged` for anything else. The stamps are `[self, subtree, content]` (see GameObject.markMoved).
  const DRIFTER = `
interface DrifterProps { tint: string }
function Drifter({ tint }: DrifterProps) {
  const [x, setX] = useState(0);
  const [ticks, setTicks] = useState(0);
  useUpdate(() => {
    setTicks((t) => t + 1);
    if (ticks < 3) setX((x) => x + 10);
  });
  return (
    <Entity transform={{ x }}>
      <Shape kind="rect" width={4} height={4} color={tint} />
      <Shape kind="rect" width={2} height={2} transform={{ y: ticks > 5 ? 1 : 0 }} />
    </Entity>
  );
}
`;
  interface DrifterInstance extends Entity {
    x: number;
    ticks: number;
    readonly shape: GameObject & { color: string };
    readonly shape2: GameObject;
    updateProps(next: { tint?: string }): void;
  }
  let Drifter: new (props: { tint: string }) => DrifterInstance;
  const stamps = (object: GameObject): number[] => [object.selfChangedAt, object.subtreeChangedAt, object.contentChangedAt];

  before(async () => {
    const compiled = compile(DRIFTER);
    assert.deepEqual(typeCheck(compiled).map((d) => d.message), []);
    ({ Drifter } = await load<{ Drifter: typeof Drifter }>(compiled));
  });

  it("a move of the component only, nothing for a render that draws the same, and each element it really changed", () => {
    const world = new World();
    const drifter = new Drifter({ tint: "red" });
    world.mount(drifter);
    const frame = (serial: number): void => {
      world.serial = serial;
      world.tick(0.1);
    };
    frame(1);
    frame(2);
    assert.equal(drifter.transform.x, 20);
    assert.deepEqual(stamps(drifter), [2, 2, 0], "it moved; what it draws did not change");
    assert.deepEqual(stamps(drifter.shape), [0, 0, 0]);
    frame(3);
    frame(4);
    frame(5);
    assert.equal(drifter.ticks, 5, "it still renders every frame");
    assert.equal(drifter.transform.x, 30);
    assert.deepEqual(stamps(drifter), [3, 3, 0], "but the renders after the third changed nothing that is drawn");

    world.serial = 6;
    drifter.updateProps({ tint: "blue" });
    world.tick(0.1);
    assert.equal(drifter.shape.color, "blue");
    assert.deepEqual(stamps(drifter.shape), [6, 6, 6], "the shape was told");
    assert.deepEqual(stamps(drifter), [3, 6, 6], "so the component's content changed, though it did not move");
    // The same render took ticks past 5, which moves the second shape inside the component: a move of that shape.
    assert.equal(drifter.shape2.transform.y, 1);
    assert.deepEqual(stamps(drifter.shape2), [6, 6, 0]);

    frame(7);
    frame(8);
    assert.deepEqual(stamps(drifter), [3, 6, 6], "and nothing since");
    assert.deepEqual(stamps(drifter.shape2), [6, 6, 0]);
  });

  it("writes every value of a group when any one differs, and reports a change of the root's own props", async () => {
    const compiled = compile(`
function Tag() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [n, setN] = useState(0);
  useInput((input) => {
    if (input.pressed("Y")) setY((y) => y + 5);
    if (input.pressed("X")) setX((x) => x + 5);
    if (input.pressed("N")) setN((n) => n + 1);
  });
  return <Text transform={{ x, y }}>{\`n\${n}\`}</Text>;
}
`);
    assert.deepEqual(typeCheck(compiled).map((d) => d.message), []);
    const { Tag } = await load<{ Tag: new () => GameObject & { text: string } }>(compiled);
    const world = new World();
    const tag = new Tag();
    world.mount(tag);
    const press = (key: string, serial: number): void => {
      world.serial = serial;
      world.tick(0.1, { pressed: (k: string) => k === key, down: () => false, released: () => false, lastPressed: () => undefined, pointerX: 0, pointerY: 0 });
    };
    press("Y", 1); // only the second of the two transform values changes
    assert.deepEqual([tag.transform.x, tag.transform.y], [0, 5]);
    assert.deepEqual(stamps(tag), [1, 1, 0], "a move");
    press("X", 2);
    assert.deepEqual([tag.transform.x, tag.transform.y], [5, 5]);
    press("N", 3); // the text is a prop of the root itself
    assert.equal(tag.text, "n1");
    assert.deepEqual(stamps(tag), [3, 3, 3], "a change of what it draws");
  });
});

describe("dynamic props", () => {
  it("update the existing child instance; the Sprite keeps its identity", () => {
    const { world, player } = mountPlayer();
    const sprite = player.sprite;
    const collider = player.collider;

    player.setHealth(40);
    world.flush();
    assert.equal(player.sprite, sprite, "Sprite instance must be the same object after a state update");
    assert.equal(sprite.image, "hurt.png");

    player.setHealth(90);
    world.flush();
    assert.equal(player.sprite, sprite);
    assert.equal(sprite.image, "normal.png");

    assert.equal(player.collider, collider);
    assert.equal(player.children[0], sprite);
    assert.equal(player.children[1], collider);
  });
});

describe("conditional children", () => {
  it("are created when their condition becomes true", () => {
    const { world, player } = mountPlayer();
    player.setHealth(20);
    world.flush();

    const warning = player.warningIcon;
    assert.ok(warning instanceof WarningIcon);
    assert.equal(warning.parent, player);
    assert.ok(player.children.includes(warning));
    assert.equal(warning.world, world);
    // The nested component built its own persistent children.
    assert.equal((warning.children[0] as Sprite).image, "warning.png");
  });

  it("are not recreated while the condition stays true", () => {
    const { world, player } = mountPlayer();
    player.setHealth(20);
    world.flush();
    const warning = player.warningIcon;
    player.setHealth(10);
    world.flush();
    assert.equal(player.warningIcon, warning);
    assert.equal(player.children.filter((c) => c instanceof WarningIcon).length, 1);
  });

  it("are removed when their condition becomes false", () => {
    const { world, player } = mountPlayer();
    player.setHealth(20);
    world.flush();
    const warning = player.warningIcon;
    assert.ok(warning);

    player.setHealth(30);
    world.flush();
    assert.equal(player.warningIcon, null);
    assert.ok(!player.children.includes(warning));
    assert.equal(warning.parent, null);
    assert.equal(warning.world, null);
    // Static children are untouched by structural changes.
    sameOrder(player.children, [player.sprite, player.collider]);
  });

  it("are applied as queued structural changes after rendering", () => {
    const world = new World();
    const player = new Player();
    world.mount(player);
    player.setHealth(20);
    player.runRender(); // render without committing structure
    assert.ok(player.warningIcon, "instance is created during render");
    assert.ok(!player.children.includes(player.warningIcon), "...but attached only on commit");
    assert.equal(player.hasPendingStructure, true);
    world.flush();
    assert.ok(player.children.includes(player.warningIcon));
  });

  it("are present immediately when the condition is true at construction", async () => {
    const { Low } = await load<{ Low: new () => Entity & { warningIcon: Entity | null } }>(
      compile(`
        function Low() {
          const [health, setHealth] = useState(5);
          return <Entity>{health < 25 && <WarningIcon />}</Entity>;
        }
        function WarningIcon() { return <Entity />; }
      `),
    );
    const low = new Low();
    assert.ok(low.warningIcon);
    sameOrder(low.children, [low.warningIcon]);
  });
});

describe("nested components", () => {
  it("instantiate local components as persistent children", () => {
    const level = new Level();
    assert.ok(level.enemy instanceof Enemy);
    assert.ok(level.enemy2 instanceof Enemy);
    assert.notEqual(level.enemy, level.enemy2);
    sameOrder(level.children, [level.enemy, level.enemy2]);
    assert.equal(level.enemy.name, "Enemy");
    const [sprite, collider] = level.enemy.children;
    assert.ok(sprite instanceof Sprite && collider instanceof Collider);
    assert.equal(sprite.image, "enemy.png");
    assert.equal(collider.width, 20);
  });

  it("create and destroy conditional nested components", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);

    level.setWave(3);
    world.flush();
    assert.ok(level.enemy3 instanceof Enemy);
    sameOrder(level.children, [level.enemy, level.enemy2, level.enemy3]);

    level.setWave(2);
    world.flush();
    assert.equal(level.enemy3, null);
    sameOrder(level.children, [level.enemy, level.enemy2]);
  });

  it("mount a conditional child between its source siblings, not at the end (draw order)", async () => {
    const { Ordered } = await load<{ Ordered: new () => Entity & { setShow: Setter<boolean>; setInner: Setter<boolean> } }>(
      compile(`function Ordered() {
  const [show, setShow] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <Entity>
      <Sprite image="a" />
      {show && <Sprite image="b" />}
      <Sprite image="c" />
      {show && (
        <Entity name="group">
          <Sprite image="d" />
          {inner && <Sprite image="e" />}
          <Sprite image="f" />
        </Entity>
      )}
      <Sprite image="g" />
    </Entity>
  );
}`),
    );
    const images = (o: GameObject): string[] => o.children.map((c) => (c instanceof Sprite ? c.image : (c as Entity).name));
    const world = new World();
    const ordered = new Ordered();
    world.mount(ordered);
    assert.deepEqual(images(ordered), ["a", "c", "g"]);

    ordered.setShow(true);
    ordered.setInner(true);
    world.flush();
    assert.deepEqual(images(ordered), ["a", "b", "c", "group", "g"]);
    assert.deepEqual(images(ordered.children[3]!), ["d", "e", "f"]);

    // Unmount and remount: the slot is reused, not appended.
    ordered.setShow(false);
    world.flush();
    assert.deepEqual(images(ordered), ["a", "c", "g"]);
    ordered.setShow(true);
    world.flush();
    assert.deepEqual(images(ordered), ["a", "b", "c", "group", "g"]);
  });

  it("mount a conditional subtree with its own static and dynamic children", () => {
    const world = new World();
    const level = new Level();
    world.mount(level);

    level.setBossVisible(true);
    world.flush();
    const boss = level.entity;
    assert.ok(boss && boss.name === "Boss");
    assert.ok(level.children.includes(boss));
    sameOrder(boss.children, [level.sprite, level.collider]);
    const bossSprite = level.sprite;
    assert.equal(bossSprite?.image, "boss.png");

    // A dynamic prop inside the conditional subtree updates in place.
    level.setWave(6);
    world.flush();
    assert.equal(level.sprite, bossSprite);
    assert.equal(bossSprite?.image, "boss-enraged.png");

    // Unmounting removes the subtree and releases every field in it.
    level.setBossVisible(false);
    world.flush();
    assert.equal(level.entity, null);
    assert.equal(level.sprite, null);
    assert.equal(level.collider, null);
    assert.ok(!level.children.includes(boss));
  });
});
