import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGameState, Entity, Game, Screen, Text, type GameObject } from "@tsengine/runtime";

import { gameLook, runScript, stories, storiesIn, story, storyRoot } from "../src/index.ts";

const useScore = createGameState({ score: 0 }, {});

/** A hand-written component, as the compiler would make one: a label of its props and the score. */
class Badge extends Entity<{ label: string }> {
  readonly text: Text;
  constructor(props: { label: string }) {
    super({ name: "Badge" }, props);
    this.text = new Text({ text: `${props.label} ${useScore.getState().score}` });
    this.addChild(this.text);
  }
}

const file = {
  default: stories(Badge, { size: [40, 10], origin: [2, 3], scale: 2 }),
  Plain: { label: "plain" },
  Scored: story({ label: "scored" }, { setup: () => useScore.setState({ score: 7 }), input: "Space, _" }),
  helper: (n: number) => n,
};

describe("stories", () => {
  it("lists every export but the default as a story, in order, with its props and options", () => {
    const loaded = storiesIn(file, "Badge.stories.ts");
    assert.deepEqual(
      loaded.map((s) => [s.id, s.props]),
      [
        ["Badge/Plain", { label: "plain" }],
        ["Badge/Scored", { label: "scored" }],
      ]
    );
    assert.equal(loaded[1]!.options.input, "Space, _");
  });

  it("refuses a file without stories(…) as its default export, or with no size", () => {
    assert.throws(() => storiesIn({ A: {} }, "x.stories.ts"), /default export must be stories/);
    assert.throws(() => storiesIn({ default: stories(Badge, { size: [0, 10] }) }, "x.stories.ts"), /size must be two numbers/);
  });

  it("builds a Game with the game's look, a Screen of the story's size, and the component at its origin, after resetting game state", () => {
    useScore.setState({ score: 99 });
    const [plain, scored] = storiesIn(file, "Badge.stories.ts");
    const look = gameLook(new Game({ background: "#123456", font: "font.png", textSize: 10, title: "Not this", width: 999 }));
    assert.deepEqual(look, { background: "#123456", font: "font.png", textSize: 10 });

    const root = storyRoot(plain!, look) as Game;
    assert.ok(root instanceof Game);
    assert.equal(root.background, "#123456");
    assert.equal(root.font, "font.png");
    assert.deepEqual([root.width, root.height, root.title], [80, 20, "Badge/Plain"]);
    const screen = root.children[0] as Screen;
    assert.ok(screen instanceof Screen);
    assert.deepEqual([screen.width, screen.height], [40, 10]);
    const holder = screen.children[0] as GameObject;
    assert.equal(holder.hotKey, "Badge/Plain", "keyed by the story, so a reload keeps state and another story does not");
    assert.deepEqual([holder.transform.x, holder.transform.y], [2, 3]);
    assert.equal((holder.children[0] as Badge).text.text, "plain 0", "game state was reset");

    const other = storyRoot(scored!, look);
    const badge = ((other.children[0] as Screen).children[0] as GameObject).children[0] as Badge;
    assert.equal(badge.text.text, "scored 7", "setup ran before the component was made");
  });

  it("is a root the player runs, at the story's size times its scale", () => {
    const [plain] = storiesIn(file, "Badge.stories.ts");
    const { backend } = runScript({ root: () => storyRoot(plain!, {}) }, [{}], () => null);
    assert.deepEqual([backend.config?.width, backend.config?.height], [80, 20]);
    assert.ok(backend.lastFrame.records.some((r) => r.op === "text" && r.text === "plain 0"));
  });
});
