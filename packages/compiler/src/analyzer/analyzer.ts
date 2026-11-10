import { ModifierFlags, NodeFlags, type Node, type SourceFile } from "typescript/ast";
import { isArrowFunction, isExportAssignment, isFunctionDeclaration, isIdentifier, isImportDeclaration, isInterfaceDeclaration, isNamedImports, isTypeAliasDeclaration, isStringLiteral, isVariableStatement } from "typescript/ast/is";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { spanOf } from "../parser/parser.ts";
import { type SourceAnalysis, type ImportAnalysis, type TypeDeclarationAnalysis, type ComponentAnalysis } from "./model.ts";
import { unwrapParens } from "./util.ts";
import { analyzeNamedImport, analyzeComponent } from "./component.ts";



/**
 * @param fileName Name used in spans and diagnostics. Defaults to the parsed
 * file's (absolute, normalised) name.
 * @param authoringModule The module hooks, built-ins and runtime functions are
 * imported from (the runtime manifest's `authoringModule`). Without it, only
 * component imports are accepted.
 */
export function analyzeSourceFile(
  sourceFile: SourceFile,
  fileName: string = sourceFile.fileName,
  authoringModule: string | null = null,
): SourceAnalysis {
  const diagnostics: CompilerDiagnostic[] = [];
  const components: ComponentAnalysis[] = [];
  const imports: ImportAnalysis[] = [];
  const authoringImports: ImportAnalysis[] = [];
  const storeImports: ImportAnalysis[] = [];
  const typeDeclarations: TypeDeclarationAnalysis[] = [];
  const defaultExports: { name: string; node: Node }[] = [];
  const span = (node: Node) => spanOf(node, sourceFile, fileName);

  // The names a relative `.ts` import binds, known before any component is read (imports may follow the components in source).
  const storeNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || !/^\.\.?\/.*\.ts$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && isNamedImports(bindings)) for (const element of bindings.elements) storeNames.add(element.name.text);
  }
  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      // Two kinds of import are understood: components from relative `.tsx` files, and hooks, built-ins and
      // runtime functions from the authoring module. Anything else would be silently dropped, so it is an error.
      const specifier = isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      if (specifier !== null && /^\.\.?\/.*\.tsx$/.test(specifier)) {
        analyzeNamedImport(statement, specifier, imports, diagnostics, span, "Component imports", `import { Name } from "${specifier}"`, true);
      } else if (specifier !== null && /^\.\.?\/.*\.ts$/.test(specifier)) {
        analyzeNamedImport(statement, specifier, storeImports, diagnostics, span, "Game state imports", `import { useGame } from "${specifier}"`, false);
      } else if (specifier !== null && specifier === authoringModule) {
        analyzeNamedImport(statement, specifier, authoringImports, diagnostics, span, "Imports from the authoring module", `import { useState, Entity, type Child } from "${specifier}"`, false, true);
      } else {
        diagnostics.push(
          error(
            DiagnosticCode.UnsupportedSyntax,
            `Import of ${specifier === null ? "this module" : `"${specifier}"`} is not supported: component source imports components from "./Name.tsx", the game state from "./GameState.ts"${authoringModule ? ` and hooks and built-in elements from "${authoringModule}"` : ""}.`,
            span(statement),
          ),
        );
      }
      continue;
    }
    if (isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)) {
      if (statement.typeParameters && statement.typeParameters.length > 0) {
        diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `Type '${statement.name.text}': generic props types are not supported.`, span(statement)));
        continue;
      }
      typeDeclarations.push({ name: statement.name.text, node: statement, text: statement.getText(sourceFile).replace(/^export\s+/, "") });
      continue;
    }
    if (isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text)) {
      const isDefault = (statement.modifierFlags & ModifierFlags.Default) !== 0;
      const component = analyzeComponent(
        { name: statement.name.text, node: statement, parameters: statement.parameters, body: statement.body, exported: (statement.modifierFlags & ModifierFlags.Export) !== 0, isDefault },
        span,
        diagnostics,
        storeNames,
      );
      if (component) components.push(component);
      continue;
    }
    if (isFunctionDeclaration(statement) && (statement.modifierFlags & ModifierFlags.Default) !== 0) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, "A default-exported component needs a capitalised name: `export default function Enemy() {}`.", span(statement)));
      continue;
    }
    // `const Enemy = ({ speed }: EnemyProps) => { … }` (optionally exported): an arrow-function component.
    if (isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const declaration = statement.declarationList.declarations[0]!;
      const arrow = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
      if (isIdentifier(declaration.name) && /^[A-Z]/.test(declaration.name.text) && arrow && isArrowFunction(arrow)) {
        if ((statement.declarationList.flags & NodeFlags.Const) === 0) {
          diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `Component '${declaration.name.text}' must be declared with \`const\`.`, span(statement)));
          continue;
        }
        const component = analyzeComponent(
          { name: declaration.name.text, node: declaration, parameters: arrow.parameters, body: arrow.body, exported: (statement.modifierFlags & ModifierFlags.Export) !== 0, isDefault: false },
          span,
          diagnostics,
          storeNames,
        );
        if (component) components.push(component);
        continue;
      }
    }
    // `export default Enemy;` makes an already-declared component the module's default export.
    if (isExportAssignment(statement) && !statement.isExportEquals) {
      const target = unwrapParens(statement.expression);
      if (isIdentifier(target)) {
        defaultExports.push({ name: target.text, node: statement });
        continue;
      }
    }
    diagnostics.push(
      error(
        DiagnosticCode.UnsupportedSyntax,
        "Only imports, `interface` / `type` declarations, components (`function Name() {}` or `const Name = () => {}`, capitalised) and `export default Name;` are supported at the top level.",
        span(statement),
      ),
    );
  }

  // Resolve `export default Enemy;` against the components declared in this file.
  let resolved = components;
  for (const { name, node } of defaultExports) {
    const index = resolved.findIndex((c) => c.name === name);
    if (index === -1) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `\`export default ${name};\` must name a component declared in this file.`, span(node)));
    } else if (resolved.some((c) => c.isDefault)) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, "A module has one default export.", span(node)));
    } else {
      resolved = resolved.map((c, i) => (i === index ? { ...c, isDefault: true } : c));
    }
  }

  return { fileName, sourceFile, components: resolved, imports, authoringImports, storeImports, typeDeclarations, diagnostics };
}


export * from "./model.ts";
export * from "./util.ts";
export * from "./matchers.ts";
export * from "./component.ts";
