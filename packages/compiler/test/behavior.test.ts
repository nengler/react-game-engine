/**
 * Compiles components, imports the generated TypeScript, and exercises the
 * resulting classes against the mock runtime.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, GameObject, Sprite, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load } from "./helpers.ts";

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
    assert.deepEqual(player.children, [player.sprite, player.collider]);
    assert.equal(player.sprite.parent, player);
    assert.equal(player.sprite.image, "normal.png");
    assert.equal(player.collider.width, 16);
    assert.equal(player.collider.height, 24);
    assert.equal(player.warningIcon, null);
  });
});

describe("state setters", () => {
  it("update the field and mark the object dirty", () => {
    const player = new Player();
    assert.equal(player.isDirty, false);
    player.setHealth(80);
    assert.equal(player.health, 80);
    assert.equal(player.isDirty, true);
  });

  it("accept an updater function", () => {
    const player = new Player();
    player.setHealth((previous) => previous - 30);
    assert.equal(player.health, 70);
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
    assert.deepEqual(player.children, [player.sprite, player.collider]);
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
    assert.deepEqual(low.children, [low.warningIcon]);
  });
});

describe("nested components", () => {
  it("instantiate local components as persistent children", () => {
    const level = new Level();
    assert.ok(level.enemy instanceof Enemy);
    assert.ok(level.enemy2 instanceof Enemy);
    assert.notEqual(level.enemy, level.enemy2);
    assert.deepEqual(level.children, [level.enemy, level.enemy2]);
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
    assert.deepEqual(level.children, [level.enemy, level.enemy2, level.enemy3]);

    level.setWave(2);
    world.flush();
    assert.equal(level.enemy3, null);
    assert.deepEqual(level.children, [level.enemy, level.enemy2]);
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
    assert.deepEqual(boss.children, [level.sprite, level.collider]);
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
