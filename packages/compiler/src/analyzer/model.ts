// What the analyzer finds in a source file: the analysis records for components, props, hooks and imports, and the tables of hook names.
import { type CallExpression, type ArrowFunction, type Expression, type JsxFragment, type InterfaceDeclaration, type JsxElement, type JsxSelfClosingElement, type Node, type SourceFile, type Statement, type TypeAliasDeclaration, type VariableDeclaration } from "typescript/ast";
import { type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";



/**
 * Source-level understanding of a file: which functions are components, which
 * hooks they declare, and what JSX they return. Still references AST nodes; the
 * transform stage lowers this into IR.
 */
export interface SourceAnalysis {
  readonly fileName: string;
  readonly sourceFile: SourceFile;
  readonly components: readonly ComponentAnalysis[];
  /** Components imported from other `.tsx` files, by the name they have in this file. */
  readonly imports: readonly ImportAnalysis[];
  /** Hooks, built-in elements and runtime functions imported from the authoring module. Validated in the transform, which has the runtime manifest. */
  readonly authoringImports: readonly ImportAnalysis[];
  /** Names imported from a relative `.ts` module: the project's game state (`import { useGame } from "./GameState.ts"`). Checked in the transform. */
  readonly storeImports: readonly ImportAnalysis[];
  /** Functions imported from a relative `.ts` file (not named like a hook): components may call them and pass them as values. */
  readonly plainImports: readonly ImportAnalysis[];
  /** Top-level `interface` / `type` declarations, which a component's props type names. */
  readonly typeDeclarations: readonly TypeDeclarationAnalysis[];
  /** Top-level constants and lower-case helper functions, which components read like plain imports. */
  readonly moduleDeclarations: readonly ModuleDeclarationAnalysis[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/** `import { Name } from "./Name.tsx"` (a component in another source file) or `import { useState } from "@rge/runtime/jsx"`. */
export interface ImportAnalysis {
  readonly name: string;
  /** `import Enemy from "./Enemy.tsx"`: the module's default export, under a local name. */
  readonly isDefault: boolean;
  /** The specifier as written, e.g. `./WarningIcon.tsx`. */
  readonly module: string;
  /** `import { type Child } from "@rge/runtime/jsx"`: a type, erased from the output (allowed from the authoring module only). */
  readonly isTypeOnly: boolean;
  readonly node: Node;
}

/** Types the authoring module exports: written `import { type Child }`, never values. */
export const AUTHORING_TYPES: readonly string[] = ["Child"];

/** What a component returns: an element, a fragment, or (`open ? <Menu /> : null`, `ok && <X />`, `null`) an expression of them. */
export type JsxRoot = JsxElement | JsxSelfClosingElement | JsxFragment | Expression;

/** `interface EnemyProps { … }` or `type EnemyProps = { … }`. The transform reads its members for the props. */
export interface TypeDeclarationAnalysis {
  readonly name: string;
  readonly node: InterfaceDeclaration | TypeAliasDeclaration;
  /** The declaration as written, without `export`. */
  readonly text: string;
}

/** `const COLORS = { text: "#fff" };` or `function frameOf(kind: Kind): number { … }` at the top of a component file. */
export interface ModuleDeclarationAnalysis {
  readonly name: string;
  readonly node: Node;
  /** The declaration as written. */
  readonly text: string;
  /** Every identifier its text mentions. */
  readonly reads: readonly string[];
}

/** A component's destructured props parameter: `function Enemy({ speed = 1, onDefeated }: EnemyProps)`. */
export interface PropsAnalysis {
  /** The name of the props type, resolved against the file's declarations in the transform. */
  readonly typeName: string;
  readonly typeNode: Node;
  /** `({ speed }: EnemyProps)`: each destructured prop. Empty for the object form. */
  readonly bindings: readonly PropBindingAnalysis[];
  /** `(props: EnemyProps)`: the name the whole props object is bound to, read as `props.speed`. Null when destructured. */
  readonly objectName: string | null;
}

export interface PropBindingAnalysis {
  readonly name: string;
  readonly defaultValue: Expression | null;
  readonly node: Node;
}

export interface ComponentAnalysis {
  readonly name: string;
  /** The function declaration, or the variable declaration of an arrow-function component. */
  readonly declaration: Node;
  readonly exported: boolean;
  /** `export default function Enemy() {}` or `export default Enemy;`. */
  readonly isDefault: boolean;
  /** Hook calls at the top level of the component, in source order. */
  readonly hooks: readonly HookCallAnalysis[];
  /** The destructured props parameter, or null for a component without props. */
  readonly props: PropsAnalysis | null;
  /** The JSX expression returned by the component. */
  readonly jsx: JsxRoot;
  /** Every element tag referenced in the returned JSX, in first-use order. */
  readonly jsxTags: readonly string[];
}

/**
 * `const hp = useGame((s) => s.player.hp)`: a read of one path of the game state, or (`useGame((s) => s.collect)`) a
 * binding of one action. The selector is a plain property path, or (`body`) any expression of the state, which subscribes to each
 * path it reads. A destructuring statement makes one of these per name.
 */
export interface UseStoreCallAnalysis {
  readonly kind: "useStore";
  /** The imported store the call is made on (`useGame`). */
  readonly storeName: string;
  readonly valueName: string;
  /** The selector's path: `["player", "hp"]`. Empty for a computed selector. */
  readonly path: readonly string[];
  /** A computed selector's expression (`s.cursor === id`), or null for a plain path. */
  readonly body: Expression | null;
  /** The selector's parameter (`s`), which `body` reads the state through. */
  readonly parameter: string;
  /** The selector's parameter, and the path's node, for diagnostics. */
  readonly selector: Node;
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** Future hooks become additional variants. */
export type HookCallAnalysis = UseStoreCallAnalysis | UseStateCallAnalysis | UseRefCallAnalysis | UseSoundCallAnalysis | HandlerCallAnalysis | RenderConstAnalysis;

/**
 * `const hurt = health < 25;` in the component body: a value derived from
 * state, as in a React render. Not a hook, but kept in the same ordered list
 * because it may only read what is declared above it.
 */
export interface RenderConstAnalysis {
  readonly kind: "const";
  readonly name: string;
  readonly initializer: Expression;
  readonly declaration: VariableDeclaration;
}

/** `const r = useRef<Sprite>()`. */
export interface UseRefCallAnalysis {
  readonly kind: "useRef";
  readonly name: string;
  readonly typeArgument: Node | null;
  readonly arguments: readonly Expression[];
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** `const playHit = useSound("hit.wav")`. */
export interface UseSoundCallAnalysis {
  readonly kind: "useSound";
  readonly name: string;
  readonly arguments: readonly Expression[];
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** `useUpdate(() => ...)`, `useInput(...)`, `useMount(...)` or `useUnmount(...)` as a top-level statement. */
export interface HandlerCallAnalysis {
  readonly kind: "useUpdate" | "useInput" | "useMount" | "useUnmount";
  readonly handler: ArrowFunction;
  readonly call: CallExpression;
  readonly statement: Statement;
}

export interface UseStateCallAnalysis {
  readonly kind: "useState";
  readonly valueName: string;
  readonly setterName: string | null;
  readonly initializer: Expression | null;
  readonly typeArgument: Node | null;
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

export const HOOK_NAME = /^use[A-Z0-9]/;

export const KNOWN_HOOKS = new Set(["useState", "useRef", "useSound", "useUpdate", "useInput", "useMount", "useUnmount"]);

export const HANDLER_HOOKS = new Set(["useUpdate", "useInput", "useMount", "useUnmount"]);

/** Every hook the compiler understands, i.e. the hook names the authoring module must export. */
export const AUTHORING_HOOKS: readonly string[] = [...KNOWN_HOOKS, ...HANDLER_HOOKS].filter((name, i, all) => all.indexOf(name) === i);

/** Hooks that were renamed or replaced, reported with what to write instead. */
export const REMOVED_HOOKS: Readonly<Record<string, string>> = {
  onUpdate: "'onUpdate' was renamed to 'useUpdate' (hooks start with `use`, as in React).",
  onInput: "'onInput' was renamed to 'useInput' (hooks start with `use`, as in React).",
  onCollisionEnter: "'onCollisionEnter' is no longer a hook: pass it to the collider, `<Collider width={16} height={24} onCollisionEnter={(other) => …} />`, so you know which collider was hit.",
};
