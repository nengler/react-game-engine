import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// tools/ci-local.ts runs the CI workflow's own steps on this machine. It reads only the YAML ci.yml is written in: when the
// workflow gains something it does not understand, this fails here, in CI, rather than the local run quietly doing less.
import { describe, it } from "node:test";

import { installsSystemPackages, parseWorkflow } from "../../../tools/ci-local.ts";

const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("ci-local", () => {
  it("reads every job of ci.yml, and each job runs something after installing", () => {
    const workflow = parseWorkflow(ci);
    const names = [...ci.slice(ci.indexOf("\njobs:")).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
    assert.deepEqual(
      workflow.jobs.map((job) => job.name),
      names
    );
    for (const job of workflow.jobs) {
      const runs = job.steps.filter((step) => step.run !== null).map((step) => step.run);
      assert.ok(runs.includes("npm ci"), `${job.name} installs`);
      assert.ok(runs.length > 2, `${job.name} runs its steps`);
      assert.ok(job.timeoutMinutes !== null && job.timeoutMinutes > 0, `${job.name} has a timeout`);
    }
  });

  it("keeps a multi-line script whole, the workflow's env, a step's env with the workspace filled in", () => {
    const workflow = parseWorkflow(ci);
    assert.equal(workflow.env["CARGO_INCREMENTAL"], "0");
    const steps = workflow.jobs.flatMap((job) => job.steps);
    const packaged = steps.find((step) => step.run?.includes("parity-packaged.json"));
    assert.ok(packaged?.run?.includes("\ncmp /tmp/parity-node.json /tmp/parity-packaged.json\n"), packaged?.run ?? "no packaging step");
    const desktop = workflow.jobs
      .find((job) => job.name === "native-desktop")!
      .steps.find((step) => step.env["RGE_NATIVE_LIB"] !== undefined);
    assert.equal(desktop?.env["RGE_NATIVE_LIB"], "${GITHUB_WORKSPACE}/native/build/librge.so");
  });

  it("stops on what it does not understand, rather than run something other than CI", () => {
    const step = (extra: string) => `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n${extra}`;
    assert.equal(parseWorkflow(step("")).jobs[0]!.steps[0]!.run, "echo hi");
    assert.throws(() => parseWorkflow(step("        if: false\n")), /does not know the step key 'if'/);
    assert.throws(() => parseWorkflow(step("        working-directory: x\n")), /does not know the step key 'working-directory'/);
    assert.throws(() => parseWorkflow(step("        env:\n          A: ${{ secrets.TOKEN }}\n")), /does not know the expression/);
    assert.throws(() => parseWorkflow(`jobs:\n  a:\n    strategy:\n      matrix: {}\n`), /does not know 'strategy:'/);
  });

  it("does not install system packages on someone's machine", () => {
    assert.equal(installsSystemPackages("sudo apt-get update\nsudo apt-get install -y xvfb"), true);
    assert.equal(installsSystemPackages("npm ci"), false);
  });
});
