import type { SourceSpan } from "../ir/types.ts";

/** Stable diagnostic codes. Never renumber; only append. */
export const DiagnosticCode = {
  UnsupportedSyntax: "RGE1001",
  InvalidComponentBody: "RGE1002",
  RootMustBeEntity: "RGE1003",
  /** A name imported from the authoring module that the compiler does not know. */
  UnknownImport: "RGE1004",
  /** A hook, built-in element or runtime function used without importing it from the authoring module. */
  MissingImport: "RGE1005",
  HookNotAtTopLevel: "RGE1101",
  UnknownHook: "RGE1102",
  InvalidUseState: "RGE1103",
  UnsupportedStateType: "RGE1104",
  /** Retired: `useTransform` was replaced by the `transform={{ x, y }}` attribute driven by state. */
  InvalidUseTransform: "RGE1105",
  InvalidUseRef: "RGE1106",
  UnknownComponent: "RGE1201",
  UnsupportedJsxChild: "RGE1202",
  UnsupportedAttribute: "RGE1203",
  /** Retired: props on local and imported components are supported (M4). */
  LocalComponentProps: "RGE1204",
  ComponentCycle: "RGE1205",
  DuplicateComponent: "RGE1206",
  /** `transform={{ ... }}` that is malformed, or on an element that has no transform. */
  InvalidTransformAttribute: "RGE1207",
  /** A component's props parameter or props type is not in the supported form, or a prop is passed the wrong way. */
  InvalidProps: "RGE1208",
  /** A keyed list (`{items.map((e) => <X key={e.id} />)}`) that is not in the supported form, or a key on an element outside one. */
  InvalidList: "RGE1209",
  UnsupportedExpression: "RGE1301",
  UnknownIdentifier: "RGE1302",
  NonConstantInitialState: "RGE1303",
  /** A `ref.current` read outside a handler (JSX, state initialisers, derived consts): it would never update. */
  HandleReadOutsideHandler: "RGE1304",
  InvalidHandler: "RGE1401",
  UnsupportedStatement: "RGE1402",
  /** Retired: several handlers of one kind are now allowed. Kept so codes are never reused. */
  DuplicateHandler: "RGE1403",
  /** Retired: refs no longer point at elements, so there are no ref property writes to conflict with JSX. */
  ConflictingRefWrite: "RGE1404",
  GeneratedTypeError: "RGE9001",
  /** A TypeScript error in the authored TSX itself (wrong prop, wrong type, undefined name). */
  SourceTypeError: "RGE9002",
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
