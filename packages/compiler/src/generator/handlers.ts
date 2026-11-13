// Layer 1 of ComponentGenerator: the handler methods, state setters and updaters, and the statements and callbacks inside them.
import { assertNever, type FunctionIR, type AssignStmtIR, type HandlerHookIR, type IfStmtIR, type LoopBindingIR, isHandlerHook, type StatementIR, type StateId } from "../ir/types.ts";
import { HANDLER_SIGNATURES } from "../ir/handlers.ts";
import { walkExpr } from "../ir/walk.ts";
import { param, annotated, pendingRef, propertyKey } from "./helpers.ts";
import { ExpressionEmitter } from "./expressions.ts";

/** A `for…of` binding as written: `e`, `[i, e]`, `{ id, hp: health }`. */
function loopBinding(binding: LoopBindingIR): string {
  switch (binding.kind) {
    case "Name": return binding.name;
    case "Array": return `[${binding.elements.map((e) => (e === null ? "" : loopBinding(e))).join(", ")}]`;
    case "Object":
      return `{ ${binding.entries.map((e) => (e.value.kind === "Name" && e.value.name === e.key ? e.key : `${propertyKey(e.key)}: ${loopBinding(e.value)}`)).join(", ")} }`;
    default: return assertNever(binding, "loop binding");
  }
}

