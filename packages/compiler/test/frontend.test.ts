import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyntaxKind, type Node } from "typescript/ast";
import { isFunctionDeclaration, isJsxElement, isReturnStatement } from "typescript/ast/is";
import { analyzeSourceFile, DiagnosticCode, TsxParser, type IRModule } from "../src/index.ts";
import { closeCompiler, compile, compileErrors, getCompiler, stripSpans, elementOf } from "./helpers.ts";

after(closeCompiler);

const PLAYER = `
function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity>
      <Sprite image="player.png" />
      {health < 25 && <WarningIcon />}
    </Entity>
  );
}

function WarningIcon() {
  return <Entity name="Warning" />;
}
`;

describe("parser (TypeScript 7.1)", () => {
  it("parses a TSX function component", () => {
    const parser = new TsxParser();
    try {
      const parsed = parser.parse("Player.tsx", PLAYER);
      const [player] = parsed.sourceFile.statements;
      assert.ok(player && isFunctionDeclaration(player));
      assert.equal(player.name?.text, "Player");
      const last = player.body?.statements.at(-1);
      assert.ok(last && isReturnStatement(last) && last.expression);
      // `return ( <Entity>...</Entity> )`
      assert.equal(last.expression.kind, SyntaxKind.ParenthesizedExpression);
      const kinds: SyntaxKind[] = [];
      const walk = (n: Node): void => {
        kinds.push(n.kind);
        n.forEachChild((c) => void walk(c));
      };
      walk(player);
      assert.ok(kinds.includes(SyntaxKind.JsxElement));
      assert.ok(kinds.includes(SyntaxKind.JsxSelfClosingElement));
      parsed.dispose();
    } finally {
      parser.close();
    }
  });
});

describe("analyzer", () => {
  it("identifies components, hooks and JSX", () => {
    getCompiler().analyze("Player.tsx", PLAYER, (analysis) => {
      assert.deepEqual(analysis.diagnostics, []);
      assert.deepEqual(analysis.components.map((c) => c.name), ["Player", "WarningIcon"]);

      const player = analysis.components[0]!;
      assert.equal(player.hooks.length, 1);
      const hook = player.hooks[0]!;
      assert.equal(hook.kind, "useState");
      assert.equal(hook.valueName, "health");
      assert.equal(hook.setterName, "setHealth");
      assert.equal(hook.initializer?.kind, SyntaxKind.NumericLiteral);

      assert.ok(isJsxElement(player.jsx));
      assert.deepEqual(player.jsxTags, ["Entity", "Sprite", "WarningIcon"]);

      const warning = analysis.components[1]!;
      assert.deepEqual(warning.hooks, []);
      assert.equal(warning.jsx.kind, SyntaxKind.JsxSelfClosingElement);
    });
  });

  it("works directly on a parsed source file", () => {
    const parser = new TsxParser();
    try {
      const parsed = parser.parse("Player.tsx", PLAYER);
      const analysis = analyzeSourceFile(parsed.sourceFile, "Player.tsx");
      assert.equal(analysis.fileName, "Player.tsx");
      assert.equal(analysis.components.length, 2);
      parsed.dispose();
    } finally {
      parser.close();
    }
  });

  it("rejects hooks that are not at the top level", () => {
    const diagnostics = compileErrors(`
      function Bad() {
        const [a, setA] = useState(1);
        return <Entity>{a > 0 && useState(2) && <Sprite image="x" />}</Entity>;
      }
    `);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.HookNotAtTopLevel));
  });

  it("rejects unknown hooks", () => {
    const diagnostics = compileErrors(`
      function Bad() {
        const pos = useWobble();
        return <Entity />;
      }
    `);
    assert.ok(diagnostics.some((d) => d.code === DiagnosticCode.UnknownHook));
  });
});

