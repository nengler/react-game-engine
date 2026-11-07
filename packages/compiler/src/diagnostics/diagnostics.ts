import type { SourceSpan } from "../ir/types.ts";

/** Stable diagnostic codes. Never renumber; only append. */
export const DiagnosticCode = {
  UnsupportedSyntax: "RGE1001",
  InvalidComponentBody: "RGE1002",
  RootMustBeEntity: "RGE1003",
  HookNotAtTopLevel: "RGE1101",
  UnknownHook: "RGE1102",
  InvalidUseState: "RGE1103",
  UnsupportedStateType: "RGE1104",
  UnknownComponent: "RGE1201",
  UnsupportedJsxChild: "RGE1202",
  UnsupportedAttribute: "RGE1203",
  LocalComponentProps: "RGE1204",
  ComponentCycle: "RGE1205",
  DuplicateComponent: "RGE1206",
  UnsupportedExpression: "RGE1301",
  UnknownIdentifier: "RGE1302",
  NonConstantInitialState: "RGE1303",
  InvalidHandler: "RGE1401",
  UnsupportedStatement: "RGE1402",
  /** Retired: several handlers of one kind are now allowed. Kept so codes are never reused. */
  DuplicateHandler: "RGE1403",
  GeneratedTypeError: "RGE9001",
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

export function formatDiagnostic(d: CompilerDiagnostic): string {
  const where = d.span ? `${d.span.fileName}:${d.span.line}:${d.span.column} - ` : "";
  return `${where}${d.severity} ${d.code}: ${d.message}`;
}

export function hasErrors(diagnostics: readonly CompilerDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
