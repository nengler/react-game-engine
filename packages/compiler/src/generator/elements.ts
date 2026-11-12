// Layer 2 of ComponentGenerator: the element tree, keyed lists, mounts and transforms, and the code that builds and updates each element.
import { assertNever, type ChildIR, type ElementIR, type ExprIR, type PropIR, type KeyedListChildIR, functionReadsParam, readsParam } from "../ir/types.ts";
import { type Mount, mountOf, addChild, queueAddChild, queueRemoveChild, type Presence, transformTarget, propertyKey, access } from "./helpers.ts";
import { HandlerEmitter } from "./handlers.ts";

export class ElementEmitter extends HandlerEmitter {
  // -- fields ---------------------------------------------------------------

  protected emitElementFields(children: readonly ChildIR[], presence: Presence): void {
    for (const child of children) {
      if (child.kind === "ChildrenSlot") continue;
      this.w.at(child.element.span, () => this.emitElementField(child, presence));
    }
  }

  protected emitElementField(child: Exclude<ChildIR, { kind: "ChildrenSlot" }>, presence: Presence): void {
    const el = child.element;
    const type = el.component.name;
    if (child.kind === "KeyedListChild") {
      // The instances by key, the key order of the last render, and (when a callback reads the item) each key's current item.
      const itemType = child.alternate ? `${type} | ${child.alternate.component.name}` : type;
      this.w.line(`readonly ${el.fieldName}Items: Map<string | number, ${itemType}> = new Map();`);
      if (child.alternate) this.w.line(`#${el.fieldName}Branches: Map<string | number, 0 | 1> = new Map();`);
      this.w.line(`#${el.fieldName}Order: (string | number)[] = [];`);
      if (this.listNeedsRecords(child)) this.w.line(`#${el.fieldName}Records: Map<string | number, ${this.recordType(child)}> = new Map();`);
      if (!isNamedListSource(child.source)) {
        // A computed source (`spotsOf(run)`, `world.enemies.map(…)`): worked out by a method, whose return type names the items' type.
        this.w.line(`${listSourceMethod(child)}() { return ${this.expr(child.source, true)}; }`);
      }
      return;
    }
    const childPresence: Presence = child.kind === "ConditionalChild" ? "conditional" : presence;
    if (childPresence === "persistent") {
      this.w.line(`readonly ${el.fieldName}: ${type} = ${this.construct(el)};`);
    } else {
      this.w.line(`${el.fieldName}: ${type} | null = null;`);
    }
    this.emitElementFields(el.children, childPresence);
  }

  /** Attach persistent children to their parents (constructor only). */
  protected emitStaticWiring(children: readonly ChildIR[], mount: Mount): void {
    for (const [index, child] of children.entries()) {
      if (child.kind !== "StaticChild") continue;
      const ref = `this.${child.element.fieldName}`;
      this.w.at(child.element.span, () => {
        this.emitStaticTransform(child.element.transform, ref, transformTarget(child.element));
        this.w.line(`${addChild(mount, ref, children, index)};`);
      });
      this.emitStaticWiring(child.element.children, mountOf(child.element, ref));
    }
  }

  // -- render ---------------------------------------------------------------

  protected emitChildUpdates(children: readonly ChildIR[], mount: Mount, presence: Presence): void {
    for (const [index, child] of children.entries()) {
      if (child.kind === "ChildrenSlot") continue; // nothing renders here: the parent mounts its elements
      this.w.at(child.element.span, () => this.emitChildUpdate(child, children, index, mount, presence));
    }
  }