describe("IR construction", () => {
  it("produces the expected IR for a component", () => {
    const { ir } = compile(PLAYER, "Player.tsx");
    const expected = {
      kind: "Module",
      sourceFile: "Player.tsx",
      typeDeclarations: [],
      plainImports: [],
      moduleDeclarations: [],
      typeImports: [],
      components: [
        {
          kind: "Component",
          name: "Player",
          hooks: [{ kind: "UseState", state: "Player.health", setterName: "setHealth" }],
          refs: [],
          sounds: [],
          functions: [],
          props: [],
          propsType: null,
          isDefaultExport: false,
          isExported: false,
          acceptsChildren: false,
          state: [
            {
              kind: "State",
              id: "Player.health",
              name: "health",
              type: { kind: "Primitive", name: "number" },
              initialValue: { kind: "NumberLiteral", value: 100 },
            },
          ],
          root: {
            kind: "HostElement",
            component: { kind: "Intrinsic", name: "Entity" },
            props: [],
            transform: [],
            children: [
              {
                kind: "StaticChild",
                element: {
                  kind: "Element",
                  id: "Player/0",
                  fieldName: "sprite",
                  component: { kind: "Intrinsic", name: "Sprite" },
                  props: [{ kind: "StaticProp", name: "image", value: { kind: "StringLiteral", value: "player.png" } }],
                  transform: [],
                  children: [],
                },
              },
              {
                kind: "ConditionalChild",
                condition: {
                  kind: "Binary",
                  operator: "<",
                  left: { kind: "StateRead", state: "Player.health" },
                  right: { kind: "NumberLiteral", value: 25 },
                },
                dependencies: [{ kind: "State", state: "Player.health" }],
                element: {
                  kind: "Element",
                  id: "Player/1",
                  fieldName: "warningIcon",
                  component: { kind: "Local", name: "WarningIcon" },
                  props: [],
                  transform: [],
                  children: [],
                },
              },
            ],
          },
        },
        {
          kind: "Component",
          name: "WarningIcon",
          refs: [],
          sounds: [],
          functions: [],
          props: [],
          propsType: null,
          isDefaultExport: false,
          isExported: false,
          acceptsChildren: false,
          hooks: [],
          state: [],
          root: {
            kind: "HostElement",
            component: { kind: "Intrinsic", name: "Entity" },
            props: [{ kind: "StaticProp", name: "name", value: { kind: "StringLiteral", value: "Warning" } }],
            transform: [],
            children: [],
          },
        },
      ],
    };
    assert.deepEqual(stripSpans(ir), expected);
  });

  it("classifies props as static or dynamic by their state dependencies", () => {
    const { ir } = compile(`
      function P() {
        const [health, setHealth] = useState(100);
        const [label, setLabel] = useState("a");
        return (
          <Entity name={label}>
            <Sprite image={health > 50 ? "normal.png" : "hurt.png"} />
            <Collider width={8 * 2} height={-(4)} />
          </Entity>
        );
      }
    `);
    const p = ir.components[0]!;
    assert.deepEqual(stripSpans(p.root.props), [
      { kind: "DynamicProp", name: "name", value: { kind: "StateRead", state: "P.label" }, dependencies: [{ kind: "State", state: "P.label" }] },
    ]);
    const [sprite, collider] = p.root.children.map((c) => elementOf(c));
    assert.deepEqual(stripSpans(sprite!.props[0]), {
      kind: "DynamicProp",
      name: "image",
      dependencies: [{ kind: "State", state: "P.health" }],
      value: {
        kind: "Conditional",
        test: {
          kind: "Binary",
          operator: ">",
          left: { kind: "StateRead", state: "P.health" },
          right: { kind: "NumberLiteral", value: 50 },
        },
        whenTrue: { kind: "StringLiteral", value: "normal.png" },
        whenFalse: { kind: "StringLiteral", value: "hurt.png" },
      },
    });
    assert.deepEqual(
      collider!.props.map((prop) => prop.kind),
      ["StaticProp", "StaticProp"],
    );
  });

  it("represents nested component references and stable identities", () => {
    const { ir } = compile(`
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
        return (
          <Entity>
            <Enemy />
            <Entity name="Group">
              <Enemy />
              {wave > 2 && <Enemy />}
            </Entity>
          </Entity>
        );
      }
    `);
    const level = ir.components.find((c) => c.name === "Level")!;
    const describe = (m: IRModule["components"][number]["root"]["children"]): unknown =>
      m.map((c) => ({
        kind: c.kind,
        id: elementOf(c).id,
        field: elementOf(c).fieldName,
        ref: elementOf(c).component,
        children: describe(elementOf(c).children),
      }));
    assert.deepEqual(describe(level.root.children), [
      { kind: "StaticChild", id: "Level/0", field: "enemy", ref: { kind: "Local", name: "Enemy" }, children: [] },
      {
        kind: "StaticChild",
        id: "Level/1",
        field: "entity",
        ref: { kind: "Intrinsic", name: "Entity" },
        children: [
          { kind: "StaticChild", id: "Level/1/0", field: "enemy2", ref: { kind: "Local", name: "Enemy" }, children: [] },
          { kind: "ConditionalChild", id: "Level/1/1", field: "enemy3", ref: { kind: "Local", name: "Enemy" }, children: [] },
        ],
      },
    ]);
  });
});

describe("diagnostics", () => {
  const cases: [string, string, string][] = [
    ["root is an unknown tag", DiagnosticCode.RootMustBeEntity, `function A() { return <Missing />; }`],
    ["unknown component", DiagnosticCode.UnknownComponent, `function A() { return <Entity><Missing /></Entity>; }`],
    ["text child", DiagnosticCode.UnsupportedJsxChild, `function A() { return <Entity>hello</Entity>; }`],
    ["unknown identifier", DiagnosticCode.UnknownIdentifier, `function A() { return <Entity name={other} />; }`],
    [
      "setter used as a value",
      DiagnosticCode.UnsupportedExpression,
      `function A() { const [a, setA] = useState(1); return <Entity name={setA} />; }`,
    ],
    [
      "{children} in a component that does not declare it",
      DiagnosticCode.UnsupportedJsxChild,
      `function A() { return <Entity>{children}</Entity>; }`,
    ],
    ["static self-reference", DiagnosticCode.ComponentCycle, `function A() { return <Entity><A /></Entity>; }`],
    ["non-literal state type", DiagnosticCode.UnsupportedStateType, `function A() { const [a, setA] = useState(null); return <Entity />; }`],
    // A state named like a runtime member is fine since REACT_FEEL_PLAN.md B7 (root-name.test.ts); one declared twice is not.
    ["state declared twice", DiagnosticCode.InvalidUseState, `function A() { const [a, setA] = useState(1); const [a, setB] = useState(2); return <Entity />; }`],
    ["non-component top level code", DiagnosticCode.UnsupportedSyntax, `let speed = 4; function A() { return <Entity />; }`],
  ];
  for (const [name, code, source] of cases) {
    it(`reports: ${name}`, () => {
      const diagnostics = compileErrors(source);
      assert.ok(
        diagnostics.some((d) => d.code === code),
        `expected ${code}, got ${JSON.stringify(diagnostics.map((d) => `${d.code} ${d.message}`))}`,
      );
      for (const d of diagnostics) assert.ok(d.span, "diagnostics carry a source location");
    });
  }

  it("points at the offending source location", () => {
    const [d] = compileErrors(`function A() {\n  return <Entity>\n    <Missing />\n  </Entity>;\n}`);
    assert.equal(d?.span?.line, 3);
    assert.equal(d?.span?.column, 6);
  });
});