/** Whether a function's own statements return a value (a `useMount` cleanup); nested callbacks and updaters are not its own. */
function returnsValue(body: readonly StatementIR[]): boolean {
  return body.some((stmt) => {
    switch (stmt.kind) {
      case "Return": return stmt.value !== null;
      case "If": return returnsValue(stmt.then) || returnsValue(stmt.else);
      case "ForOf": case "Block": case "While": case "For": return returnsValue(stmt.body);
      case "Try": return returnsValue(stmt.block) || returnsValue(stmt.handler?.body ?? []) || returnsValue(stmt.finalizer ?? []);
      case "Switch": return stmt.cases.some((c) => returnsValue(c.body));
      default: return false;
    }
  });
}

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
      // A `useMount` that returns a cleanup is a method of its own, whose result the override keeps (`keepCleanup`).
      const cleanups = hooks.map((hook) => kind === "OnMount" && returnsValue(hook.handler.body));
      if (hooks.length === 1 && !callsSuper && !cleanups[0]) {
        const handler = hooks[0]!.handler;
        w.at(hooks[0]!.span, () => w.block(`override ${signature.method}(${this.params(handler)}): void`, () => this.stmts(handler.body)));
        continue;
      }
      // Every parameter the runtime passes when `super` is called with them; otherwise only as many as some handler declares (an unused one is a type error).
      const declared = callsSuper ? signature.params.length : Math.max(0, ...hooks.map((h) => h.handler.params.length));
      const canonical = signature.params.slice(0, declared).map((p) => annotated(p.name, p.type)).join(", ");
      w.block(`override ${signature.method}(${canonical}): void`, () => {
        if (callsSuper) w.line(`super.${signature.method}(${signature.params.map((p) => p.name).join(", ")});`);
        hooks.forEach((hook, i) => {
          const args = signature.params.slice(0, hook.handler.params.length).map((p) => p.name).join(", ");
          w.line(cleanups[i] ? `this.keepCleanup(this.#${signature.method}${i}(${args}));` : `this.#${signature.method}${i}(${args});`);
        });
      });
      hooks.forEach((hook, i) => {
        w.blank();
        const returns = cleanups[i] ? "(() => void) | void" : "void";
        w.at(hook.span, () => w.block(`#${signature.method}${i}(${this.params(hook.handler)}): ${returns}`, () => this.stmts(hook.handler.body)));
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
    return this.arrow(params, this.capture(() => this.stmts(fn.body)), fn);
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
    if (this.mode.inCallback || previous === null || only?.kind !== "Return" || !only.value || !this.hasSetter(state)) return false;
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

  /** `target op value`, with no semicolon: a statement, or a part of a `for` loop's head. */
  protected assignText(stmt: AssignStmtIR): string {
    const target = stmt.target.kind === "RefCurrent" ? `this.${this.refField(stmt.target.ref)}` : stmt.target.kind === "Path" ? this.expr(stmt.target.target) : stmt.target.name;
    return `${target} ${stmt.operator} ${this.expr(stmt.value, true)}`;
  }

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
          w.line(`this.${this.soundField(stmt.sound)}.play(${stmt.volume === null ? "" : this.expr(stmt.volume, true)});`);
          break;
        case "CallAction":
          w.line(`${this.storeName}.getState().${stmt.action}(${stmt.args.map((a) => this.expr(a, true)).join(", ")});`);
          break;
        case "Assign":
          w.line(`${this.assignText(stmt)};`);
          break;
        case "LocalConst":
          w.line(`${stmt.mutable ? "let" : "const"} ${stmt.type ? annotated(stmt.name, stmt.type) : stmt.name} = ${this.expr(stmt.value, true)};`);
          break;
        case "ForOf":
          w.block(`for (const ${loopBinding(stmt.binding)} of ${this.expr(stmt.iterable, true)})`, () => this.stmts(stmt.body));
          break;
        case "While":
          if (stmt.doWhile) {
            w.open("do {");
            this.stmts(stmt.body);
            w.close(`} while (${this.expr(stmt.test, true)});`);
          } else w.block(`while (${this.expr(stmt.test, true)})`, () => this.stmts(stmt.body));
          break;
        case "For": {
          const init = stmt.init.map((s) => (s.kind === "LocalConst" ? `${s.type ? annotated(s.name, s.type) : s.name} = ${this.expr(s.value, true)}` : this.assignText(s)));
          const declares = stmt.init.length > 0 && stmt.init[0]!.kind === "LocalConst";
          const head = `${declares ? "let " : ""}${init.join(", ")}; ${stmt.test ? this.expr(stmt.test, true) : ""}; ${stmt.update.map((u) => this.assignText(u)).join(", ")}`;
          w.block(`for (${head})`, () => this.stmts(stmt.body));
          break;
        }
        case "Try":
          w.block("try", () => this.stmts(stmt.block));
          if (stmt.handler) w.block(stmt.handler.binding ? `catch (${stmt.handler.binding.name})` : "catch", () => this.stmts(stmt.handler!.body));
          if (stmt.finalizer) w.block("finally", () => this.stmts(stmt.finalizer!));
          break;
        case "Throw":
          w.line(`throw ${this.expr(stmt.value, true)};`);
          break;
        case "Block":
          w.block("", () => this.stmts(stmt.body));
          break;
        case "Switch":
          w.block(`switch (${this.expr(stmt.discriminant, true)})`, () => {
            for (const c of stmt.cases) {
              w.open(c.test === null ? "default:" : `case ${this.expr(c.test, true)}:`);
              this.stmts(c.body);
              w.close();
            }
          });
          break;
        case "Break":
          w.line("break;");
          break;
        case "Continue":
          w.line("continue;");
          break;
        case "Return":
          w.line(stmt.value ? `return ${this.expr(stmt.value, true)};` : "return;");
          break;
        case "If":
          this.emitIf(stmt);
          break;
        default:
          assertNever(stmt, "statement");
      }
    }
  }

  /** `if … else if … else`: an `else` that holds only another `if` is written as `else if`, not nested a level deeper. */
  protected emitIf(stmt: IfStmtIR): void {
    const w = this.w;
    w.open(`if (${this.expr(stmt.test, true)}) {`);
    this.stmts(stmt.then);
    let rest: readonly StatementIR[] = stmt.else;
    while (rest.length === 1 && rest[0]!.kind === "If") {
      const next: IfStmtIR = rest[0];
      w.close();
      w.open(`} else if (${this.expr(next.test, true)}) {`);
      this.stmts(next.then);
      rest = next.else;
    }
    if (rest.length > 0) {
      w.close();
      w.open("} else {");
      this.stmts(rest);
    }
    w.close("}");
  }

  /**
   * A callback passed to a child, handed to a function (`settings.subscribe(() => …)`) or returned as a cleanup: an arrow
   * with unannotated parameters, typed by where it goes.
   */
  protected override callback(fn: FunctionIR): string {
    const params = fn.params.map(param).join(", ");
    return this.arrow(params, this.within({ inCallback: true }, () => this.capture(() => {
      // A callback made under a condition reads state through `this`, which TypeScript does not narrow inside a function, as it
      // narrows the `const` the source's arrow closed over. `$assume` narrows it again; it checks nothing at run time, so a callback
      // still runs as written when the condition no longer holds (a `useUnmount` telling the parent it went).
      const conditions = this.mode.conditions;
      if (conditions.length === 0) {
        this.stmts(fn.body);
        return;
      }
      // A memo the condition reads (`const waiting = pick(id)`) is a call, which TypeScript cannot narrow: read each once into a local,
      // and read the local everywhere in the callback. Within one call it is the same value (state is a snapshot, props do not change).
      const memoLocals = new Map(this.mode.memoLocals);
      for (const condition of conditions) {
        walkExpr(condition, (e) => {
          if (e.kind !== "Memo" || memoLocals.has(e.key)) return;
          const local = `$m${memoLocals.size}`;
          this.w.line(`const ${local} = ${this.within({ memoLocals }, () => this.expr(e, true))};`);
          memoLocals.set(e.key, local);
        });
      }
      this.within({ memoLocals }, () => {
        this.usesAssume = true;
        this.w.line(`$assume(${conditions.map((c) => this.expr(c)).join(" && ")});`);
        this.stmts(fn.body);
      });
    })), fn);
  }
}
