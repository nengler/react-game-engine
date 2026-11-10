// Syntax-tree helpers for the analyzer: unwrapping parentheses and visiting every node.
import { type Expression, type Node } from "typescript/ast";
import { isParenthesizedExpression } from "typescript/ast/is";



export function unwrapParens(expression: Expression): Expression {
  let current = expression;
  while (isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** Pre-order walk. The callback's return value is ignored (forEachChild stops on truthy returns). */
export function visit(node: Node, callback: (node: Node) => void): void {
  callback(node);
  node.forEachChild((child) => {
    visit(child, callback);
    return undefined;
  });
}