  protected emitChildUpdate(child: ChildIR, children: readonly ChildIR[], index: number, mount: Mount, presence: Presence): void {
    const w = this.w;
    switch (child.kind) {
      case "StaticChild": {
        const el = child.element;
        if (!this.elementNeedsRender(el)) return;
        const ref = this.fieldRef(el);
        if (presence === "persistent") {
          this.emitElementUpdates(el, ref, "persistent");
        } else {
          // Inside a conditional subtree the field may be null (e.g. the subtree is unmounted).
          w.block(`if (${ref} !== null)`, () => this.emitElementUpdates(el, ref, "conditional"));
        }
        break;
      }
      case "ConditionalChild": {
        const el = child.element;
        const ref = this.fieldRef(el);
        w.open(`if (${this.expr(child.condition, true)}) {`);
        this.within({ conditions: [...this.mode.conditions, child.condition] }, () => {
          w.block(`if (${ref} === null)`, () => {
            w.line(`${ref} = ${this.construct(el)};`);
            this.emitStaticTransform(el.transform, ref, transformTarget(el));
            this.emitMountStatics(el.children, mountOf(el, ref));
            w.line(`${queueAddChild(mount, ref, children, index)};`);
          });
          this.emitElementUpdates(el, ref, "conditional");
        });
        w.close();
        w.open(`} else if (${ref} !== null) {`);
        w.line(`${queueRemoveChild(mount, ref)};`);
        for (const line of this.subtreeResets(el)) w.line(line);
        w.close("}");
        break;
      }
      case "KeyedListChild": {
        // A condition that does not read the item (a keyed element's, `{open && <Menu key={screen} …/>}`) holds for every item's callbacks.
        const condition = child.condition;
        const itemFree = condition !== null && !readsParam(condition, child.item.id) && (child.index === null || !readsParam(condition, child.index.id));
        this.within({ conditions: itemFree ? [...this.mode.conditions, condition] : this.mode.conditions }, () => this.emitList(child, mount, index));
        break;
      }
      case "ChildrenSlot":
        break; // nothing renders here: the parent mounts its elements
      default:
        assertNever(child, "child");
    }
  }

  protected emitElementUpdates(el: ElementIR, ref: string, presence: Presence): void {
    this.emitPropUpdates(el, ref);
    this.emitDynamicTransform(el.transform, ref, transformTarget(el));
    this.emitChildUpdates(el.children, mountOf(el, ref), presence);
  }

  /**
   * What a render writes to one object: each value is worked out, and only if one differs from what is there are they
   * written and the object told, once (`markChanged`, or `markMoved` for its transform). So a render that changes nothing
   * that is drawn reports nothing, and the player keeps what it drew; one that only moves the component reports only that.
   * The temporaries are numbered through the whole `render()`, so none can hide another.
   */
  protected emitReportedWrites(writes: readonly { readonly target: string; readonly value: ExprIR }[], report: string): void {
    if (writes.length === 0) return;
    const w = this.w;
    const names = writes.map((write) => {
      const name = `$${++this.renderTemps}`;
      w.line(`const ${name} = ${this.expr(write.value, true)};`);
      return name;
    });
    w.block(`if (${writes.map((write, i) => `${write.target} !== ${names[i]}`).join(" || ")})`, () => {
      writes.forEach((write, i) => w.line(`${write.target} = ${names[i]};`));
      w.line(`${report};`);
    });
  }

  protected emitPropUpdates(el: ElementIR, ref: string): void {
    const dynamic = el.props.filter((p) => p.kind === "DynamicProp");
    if (el.component.kind === "Intrinsic") {
      this.emitReportedWrites(dynamic.map((prop) => ({ target: access(ref, prop.name), value: prop.value })), `${ref}.markChanged()`);
    } else if (hasDynamicProps(el.props)) {
      // A component takes all its changed props in one call, which marks it dirty once. With a spread among them the call
      // carries every value prop, in order, so that a named prop after the spread still wins over it.
      const sent = el.props.some((p) => p.kind === "SpreadProp") ? el.props.filter((p) => p.kind !== "CallbackProp") : dynamic;
      this.w.line(`${ref}.updateProps(${this.propsObject(sent)});`);
    }
  }

