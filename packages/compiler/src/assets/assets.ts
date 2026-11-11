/**
 * Build-time check of asset paths: every image and sound a component names with a literal (`<Sprite image="a.png">`,
 * `useSound("jump.wav")`, `<AnimatedSprite frames sheet>`, `<Tilemap image>`, `<Text font>`) must be a file in the assets folder,
 * so a typo is a compile error with the nearest file name, not a magenta square or a silent sound at run time. Paths that are
 * computed (a prop passed in, a string built from state) cannot be checked, and are not.
 */
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import type { ChildIR, ElementIR, HostElementIR, IRModule, PropIR } from "../ir/types.ts";
import { walkExpr } from "../ir/walk.ts";
import { nearest } from "../transform/helpers.ts";

/** Props whose literal strings are asset names, by built-in. */
export const ASSET_PROPS: Readonly<Record<string, readonly string[]>> = {
  Sprite: ["image"],
  AnimatedSprite: ["frames", "sheet"],
  Tilemap: ["image"],
  Text: ["font"],
  Music: ["src"],
};

export interface AssetCheckOptions {
  /** Whether a file exists, by its name relative to the assets folder. */
  readonly exists: (name: string) => boolean;
  /** Every file name there is, for the "did you mean" (relative names, `/` separated). */
  readonly list: () => readonly string[];
  /** The assets folder, for the message. */
  readonly folder: string;
}

export function checkAssets(modules: readonly IRModule[], options: AssetCheckOptions): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  let files: readonly string[] | null = null;
  const report = (what: string, name: string, span: HostElementIR["span"] | null): void => {
    if (options.exists(name)) return;
    files ??= options.list();
    const near = nearest(name, files);
    diagnostics.push(error(DiagnosticCode.MissingAsset, `The ${what} '${name}' is not in ${options.folder}/${near === null ? "" : ` (did you mean '${near}'?)`}.`, span));
  };
  const props = (tag: string, list: readonly PropIR[], span: HostElementIR["span"]): void => {
    const names = ASSET_PROPS[tag];
    if (names === undefined) return;
    for (const prop of list) {
      if ((prop.kind !== "StaticProp" && prop.kind !== "DynamicProp") || !names.includes(prop.name)) continue;
      walkExpr(prop.value, (e) => {
        if (e.kind === "StringLiteral" && e.value !== "") report(tag === "Text" ? "font" : tag === "Music" ? "music file" : "image", e.value, span);
      });
    }
  };
  const child = (c: ChildIR): void => {
    if (c.kind === "StaticChild" || c.kind === "ConditionalChild" || c.kind === "KeyedListChild") element(c.element);
    if (c.kind === "KeyedListChild" && c.alternate) element(c.alternate);
  };
  const element = (e: ElementIR): void => {
    if (e.component.kind === "Intrinsic") props(e.component.name, e.props, e.span);
    e.children.forEach(child);
  };
  for (const module of modules) {
    for (const component of module.components) {
      for (const sound of component.sounds) report("sound", sound.path, sound.span);
      props(component.root.component.name, component.root.props, component.root.span);
      component.root.children.forEach(child);
    }
  }
  return diagnostics;
}
