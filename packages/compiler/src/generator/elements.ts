// Layer 2 of ComponentGenerator: the element tree, keyed lists, mounts and transforms, and the code that builds and updates each element.
import { assertNever, type ChildIR, type ElementIR, type ExprIR, type PropIR, type KeyedListChildIR, functionReadsParam } from "../ir/types.ts";
import { type Mount, mountOf, addChild, queueAddChild, queueRemoveChild, type Presence, transformTarget, typeName, propertyKey, access } from "./helpers.ts";
import { HandlerEmitter } from "./handlers.ts";

export class ElementEmitter extends HandlerEmitter {
  // -- fields ---------------------------------------------------------------

  protected emitElementFields(children: readonly ChildIR[], presence: Presence): void {
    for (const child of children) {
      if (child.kind === "ChildrenSlot") continue;
      const el = child.element;
      const type = typeName(el.component);
      if (child.kind === "KeyedListChild") {
        // The instances by key, the key order of the last render, and (when a callback reads the item) each key's current item.
        const itemType = child.alternate ? `${type} | ${typeName(child.alternate.component)}` : type;
        this.w.line(`readonly ${el.fieldName}Items: Map<string | number, ${itemType}> = new Map();`);
        if (child.alternate) this.w.line(`#${el.fieldName}Branches: Map<string | number, 0 | 1> = new Map();`);
        this.w.line(`#${el.fieldName}Order: (string | number)[] = [];`);
        if (this.listNeedsRecords(child)) this.w.line(`#${el.fieldName}Records: Map<string | number, ${this.recordType(child)}> = new Map();`);
        continue;
      }
      const childPresence: Presence = child.kind === "ConditionalChild" ? "conditional" : presence;
      if (childPresence === "persistent") {
        this.w.line(`readonly ${el.fieldName}: ${type} = ${this.construct(el)};`);
      } else {
        this.w.line(`${el.fieldName}: ${type} | null = null;`);
      }
      this.emitElementFields(el.children, childPresence);
    }
  }

  /** Attach persistent children to their parents (constructor only). */
  protected emitStaticWiring(children: readonly ChildIR[], mount: Mount): void {
    for (const [index, child] of children.entries()) {
      if (child.kind !== "StaticChild") continue;
      const ref = `this.${child.element.fieldName}`;
      this.emitStaticTransform(child.element.transform, ref, transformTarget(child.element));
      this.w.line(`${addChild(mount, ref, children, index)};`);
      this.emitStaticWiring(child.element.children, mountOf(child.element, ref));
    }
  }

  // -- render ---------------------------------------------------------------