  /**
   * A keyed list, in its own block so its temporaries (`$`-prefixed: author
   * names cannot start with `$`) never clash: compute every key and reject
   * duplicates before changing anything; then update an existing key's
   * instance, or construct and queue a new one at (slot, position); queue
   * removal of keys that are gone; and queue a reorder only if the key
   * sequence changed.
   */
  protected emitList(list: KeyedListChildIR, mount: Mount, slot: number): void {
    const w = this.w;
    const el = list.element;
    const alt = list.alternate;
    const items = `this.${el.fieldName}Items`;
    const order = `this.#${el.fieldName}Order`;
    const branches = `this.#${el.fieldName}Branches`;
    const records = this.listNeedsRecords(list) ? `this.#${el.fieldName}Records` : null;
    const item = list.item.name;
    const position = list.index?.name ?? "$n";
    const params = list.index ? `${item}, ${list.index.name}` : item;
    const where = `in the <${el.component.name}> list of ${this.c.name}`;
    // The item's own children (`<MenuButton key …><Icon …/>{d.locked && <Lock …/>}</MenuButton>`) live in its record (`$rec.kids`), one
    // field each, made with the item and updated like a conditional subtree's on every render, from the item's current value.
    const kids = el.children;
    // An item may switch between two elements (`cond ? <A/> : <B/>`): its instance is cast to the one that is current.
    const view = (e: ElementIR): string => (alt ? `($item as ${e.component.name})` : "$item");
    // The branches test the condition itself (not `$branch`), so that TypeScript narrows what it reads (`p.tower ? … {...p.tower}`).
    const test = list.condition ? this.arrowBody(list.condition) : "true";
    const construct = (e: ElementIR): void => {
      w.line(`$item = ${this.construct(e)};`);
      this.emitStaticTransform(e.transform, "$item", transformTarget(e));
    };
    w.open("{");
    w.line(`const $parent = ${mount.ref};`);
    // `cond && <El/>`: an item whose condition is false has no instance, as if it were filtered out.
    const filter = list.condition !== null && alt === null ? `.filter((${item}) => ${this.arrowBody(list.condition)})` : "";
    w.line(`const $list = ${isNamedListSource(list.source) ? this.expr(list.source, true) : `this.${listSourceMethod(list)}()`}${filter};`);
    w.line(`const $keys = $list.map((${params}) => ${this.arrowBody(list.key)});`);
    w.line("const $seen = new Set<string | number>();");
    w.block("for (const $key of $keys)", () => {
      w.line(`if ($seen.has($key)) throw new Error("Duplicate key " + JSON.stringify($key) + ${JSON.stringify(` ${where}.`)});`);
      w.line("$seen.add($key);");
    });
    w.block(`for (const [${position}, ${item}] of $list.entries())`, () => {
      w.line(`const $key = $keys[${position}]!;`);
      if (list.condition !== null && alt === null) {
        // `p.tower && <Tower {...p.tower} />`: the filter above kept only items whose condition holds, but TypeScript does not narrow
        // through `filter`. `$assume` narrows the item here, as the source's `&&` did; it is true by construction.
        this.usesAssume = true;
        w.line(`$assume(${this.arrowBody(list.condition)});`);
      }
      w.line(`let $item = ${items}.get($key);`);
      if (alt && list.condition) {
        // The branch this item is in now; if it is not the one it was built in, the old instance goes and the new one takes its place.
        w.line(`const $branch = ${test} ? 0 : 1;`);
        w.block(`if ($item !== undefined && ${branches}.get($key) !== $branch)`, () => {
          w.line(`${queueRemoveChild({ ref: "$parent", passed: mount.passed }, "$item")};`);
          w.line(`${items}.delete($key);`);
          w.line("$item = undefined;");
        });
        w.line(`${branches}.set($key, $branch);`);
      }
      w.open("if ($item === undefined) {");
      // A callback is created once, with the item's first value. It reads the item's current value through this
      // holder, which every render refreshes, and which it keeps after the item is removed (an unmount hook may call it).
      if (records) w.line(kids.length > 0 ? `const $rec: ${this.recordType(list)} = { current: ${item}, kids: ${this.emptyKids(list)} };` : `const $rec = { current: ${item} };`);
      this.within({ itemLookup: records ? { id: list.item.id, text: "$rec.current" } : null }, () => {
        if (alt) {
          w.block(`if (${test})`, () => construct(el));
          w.block("else", () => construct(alt));
        } else construct(el);
        if (kids.length > 0) {
          this.within({ fieldBase: "$rec.kids" }, () => {
            this.emitMountStatics(kids, mountOf(el, "$item"));
            this.emitChildUpdates(kids, mountOf(el, "$item"), "conditional");
          });
        }
      });
      w.line(`${items}.set($key, $item);`);
      if (records) w.line(`${records}.set($key, $rec);`);
      w.line(`${mount.passed ? `$parent.queueAttachPassedChild($item, ${position})` : `$parent.queueAddChild($item, ${slot}, ${position})`};`);
      if (records || hasDynamicProps(el.props) || (alt !== null && hasDynamicProps(alt.props))) {
        w.close();
        w.open("} else {");
        if (records) w.line(kids.length > 0 ? `const $rec = ${records}.get($key)!;` : `${records}.get($key)!.current = ${item};`);
        if (records && kids.length > 0) {
          w.line(`$rec.current = ${item};`);
          // A child made now (its condition just turned on) may hold a callback: it reads the item through the record too.
          this.within({ itemLookup: { id: list.item.id, text: "$rec.current" }, fieldBase: "$rec.kids" }, () => this.emitChildUpdates(kids, mountOf(el, "$item"), "conditional"));
        }
        if (alt) {
          w.block(`if (${test})`, () => this.emitPropUpdates(el, view(el)));
          w.block("else", () => this.emitPropUpdates(alt, view(alt)));
        } else this.emitPropUpdates(el, "$item");
      }
      w.close("}");
      if (alt) {
        w.block(`if (${test})`, () => this.emitDynamicTransform(el.transform, view(el), transformTarget(el)));
        w.block("else", () => this.emitDynamicTransform(alt.transform, view(alt), transformTarget(alt)));
      } else this.emitDynamicTransform(el.transform, "$item", transformTarget(el));
    });
    w.block(`for (const [$key, $item] of ${items})`, () => {
      w.block("if (!$seen.has($key))", () => {
        w.line(`${queueRemoveChild({ ref: "$parent", passed: mount.passed }, "$item")};`);
        w.line(`${items}.delete($key);`);
        if (records) w.line(`${records}.delete($key);`);
        if (alt) w.line(`${branches}.delete($key);`);
      });
    });
    w.block(`if ($keys.length !== ${order}.length || $keys.some(($k, $i) => $k !== ${order}[$i]))`, () => {
      const ordered = `$keys.map(($k) => ${items}.get($k)!)`;
      w.line(`${mount.passed ? `$parent.queueReorderPassedChildren(${ordered})` : `$parent.queueReorder(${slot}, ${ordered})`};`);
      w.line(`${order} = $keys;`);
    });
    w.close("}");
  }

