import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { table } from "../tools/balance.ts";

const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "balance.expected.json"), "utf8")) as Record<
  string,
  (number | null)[]
>;

describe("balance", () => {
  const now = table();

  it("matches the checked-in table (a change to a number in the rules is a change in difficulty: run `node games/hearth/tools/balance.ts --write` if you meant it)", () => {
    assert.deepEqual(now, expected);
  });

  it("is meant to play like this: a mixed build wins with lives left, a thin one is lost early, one kind of tower alone struggles at the end", () => {
    assert.ok((now.mixed as (number | null)[])[9]! > 0, "mixed wins wave 10");
    assert.equal((now["too few"] as (number | null)[]).includes(0), true, "three towers lose");
    assert.ok((now["too few"] as (number | null)[]).indexOf(0) <= 5, "and lose by wave 6");
    assert.equal((now["all bolt"] as (number | null)[])[9], 0, "all bolt runs out in wave 10");
  });
});