  protected emitChildUpdates(children: readonly ChildIR[], mount: Mount, presence: Presence): void {
    const w = this.w;
    for (const [index, child] of children.entries()) {
      switch (child.kind) {
        case "StaticChild": {
          const el = child.element;
          if (!this.elementNeedsRender(el)) break;
          const ref = `this.${el.fieldName}`;
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
          const ref = `this.${el.fieldName}`;
          w.open(`if (${this.expr(child.condition, true)}) {`);
          w.block(`if (${ref} === null)`, () => {
            w.line(`${ref} = ${this.construct(el)};`);
            this.emitStaticTransform(el.transform, ref, transformTarget(el));
            this.emitMountStatics(el.children, mountOf(el, ref));
            w.line(`${queueAddChild(mount, ref, children, index)};`);
          });
          this.emitElementUpdates(el, ref, "conditional");
          w.close();
          w.open(`} else if (${ref} !== null) {`);
          w.line(`${queueRemoveChild(mount, ref)};`);
          for (const line of this.subtreeResets(el)) w.line(line);
          w.close("}");
          break;
        }
        case "KeyedListChild":
          this.emitList(child, mount, index);
          break;
        case "ChildrenSlot":
          break; // nothing renders here: the parent mounts its elements
        default:
          assertNever(child, "child");
      }
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
    // The item's own children (`<MenuButton key …><Icon …/><Label …/></MenuButton>`) are made with the item and kept in its record, so a
    // later render can apply their props from the item's current value.
    const kids = el.children.flatMap((c) => (c.kind === "StaticChild" ? [c.element] : []));
    // An item may switch between two elements (`cond ? <A/> : <B/>`): its instance is cast to the one that is current.
    const view = (e: ElementIR): string => (alt ? `($item as ${typeName(e.component)})` : "$item");
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
    w.line(`const $list = ${this.expr(list.source, true)}${filter};`);
    w.line(`const $keys = $list.map((${params}) => ${this.arrowBody(list.key)});`);
    w.line("const $seen = new Set<string | number>();");
    w.block("for (const $key of $keys)", () => {
      w.line(`if ($seen.has($key)) throw new Error("Duplicate key " + JSON.stringify($key) + ${JSON.stringify(` ${where}.`)});`);
      w.line("$seen.add($key);");
    });
    w.block(`for (const [${position}, ${item}] of $list.entries())`, () => {
      w.line(`const $key = $keys[${position}]!;`);
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
      if (records) w.line(kids.length > 0 ? `const $rec: ${this.recordType(list)} = { current: ${item}, kids: undefined as never };` : `const $rec = { current: ${item} };`);
      this.itemLookup = records ? { id: list.item.id, text: "$rec.current" } : null;
      try {
        if (alt) {
          w.block(`if (${test})`, () => construct(el));
          w.block("else", () => construct(alt));
        } else construct(el);
        kids.forEach((kid, i) => {
          w.line(`const $c${i} = ${this.construct(kid)};`);
          this.emitStaticTransform(kid.transform, `$c${i}`, transformTarget(kid));
          w.line(el.component.kind === "Intrinsic" ? `$item.addChild($c${i}, ${i});` : `$item.attachPassedChild($c${i}, ${i});`);
        });
        if (kids.length > 0) w.line(`$rec.kids = [${kids.map((_, i) => `$c${i}`).join(", ")}];`);
      } finally {
        this.itemLookup = null;
      }
      w.line(`${items}.set($key, $item);`);
      if (records) w.line(`${records}.set($key, $rec);`);
      w.line(`${mount.passed ? `$parent.queueAttachPassedChild($item, ${position})` : `$parent.queueAddChild($item, ${slot}, ${position})`};`);
      if (records || hasDynamicProps(el.props) || (alt !== null && hasDynamicProps(alt.props))) {
        w.close();
        w.open("} else {");
        if (records) w.line(kids.length > 0 ? `const $r = ${records}.get($key)!;` : `${records}.get($key)!.current = ${item};`);
        if (records && kids.length > 0) w.line(`$r.current = ${item};`);
        kids.forEach((kid, i) => {
          this.emitPropUpdates(kid, `$r.kids[${i}]`);
          this.emitDynamicTransform(kid.transform, `$r.kids[${i}]`, transformTarget(kid));
        });
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

  /** Whether a list's item callbacks read the item, so each key's current item must be kept. */
  protected listNeedsRecords(list: KeyedListChildIR): boolean {
    if (list.element.children.some((c) => c.kind === "StaticChild")) return true;
    const reads = (e: ElementIR): boolean => e.props.some((p) => p.kind === "CallbackProp" && functionReadsParam(p.handler, list.item.id)) || e.children.some((c) => c.kind === "StaticChild" && reads(c.element));
    return [list.element, ...(list.alternate ? [list.alternate] : [])].some(reads);
  }

  /** What a list keeps for each key when callbacks or children read the item: its current value and, for an item with children, those children. */
  protected recordType(list: KeyedListChildIR): string {
    const kids = list.element.children.flatMap((c) => (c.kind === "StaticChild" ? [typeName(c.element.component)] : []));
    return `{ current: ${this.listItemType(list)}${kids.length > 0 ? `; kids: [${kids.join(", ")}]` : ""} }`;
  }

  /** The element type of a list's source array, named through the state field or the props type. */
  protected listItemType(list: KeyedListChildIR): string {
    let base = list.source;
    while (base.kind === "Call" && base.callee.kind === "ArrayMethod") base = base.callee.receiver;
    if (base.kind === "StateRead") return `${this.c.name}[${JSON.stringify(this.state(base.state).name)}][number]`;
    if (base.kind === "PropRead" && this.c.propsType) return `NonNullable<${this.c.propsType}[${JSON.stringify(base.name)}]>[number]`;
    if (base.kind === "PlainRef") return `(typeof ${base.name})[number]`;
    throw new Error(`Unexpected list source in component ${this.c.name}`);
  }

  /** What unmounting a conditional subtree resets: its element fields to null, its lists to empty. */
  protected subtreeResets(el: ElementIR): string[] {
    return [
      `this.${el.fieldName} = null;`,
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
      const ref = `this.${child.element.fieldName}`;
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

  protected construct(el: ElementIR): string {
    switch (el.component.kind) {
      case "Local":
      case "Imported":
        // Every value prop (static or dynamic) goes in at construction, with the callbacks; dynamic ones are
        // re-sent through `updateProps` on render.
        return el.props.length > 0 ? `new ${el.component.name}(${this.propsObject(el.props)})` : `new ${el.component.name}()`;
      case "Intrinsic":
        return el.props.length > 0 ? `new ${el.component.name}(${this.propsObject(el.props)})` : `new ${el.component.name}()`;
      default:
        return assertNever(el.component, "component ref");
    }
  }

  protected propsObject(props: readonly PropIR[]): string {
    return `{ ${props.map((p) => (p.kind === "SpreadProp" ? `...(${this.expr(p.value, true)})` : `${propertyKey(p.name)}: ${p.kind === "CallbackProp" ? this.callback(p.handler) : this.expr(p.value, true)}`)).join(", ")} }`;
  }
}

/** Whether a render has props to send: a dynamic prop, or a spread that reads something that changes. */
function hasDynamicProps(props: readonly PropIR[]): boolean {
  return props.some((p) => p.kind === "DynamicProp" || (p.kind === "SpreadProp" && p.dependencies.length > 0));
}