  /** Whether a list keeps a record per key: when callbacks read the item, or the item has children (they live in the record). */
  protected listNeedsRecords(list: KeyedListChildIR): boolean {
    if (list.element.children.length > 0) return true;
    const reads = (e: ElementIR): boolean => e.props.some((p) => p.kind === "CallbackProp" && functionReadsParam(p.handler, list.item.id)) || e.children.some((c) => c.kind === "StaticChild" && reads(c.element));
    return [list.element, ...(list.alternate ? [list.alternate] : [])].some(reads);
  }

  /** What a list keeps for each key: the item's current value and, for an item with children, those children (each `null` until made). */
  protected recordType(list: KeyedListChildIR): string {
    const kids = itemDescendants(list.element.children);
    const fields = kids.map((k) => `${k.fieldName}: ${k.component.name} | null`).join("; ");
    return `{ current: ${this.listItemType(list)}${kids.length > 0 ? `; kids: { ${fields} }` : ""} }`;
  }

  /** A new item's children, none made yet. */
  protected emptyKids(list: KeyedListChildIR): string {
    return `{ ${itemDescendants(list.element.children).map((k) => `${k.fieldName}: null`).join(", ")} }`;
  }

  /** The element type of a list's items: named through the state field, the props type or the constant, or else the return type of the method that computes them. */
  protected listItemType(list: KeyedListChildIR): string {
    if (!isNamedListSource(list.source)) return `ReturnType<${this.c.name}[${JSON.stringify(listSourceMethod(list))}]>[number]`;
    let base = list.source;
    while (base.kind === "Call" && base.callee.kind === "ArrayMethod") base = base.callee.receiver;
    if (base.kind === "StateRead") return `${this.c.name}[${JSON.stringify(this.state(base.state).name)}][number]`;
    if (base.kind === "PropRead" && this.c.propsType) return `NonNullable<${this.c.propsType}[${JSON.stringify(base.name)}]>[number]`;
    if (base.kind === "PlainRef") return `(typeof ${base.name})[number]`;
    throw new Error(`Unexpected list source in component ${this.c.name}`);
  }

  protected fieldRef(el: ElementIR): string {
    return `${this.mode.fieldBase}.${el.fieldName}`;
  }

