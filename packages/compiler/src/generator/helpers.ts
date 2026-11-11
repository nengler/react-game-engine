// Shared declarations of the component generator: the mount helpers, names, and the small text helpers used by generator.ts and its layers.
import { assertNever, type ChildIR, type ComponentRef, type ElementIR, type ParamIR, type TypeIR, type StateIR } from "../ir/types.ts";



/**
 * What children attach to. A built-in takes them by position among its
 * children (slot); a component takes the children its parent passes at its
 * `{children}` slot (`passed`), in the order they were written.
 */
export interface Mount {
  readonly ref: string;
  readonly passed: boolean;
}

export const ROOT: Mount = { ref: "this", passed: false };

export function mountOf(el: ElementIR, ref: string): Mount {
  return { ref, passed: el.component.kind !== "Intrinsic" };
}

export function addChild(mount: Mount, child: string, siblings: readonly ChildIR[], index: number): string {
  return mount.passed ? `${mount.ref}.attachPassedChild(${child}, ${index})` : `${mount.ref}.addChild(${child}${slotArgument(siblings, index)})`;
}

export function queueAddChild(mount: Mount, child: string, siblings: readonly ChildIR[], index: number): string {
  return mount.passed ? `${mount.ref}.queueAttachPassedChild(${child}, ${index})` : `${mount.ref}.queueAddChild(${child}${slotArgument(siblings, index)})`;
}

export function queueRemoveChild(mount: Mount, child: string): string {
  return mount.passed ? `${mount.ref}.queueDetachPassedChild(${child})` : `${mount.ref}.queueRemoveChild(${child})`;
}

/** The container holding `{children}` and the slot's index among its children, found through static elements (`{children}` is only allowed there). */
export function findChildrenSlot(children: readonly ChildIR[], host: string): { host: string; index: number } | { forward: string } | null {
  for (const [index, child] of children.entries()) {
    if (child.kind === "ChildrenSlot") return { host, index };
  }
  for (const child of children) {
    if (child.kind !== "StaticChild") continue;
    // `<Panel title={title}>{children}</Panel>`: the slot is the whole of a component's passed children, so what this component is
    // given goes on to that component (which may forward it again).
    if (child.element.component.kind !== "Intrinsic" && child.element.children.some((c) => c.kind === "ChildrenSlot")) return { forward: `this.${child.element.fieldName}` };
    const found = findChildrenSlot(child.element.children, `this.${child.element.fieldName}`);
    if (found) return found;
  }
  return null;
}

/** Where an element lives: always present (readonly), or only while an enclosing condition holds. */
export type Presence = "persistent" | "conditional";

/** A function parameter as written in generated code; a contextual one has no annotation. */
export function param(p: ParamIR): string {
  return annotated(p.name, p.type);
}

export function annotated(name: string, type: TypeIR): string {
  return type.kind === "Contextual" ? name : `${name}: ${typeText(type)}`;
}

/** A type as written in generated code. */
export function typeText(type: TypeIR): string {
  switch (type.kind) {
    case "Primitive":
    case "Named":
      return type.name;
    case "SourceType":
      return type.text;
    case "Array": {
      const element = typeText(type.element);
      // `(A | B)[]`, not `A | B[]`.
      return `${IDENTIFIER.test(element) || element.endsWith("[]") ? element : `(${element})`}[]`;
    }
    case "Contextual":
      throw new Error("A contextual type has no text: it is left to inference");
    default:
      return assertNever(type, "type");
  }
}

/** A transform attribute on a component element places it (`placement`); on a built-in it sets the object's own `transform`. */
export function transformTarget(el: ElementIR): "transform" | "placement" {
  return el.component.kind === "Intrinsic" ? "transform" : "placement";
}

export function escapeTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function typeName(ref: ComponentRef): string {
  return ref.name;
}

/**
 * `, <index>` when the parent has children that mount later, so the runtime
 * keeps source order (a conditional lands between its siblings, not at the
 * end). Empty otherwise: appending in source order is already correct.
 */
function slotArgument(siblings: readonly ChildIR[], index: number): string {
  return siblings.some((c) => c.kind !== "StaticChild") ? `, ${index}` : "";
}

/** The private field holding a state slot's next value (`#healthNext`). Private names cannot clash with public ones. */
export function pending(s: StateIR): string {
  return `#${s.name}Next`;
}

export function pendingRef(s: StateIR): string {
  return `this.${pending(s)}`;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

export function access(target: string, name: string): string {
  return IDENTIFIER.test(name) ? `${target}.${name}` : `${target}[${JSON.stringify(name)}]`;
}
