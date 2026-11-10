// Layer 1 of ComponentGenerator: the handler methods, state setters and updaters, and the statements and callbacks inside them.
import { assertNever, type FunctionIR, type HandlerHookIR, isHandlerHook, type StatementIR, type StateId } from "../ir/types.ts";
import { HANDLER_SIGNATURES } from "../ir/handlers.ts";
import { CodeWriter } from "./writer.ts";
import { param, annotated, pendingRef } from "./helpers.ts";
import { ExpressionEmitter } from "./expressions.ts";

export class HandlerEmitter extends ExpressionEmitter {
  // -- handlers -------------------------------------------------------------

  /**
   * One override per hook kind. A single handler is inlined; several become
   * private methods called in source order, so a `return;` in one cannot skip the others.
   */
  protected emitHandlerMethods(): void {
    const w = this.w;
    const byKind = new Map<HandlerHookIR["kind"], HandlerHookIR[]>();
    for (const hook of this.c.hooks) {
      if (!isHandlerHook(hook)) continue;
      byKind.set(hook.kind, [...(byKind.get(hook.kind) ?? []), hook]);
    }
    for (const [kind, hooks] of byKind) {
      const signature = HANDLER_SIGNATURES[kind];
      // The root built-in may implement this hook itself (an AnimatedSprite advances its frame in `onUpdate`).
      // Overriding it would silently stop that, so the override calls `super` first, with the hook's own parameters.
      const callsSuper = (this.intrinsicHooks[this.c.root.component.name] ?? []).includes(signature.method);
      w.blank();
      if (hooks.length === 1 && !callsSuper) {
        const handler = hooks[0]!.handler;
        w.block(`override ${signature.method}(${this.params(handler)}): void`, () => this.stmts(handler.body));
        continue;
      }
      const canonical = signature.params.map((p) => annotated(p.name, p.type)).join(", ");
      w.block(`override ${signature.method}(${canonical}): void`, () => {
        if (callsSuper) w.line(`super.${signature.method}(${signature.params.map((p) => p.name).join(", ")});`);
        hooks.forEach((hook, i) => {
          const args = signature.params.slice(0, hook.handler.params.length).map((p) => p.name).join(", ");
          w.line(`this.#${signature.method}${i}(${args});`);
        });
      });
      hooks.forEach((hook, i) => {
        w.blank();
        w.block(`#${signature.method}${i}(${this.params(hook.handler)}): void`, () => this.stmts(hook.handler.body));
      });
    }
  }

  protected params(fn: FunctionIR): string {
    return fn.params.map(param).join(", ");
  }

  protected hasSetter(state: StateId): boolean {
    return this.c.hooks.some((h) => h.kind === "UseState" && h.state === state && h.setterName !== null);
  }

  protected setter(state: StateId): string {
    for (const hook of this.c.hooks) {
      if (hook.kind === "UseState" && hook.state === state && hook.setterName !== null) return hook.setterName;
    }
    throw new Error(`State ${state} has no setter in component ${this.c.name}`);
  }

  protected updater(fn: FunctionIR): string {
    const params = fn.params.map(param).join(", ");
    const only = fn.body.length === 1 ? fn.body[0]! : null;
    if (only?.kind === "Return" && only.value) return `(${params}) => ${this.arrowBody(only.value)}`;
    const inner = new CodeWriter();
    const outer = this.w;
    this.w = inner;
    this.stmts(fn.body);
    this.w = outer;
    return this.arrow(params, inner.toString().trimEnd().split("\n"), fn);
  }

  /**
   * `setX((x) => x + 1)` written out where it stands, when the updater is one expression of the previous value:
   *
   *     {
   *       const x = this.#xNext;
   *       this.#xNext = x + 1;
   *       if (this.#xNext !== x) this.markDirty();
   *     }
   *
   * which is what the setter does with the arrow, without making the arrow and calling it through the setter (an
   * interpreter pays for both on every call, and a moving object calls a setter or two every frame). The block's only name
   * is the updater's own parameter, which hides the same outer names in the expression as it did in the arrow. Returns false,
   * having written nothing, for any other updater: the caller writes the call to the setter.
   */
  protected updaterInPlace(state: StateId, fn: FunctionIR): boolean {
    const only = fn.body.length === 1 ? fn.body[0]! : null;
    const previous = fn.params.length === 1 ? fn.params[0]! : null;
    // Not in a callback handed to an element: those run on an event, not every frame, and read better as the call.
    if (this.callbackDepth > 0 || previous === null || only?.kind !== "Return" || !only.value || !this.hasSetter(state)) return false;
    const w = this.w;
    const slot = pendingRef(this.state(state));
    w.open("{");
    w.line(`const ${previous.name} = ${slot};`);
    w.line(`${slot} = ${this.expr(only.value, true)};`);
    w.line(`if (${slot} !== ${previous.name}) this.markDirty();`);
    w.close("}");
    return true;
  }

  // -- handler statements --------------------------------------------------

  protected stmts(body: readonly StatementIR[]): void {
    const w = this.w;
    for (const stmt of body) {
      switch (stmt.kind) {
        case "ExpressionStatement":
          w.line(`${this.expr(stmt.expression, true)};`);
          break;
        case "SetState":
          if ("updater" in stmt && this.updaterInPlace(stmt.state, stmt.updater)) break;
          w.line(`this.${this.setter(stmt.state)}(${"updater" in stmt ? this.updater(stmt.updater) : this.expr(stmt.value, true)});`);
          break;
        case "PlaySound":
          w.line(`this.${this.soundField(stmt.sound)}.play();`);
          break;
        case "CallAction":
          w.line(`${this.storeName}.getState().${stmt.action}(${stmt.args.map((a) => this.expr(a, true)).join(", ")});`);
          break;
        case "Assign": {
          const target = `this.${this.refField(stmt.target.ref)}`;
          w.line(`${target} ${stmt.operator} ${this.expr(stmt.value, true)};`);
          break;
        }
        case "LocalConst":
          w.line(`const ${stmt.name} = ${this.expr(stmt.value, true)};`);
          break;
        case "Return":
          w.line(stmt.value ? `return ${this.expr(stmt.value, true)};` : "return;");
          break;
        case "If":
          w.open(`if (${this.expr(stmt.test, true)}) {`);
          this.stmts(stmt.then);
          if (stmt.else.length > 0) {
            w.close();
            w.open("} else {");
            this.stmts(stmt.else);
          }
          w.close("}");
          break;
        default:
          assertNever(stmt, "statement");
      }
    }
  }

  /** A callback passed to a child: an arrow with unannotated parameters, typed by the child's props type. */
  protected callback(fn: FunctionIR): string {
    const params = fn.params.map(param).join(", ");
    const inner = new CodeWriter();
    const outer = this.w;
    this.w = inner;
    this.callbackDepth++;
    try {
      this.stmts(fn.body);
    } finally {
      this.callbackDepth--;
      this.w = outer;
    }
    return this.arrow(params, inner.toString().trimEnd().split("\n"), fn);
  }
}
