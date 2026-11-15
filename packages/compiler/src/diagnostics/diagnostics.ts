import type { SourceSpan } from "../ir/types.ts";

/** Stable diagnostic codes. Never renumber; only append. */
export const DiagnosticCode = {
  UnsupportedSyntax: "TSE1001",
  InvalidComponentBody: "TSE1002",
  RootMustBeEntity: "TSE1003",
  /** A name imported from the authoring module that the compiler does not know. */
  UnknownImport: "TSE1004",
  /** A hook, built-in element or runtime function used without importing it from the authoring module. */
  MissingImport: "TSE1005",
  HookNotAtTopLevel: "TSE1101",
  UnknownHook: "TSE1102",
  InvalidUseState: "TSE1103",
  UnsupportedStateType: "TSE1104",
  /** Retired: `useTransform` was replaced by the `transform={{ x, y }}` attribute driven by state. */
  InvalidUseTransform: "TSE1105",
  ElementRef: "TSE1106",
  /** `useSound` that is not `const play = useSound("file.wav")`: a path that is not a string literal, or a name already taken. */
  InvalidUseSound: "TSE1107",
  /** `useGameState` with a key the project's `GameState.ts` does not declare, or when there is no such schema. */
  InvalidGameState: "TSE1108",
  /** A `GameState.ts` that is not `export const gameState = { key: number | string | boolean literal, … }`. */
  InvalidGameStateSchema: "TSE1109",
  UnknownComponent: "TSE1201",
  UnsupportedJsxChild: "TSE1202",
  UnsupportedAttribute: "TSE1203",
  /** Retired: props on local and imported components are supported (M4). */
  LocalComponentProps: "TSE1204",
  ComponentCycle: "TSE1205",
  DuplicateComponent: "TSE1206",
  /** `transform={{ ... }}` that is malformed, or on an element that has no transform. */
  InvalidTransformAttribute: "TSE1207",
  /** A component's props parameter or props type is not in the supported form, or a prop is passed the wrong way. */
  InvalidProps: "TSE1208",
  /** A keyed list (`{items.map((e) => <X key={e.id} />)}`) that is not in the supported form, or a key on an element outside one. */
  InvalidList: "TSE1209",
  /** A literal for a built-in's prop that is not one of the values it allows (`<Shape kind="oval">`). */
  InvalidPropValue: "TSE1210",
  /** An image, sound or font a component names with a literal that is not in the assets folder (`tse-compile --assets`). */
  MissingAsset: "TSE1211",
  UnsupportedExpression: "TSE1301",
  UnknownIdentifier: "TSE1302",
  NonConstantInitialState: "TSE1303",
  /** Retired with `useRef`: a `ref.current` read outside a handler. Kept so codes are never reused. */
  HandleReadOutsideHandler: "TSE1304",
  /** A sound's play function used outside a handler call (`play()` in JSX or a derived const, or passed as a value): it would play on every render. */
  SoundOutsideHandler: "TSE1305",
  InvalidHandler: "TSE1401",
  UnsupportedStatement: "TSE1402",
  /** Retired: several handlers of one kind are now allowed. Kept so codes are never reused. */
  DuplicateHandler: "TSE1403",
  /** Retired: refs no longer point at elements, so there are no ref property writes to conflict with JSX. */
  ConflictingRefWrite: "TSE1404",
  /** A scene file that is not valid JSON. */
  SceneSyntax: "TSE1501",
  /** A scene (or its entity, `transform`, version) that is not in the scene format. */
  SceneShape: "TSE1502",
  UnknownPrefab: "TSE1503",
  UnknownPrefabProp: "TSE1504",
  MissingPrefabProp: "TSE1505",
  /** A scene value of the wrong type for its prop or transform field. */
  WrongPropType: "TSE1506",
  /** A prop data cannot set: a callback, or a type the compiler cannot describe as data. */
  PropNotSettable: "TSE1507",
  DuplicateSceneId: "TSE1508",
  /** A Tiled map the importer cannot read, or an object or property it cannot turn into a scene entity. */
  TiledImport: "TSE1509",
  GeneratedTypeError: "TSE9001",
  /** A TypeScript error in the authored TSX itself (wrong prop, wrong type, undefined name). */
  SourceTypeError: "TSE9002",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export type DiagnosticSeverity = "error" | "warning";

export interface CompilerDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly span: SourceSpan | null;
}

export function error(code: DiagnosticCode, message: string, span: SourceSpan | null): CompilerDiagnostic {
  return { code, severity: "error", message, span };
}

export function warning(code: DiagnosticCode, message: string, span: SourceSpan | null): CompilerDiagnostic {
  return { code, severity: "warning", message, span };
}

export function formatDiagnostic(d: CompilerDiagnostic): string {
  const where = d.span ? `${d.span.fileName}:${d.span.line}:${d.span.column} - ` : "";
  return `${where}${d.severity} ${d.code}: ${d.message}`;
}

export function hasErrors(diagnostics: readonly CompilerDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