  /** What unmounting a conditional subtree resets: its element fields to null, its lists to empty. */
  protected subtreeResets(el: ElementIR): string[] {
    return [
      `${this.fieldRef(el)} = null;`,
      ...el.children.flatMap((c) => {
        if (c.kind === "ChildrenSlot") return [];
        if (c.kind !== "KeyedListChild") return this.subtreeResets(c.element);
        const f = c.element.fieldName;
        return [`this.${f}Items.clear();`, `this.#${f}Order = [];`, ...(this.listNeedsRecords(c) ? [`this.#${f}Records.clear();`] : []), ...(c.alternate ? [`this.#${f}Branches.clear();`] : [])];
      }),
    ];
  }

  /** When a conditional subtree mounts, construct its static descendants and attach them immediately. */
  protected emitMountStatics(children: readonly ChildIR[], mount: Mount): void {
    for (const [index, child] of children.entries()) {
      if (child.kind !== "StaticChild") continue;
      const ref = this.fieldRef(child.element);
      this.w.line(`${ref} = ${this.construct(child.element)};`);
      this.emitStaticTransform(child.element.transform, ref, transformTarget(child.element));
      this.w.line(`${addChild(mount, ref, children, index)};`);
      this.emitMountStatics(child.element.children, mountOf(child.element, ref));
    }
  }

  /** Transform fields that never change are set once, right after the element is constructed. */
  protected emitStaticTransform(transform: readonly PropIR[], ref: string, target: "transform" | "placement"): void {
    for (const p of transform) {
      if (p.kind === "StaticProp") this.w.line(`${ref}.${target}.${p.name} = ${this.expr(p.value, true)};`);
    }
  }

  /** Transform fields that read state are re-applied on render, like any dynamic prop; a change to them is a move of that object. */
  protected emitDynamicTransform(transform: readonly PropIR[], ref: string, target: "transform" | "placement"): void {
    const dynamic = transform.filter((p) => p.kind === "DynamicProp");
    this.emitReportedWrites(dynamic.map((p) => ({ target: `${ref}.${target}.${p.name}`, value: p.value })), `${ref}.markMoved()`);
  }

  protected hostHasDynamicProps(): boolean {
    return [...this.c.root.props, ...this.c.root.transform].some((p) => p.kind === "DynamicProp");
  }

  protected elementNeedsRender(el: ElementIR): boolean {
    return hasDynamicProps(el.props) || el.transform.some((p) => p.kind === "DynamicProp") || this.childrenNeedRender(el.children);
  }

  protected childrenNeedRender(children: readonly ChildIR[]): boolean {
    return children.some((c) => c.kind === "ConditionalChild" || c.kind === "KeyedListChild" || (c.kind === "StaticChild" && this.elementNeedsRender(c.element)));
  }

  // -- expressions ----------------------------------------------------------

  /** Every prop goes in at construction, callbacks too; on a component, the dynamic ones are re-sent through `updateProps` on render. */
  protected construct(el: ElementIR): string {
    return el.props.length > 0 ? `new ${el.component.name}(${this.propsObject(el.props)})` : `new ${el.component.name}()`;
  }

  protected propsObject(props: readonly PropIR[]): string {
    return `{ ${props.map((p) => (p.kind === "SpreadProp" ? `...(${this.expr(p.value, true)})` : `${propertyKey(p.name)}: ${p.kind === "CallbackProp" ? this.callback(p.handler) : this.expr(p.value, true)}`)).join(", ")} }`;
  }
}

/** A list source that names its own type: state, a prop or an imported constant, optionally filtered. Anything else is computed by a method. */
function isNamedListSource(e: ExprIR): boolean {
  if (e.kind === "StateRead" || e.kind === "PropRead" || e.kind === "PlainRef") return true;
  return e.kind === "Call" && e.callee.kind === "ArrayMethod" && e.callee.name === "filter" && isNamedListSource(e.callee.receiver);
}

/** The method that computes a list's items when they are not a named array. */
function listSourceMethod(list: KeyedListChildIR): string {
  return `$${list.element.fieldName}List`;
}

/** Every element below a list item (through static and conditional children): each is a field of the item's record. */
function itemDescendants(children: readonly ChildIR[]): ElementIR[] {
  return children.flatMap((c) => (c.kind === "StaticChild" || c.kind === "ConditionalChild" ? [c.element, ...itemDescendants(c.element.children)] : []));
}

/** Whether a render has props to send: a dynamic prop, or a spread that reads something that changes. */
function hasDynamicProps(props: readonly PropIR[]): boolean {
  return props.some((p) => p.kind === "DynamicProp" || (p.kind === "SpreadProp" && p.dependencies.length > 0));
}
