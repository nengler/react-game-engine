// Layer 2 of ComponentGenerator: the element tree, keyed lists, mounts and transforms, and the code that builds and updates each element.
import { assertNever, childExpressions, type LocalId, type ChildIR, type ElementIR, type ExprIR, type PropIR, type KeyedListChildIR, functionReadsParam, readsParam, walkStatements } from "../ir/types.ts";
import { type Mount, mountOf, addChild, queueAddChild, queueRemoveChild, type Presence, transformTarget, propertyKey, access } from "./helpers.ts";
import { HandlerEmitter } from "./handlers.ts";

export class ElementEmitter extends HandlerEmitter {
  /** The parameters of the keyed lists being emitted (the item, its index): what a child's prop may not read if it is to have a getter. */
  protected readonly itemIds = new Set<LocalId>();
  /** The keyed lists being emitted, the outermost first: a list inside a list item is a list of that item's own. */
  protected readonly openLists: KeyedListChildIR[] = [];

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
      this.emitListSourceMethods(child, []);
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

  /**
   * A computed source (`spotsOf(run)`, `world.enemies.map(…)`) is worked out by a method, whose return type names the items' type; so is
   * a list inside a list item's (`row.cells`), which takes the items it reads of the lists around it as parameters. The lists inside
   * this one's items are visited too: they are not fields of the component (their state lives in the item's record).
   */
  protected emitListSourceMethods(list: KeyedListChildIR, around: readonly KeyedListChildIR[]): void {
    if (!isNamedListSource(list.source) || around.some((outer) => readsListParams(list.source, outer))) {
      const params = this.aroundParams(list.source, around);
      this.w.line(`${listSourceMethod(list)}(${params.map((p) => `${p.name}: ${p.type}`).join(", ")}) { return ${this.expr(list.source, true)}; }`);
    }
    const inner = [...around, list];
    const visit = (children: readonly ChildIR[]): void => {
      for (const c of children) {
        if (c.kind === "KeyedListChild") this.emitListSourceMethods(c, inner);
        else if (c.kind !== "ChildrenSlot") visit(c.element.children);
      }
    };
    visit(list.element.children);
  }

  /** The items and indexes of the lists around one that its source reads: the source method's parameters. */
  protected aroundParams(source: ExprIR, around: readonly KeyedListChildIR[]): { name: string; type: string }[] {
    return around.flatMap((outer) => [
      ...(readsParam(source, outer.item.id) ? [{ name: outer.item.name, type: this.listItemType(outer, around.slice(0, around.indexOf(outer))) }] : []),
      ...(outer.index !== null && readsParam(source, outer.index.id) ? [{ name: outer.index.name, type: "number" }] : []),
    ]);
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
          w.block(`if (${ref} !== null)`, () => this.within({ guard: null }, () => this.emitElementUpdates(el, ref, "conditional")));
        }
        break;
      }
      case "ConditionalChild": {
        const el = child.element;
        const ref = this.fieldRef(el);
        w.open(`if (${this.expr(child.condition, true)}) {`);
        // Not guarded: an element made in this render must have every value written, whatever changed.
        this.within({ conditions: [...this.mode.conditions, child.condition], guard: null }, () => {
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
        this.within({ conditions: itemFree ? [...this.mode.conditions, condition] : this.mode.conditions, guard: null }, () => this.emitList(child, mount, index));
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
    const emit = (): void => {
      const names = writes.map((write) => {
        const name = `$${++this.renderTemps}`;
        w.line(`const ${name} = ${this.expr(write.value, true)};`);
        return name;
      });
      w.block(`if (${writes.map((write, i) => `${write.target} !== ${names[i]}`).join(" || ")})`, () => {
        writes.forEach((write, i) => w.line(`${write.target} = ${names[i]};`));
        w.line(`${report};`);
      });
    };
    // Where `render()` is guarded, these are worked out only when something they read changed.
    const test = this.guardTest(writes.map((write) => write.value));
    if (test === null) emit();
    else w.block(`if (${test})`, emit);
  }

  protected emitPropUpdates(el: ElementIR, ref: string): void {
    const dynamic = el.props.filter((p) => p.kind === "DynamicProp");
    if (el.component.kind === "Intrinsic") {
      this.emitReportedWrites(dynamic.map((prop) => ({ target: access(ref, prop.name), value: prop.value })), `${ref}.markChanged()`);
    } else if (hasDynamicProps(el.props)) {
      // A component takes all its changed props in one call, which marks it dirty once. With a spread among them the call
      // carries every value prop, in order, so that a named prop after the spread still wins over it.
      const sent = el.props.some((p) => p.kind === "SpreadProp") ? el.props.filter((p) => p.kind !== "CallbackProp") : dynamic;
      const line = `${ref}.updateProps(${this.propsObject(sent)});`;
      const test = this.guardTest(sent.flatMap((p) => ("value" in p ? [p.value] : [])));
      if (test === null) this.w.line(line);
      else this.w.block(`if (${test})`, () => this.w.line(line));
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
    // While its items are made, a prop that reads the item or its index is not given a getter (see `propGetters`).
    const ids = [list.item.id, ...(list.index ? [list.index.id] : [])];
    for (const id of ids) this.itemIds.add(id);
    this.openLists.push(list);
    try {
      this.emitListBody(list, mount, slot);
    } finally {
      this.openLists.pop();
      for (const id of ids) this.itemIds.delete(id);
    }
  }

  protected emitListBody(list: KeyedListChildIR, mount: Mount, slot: number): void {
    const w = this.w;
    const el = list.element;
    const alt = list.alternate;
    const state = this.listState(el.fieldName);
    const { items, order, branches } = state;
    const records = this.listNeedsRecords(list) ? state.records : null;
    // A list inside a list item names its record after its depth, so the record of the item around it can still be read.
    const around = this.openLists.slice(0, -1);
    const rec = around.length === 0 ? "$rec" : `$rec${around.length}`;
    const lookups = records ? [...this.mode.itemLookups, { id: list.item.id, text: `${rec}.current` }] : this.mode.itemLookups;
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
      w.line(`$item = ${this.construct(e, list)};`);
      this.emitStaticTransform(e.transform, "$item", transformTarget(e));
    };
    w.open("{");
    w.line(`const $parent = ${mount.ref};`);
    // `cond && <El/>`: an item whose condition is false has no instance, as if it were filtered out.
    const filter = list.condition !== null && alt === null ? `.filter((${item}) => ${this.arrowBody(list.condition)})` : "";
    const computed = !isNamedListSource(list.source) || around.some((outer) => readsListParams(list.source, outer));
    const args = computed ? this.aroundParams(list.source, around).map((p) => p.name).join(", ") : "";
    w.line(`const $list = ${computed ? `this.${listSourceMethod(list)}(${args})` : this.expr(list.source, true)}${filter};`);
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
      if (records) w.line(kids.length > 0 ? `const ${rec}: ${this.recordType(list)} = { current: ${item}, kids: ${this.emptyKids(list)} };` : `const ${rec} = { current: ${item} };`);
      this.within({ itemLookups: lookups }, () => {
        if (alt) {
          w.block(`if (${test})`, () => construct(el));
          w.block("else", () => construct(alt));
        } else construct(el);
        if (kids.length > 0) {
          this.within({ fieldBase: `${rec}.kids` }, () => {
            this.emitMountStatics(kids, mountOf(el, "$item"));
            this.emitChildUpdates(kids, mountOf(el, "$item"), "conditional");
          });
        }
      });
      w.line(`${items}.set($key, $item);`);
      // Hot reload and saves find a list item by its key, so removing one item does not move state between the others.
      w.line("$item.hotKey = $key;");
      if (records) w.line(`${records}.set($key, ${rec});`);
      // Among a component's passed children, an item's order is the list's own position and then its index (`[2, 5]`), so the list
      // keeps its place between the children written beside it.
      w.line(`${mount.passed ? `$parent.queueAttachPassedChild($item, [${slot}, ${position}])` : `$parent.queueAddChild($item, ${slot}, ${position})`};`);
      if (records || hasDynamicProps(el.props) || (alt !== null && hasDynamicProps(alt.props))) {
        w.close();
        w.open("} else {");
        if (records) w.line(kids.length > 0 ? `const ${rec} = ${records}.get($key)!;` : `${records}.get($key)!.current = ${item};`);
        if (records && kids.length > 0) {
          w.line(`${rec}.current = ${item};`);
          // A child made now (its condition just turned on) may hold a callback: it reads the item through the record too.
          this.within({ itemLookups: lookups, fieldBase: `${rec}.kids` }, () => this.emitChildUpdates(kids, mountOf(el, "$item"), "conditional"));
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
      w.line(`${mount.passed ? `$parent.queueReorderPassedChildren(${ordered}, [${slot}])` : `$parent.queueReorder(${slot}, ${ordered})`};`);
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
  protected recordType(list: KeyedListChildIR, around: readonly KeyedListChildIR[] = this.openLists.slice(0, -1)): string {
    const inner = [...around, list];
    const fields = itemDescendants(list.element.children).map((k) => {
      if (!isList(k)) return `${k.fieldName}: ${k.component.name} | null`;
      // A list of the item's own: its state, as a top-level list keeps it in fields of the component.
      const f = k.element.fieldName;
      const type = k.alternate ? `${k.element.component.name} | ${k.alternate.component.name}` : k.element.component.name;
      return [
        `${f}Items: Map<string | number, ${type}>`,
        `${f}Order: (string | number)[]`,
        ...(this.listNeedsRecords(k) ? [`${f}Records: Map<string | number, ${this.recordType(k, inner)}>`] : []),
        ...(k.alternate ? [`${f}Branches: Map<string | number, 0 | 1>`] : []),
      ].join("; ");
    });
    return `{ current: ${this.listItemType(list, around)}${fields.length > 0 ? `; kids: { ${fields.join("; ")} }` : ""} }`;
  }

  /** A new item's children, none made yet, and its lists empty. */
  protected emptyKids(list: KeyedListChildIR): string {
    const fields = itemDescendants(list.element.children).map((k) => {
      if (!isList(k)) return `${k.fieldName}: null`;
      const f = k.element.fieldName;
      return [`${f}Items: new Map()`, `${f}Order: []`, ...(this.listNeedsRecords(k) ? [`${f}Records: new Map()`] : []), ...(k.alternate ? [`${f}Branches: new Map()`] : [])].join(", ");
    });
    return `{ ${fields.join(", ")} }`;
  }

  /** Where a list's state is: fields of the component (the order, records and branches private), or, inside a list item, its record. */
  protected listState(field: string): { items: string; order: string; records: string; branches: string } {
    const base = this.mode.fieldBase;
    const own = base === "this" ? "this.#" : `${base}.`;
    return { items: `${base}.${field}Items`, order: `${own}${field}Order`, records: `${own}${field}Records`, branches: `${own}${field}Branches` };
  }

  /** The element type of a list's items: named through the state field, the props type or the constant, or else the return type of the method that computes them. */
  protected listItemType(list: KeyedListChildIR, around: readonly KeyedListChildIR[] = []): string {
    if (!isNamedListSource(list.source) || around.some((outer) => readsListParams(list.source, outer))) return `ReturnType<${this.c.name}[${JSON.stringify(listSourceMethod(list))}]>[number]`;
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
        const { items, order, records, branches } = this.listState(c.element.fieldName);
        return [`${items}.clear();`, `${order} = [];`, ...(this.listNeedsRecords(c) ? [`${records}.clear();`] : []), ...(c.alternate ? [`${branches}.clear();`] : [])];
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

  /**
   * The memos read by what `render()` always writes (the root's values, and every element not under a condition or in a list),
   * each once, the ones they read before them. `render()` works each out once into a local.
   */
  protected alwaysReadMemos(): Extract<ExprIR, { kind: "Memo" }>[] {
    const found: Extract<ExprIR, { kind: "Memo" }>[] = [];
    const visit = (e: ExprIR): void => {
      if (e.kind === "Memo") {
        if (found.some((m) => m.key === e.key)) return;
        visit(e.value);
        found.push(e);
        return;
      }
      if (e.kind === "Callback") return; // runs later, with its own reads
      for (const child of childExpressions(e)) visit(child);
      if (e.kind === "Block") walkStatements(e.fn.body, (inner) => inner.kind === "Memo" && visit(inner));
    };
    const element = (el: Pick<ElementIR, "props" | "transform" | "children">): void => {
      for (const p of el.props) if (p.kind === "DynamicProp" || p.kind === "SpreadProp") visit(p.value);
      for (const p of el.transform) if (p.kind === "DynamicProp") visit(p.value);
      for (const child of el.children) if (child.kind === "StaticChild") element(child.element);
    };
    element(this.c.root);
    return found;
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
  protected construct(el: ElementIR, list: KeyedListChildIR | null = null): string {
    const made = el.props.length > 0 ? `new ${el.component.name}(${this.propsObject(el.props)})` : `new ${el.component.name}()`;
    const getters = this.propGetters(el, list);
    return getters === null ? made : `this.withPropGetters(${made}, ${getters})`;
  }

  /**
   * The getters a child is given for its props that read this component's state or props (`health={s.health}`), so a handler of the
   * child reads what this component has now: a write by an earlier handler of this step, the child's own sibling's callback included.
   * Each is the prop's expression read as a handler of this component reads it. Null for a component with no such prop, and for
   * a prop that reads a keyed list's item (its getter would have to find the item again in the live list: it reads the last render's).
   */
  protected propGetters(el: ElementIR, list: KeyedListChildIR | null = null): string | null {
    if (el.component.kind === "Intrinsic") return null;
    // Only the element a list makes, not what is below it (those read the item through the list's record), and not one that switches
    // between two elements.
    if (this.itemIds.size > 0 && list === null) return null;
    if (list !== null && list.alternate !== null) return null;
    // A list inside a list item: its getter would have to find the outer items again too.
    if (list !== null && this.openLists.length > 1) return null;
    const dynamic = el.props.filter((p) => p.kind === "DynamicProp");
    const spread = el.props.some((p) => p.kind === "SpreadProp");
    if (dynamic.length === 0 && !spread) return null;
    const emit = <T>(f: () => T): T => this.within({ inCallback: true, itemLookups: [] }, f);
    // Under the conditions the child is made under (`tower !== null && <Tower …/>`) as they hold now: where they do not, the child is on its
    // way out, and the getter says nothing (the child's last props stand), so it never reads what the condition kept it from.
    const when = this.mode.conditions.map((c) => emit(() => this.expr(this.live(c))));
    const value = (e: ExprIR): string => {
      const text = emit(() => this.expr(this.live(e), true));
      return when.length === 0 ? text : `(${when.join(" && ")}) ? ${text} : undefined`;
    };
    // A list item reads its own item, which is found again by its key in the list as it is now (the source and the filter as the
    // render has them, read live). An item that is no longer there, or whose key was taken by another (`key={page}` with `label={page}`:
    // the old page, on its way out as the new one comes), says nothing, and the instance's last props stand.
    const wrap = (inner: () => string): string => {
      if (list === null) return `() => ${inner()}`;
      const item = list.item.name;
      const params = list.index ? `${item}, ${list.index.name}` : item;
      const source = emit(() => this.expr(this.live(list.source), true));
      const test = list.condition !== null ? emit(() => this.arrowBody(this.live(list.condition!))) : null;
      const key = emit(() => this.arrowBody(list.key));
      if (test !== null) this.usesAssume = true;
      return `() => { const $l = ${source}${test !== null ? `.filter((${item}) => ${test})` : ""}; const $i = $l.findIndex((${params}) => ${key} === $key); if ($i < 0) return undefined; const ${item} = $l[$i]!;${list.index ? ` const ${list.index.name} = $i;` : ""}${test !== null ? ` $assume(${test});` : ""} return ${inner()}; }`;
    };
    if (spread) {
      // A spread's members are not known here: every value prop is worked out at once, in order, as the construction does.
      const all = el.props.filter((p) => p.kind !== "CallbackProp").map((p) => (p.kind === "SpreadProp" ? `...(${value(p.value)})` : `${propertyKey((p as { name: string }).name)}: ${value((p as { value: ExprIR }).value)}`));
      return `{ $all: ${wrap(() => `({ ${all.join(", ")} })`)} }`;
    }
    return `{ ${dynamic.map((p) => `${propertyKey((p as { name: string }).name)}: ${wrap(() => value((p as { value: ExprIR }).value))}`).join(", ")} }`;
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

/**
 * Every element below a list item (through static and conditional children), and every list among them: each element is a field of
 * the item's record, and each list keeps its state there. What is inside those lists' items is in their own records.
 */
function itemDescendants(children: readonly ChildIR[]): (ElementIR | KeyedListChildIR)[] {
  return children.flatMap((c): (ElementIR | KeyedListChildIR)[] => {
    if (c.kind === "KeyedListChild") return [c];
    if (c.kind === "StaticChild" || c.kind === "ConditionalChild") return [c.element, ...itemDescendants(c.element.children)];
    return [];
  });
}

function isList(x: ElementIR | KeyedListChildIR): x is KeyedListChildIR {
  return "kind" in x && x.kind === "KeyedListChild";
}

/** Whether an expression reads a list's item or its index. */
function readsListParams(e: ExprIR, list: KeyedListChildIR): boolean {
  return readsParam(e, list.item.id) || (list.index !== null && readsParam(e, list.index.id));
}

/** Whether a render has props to send: a dynamic prop, or a spread that reads something that changes. */
function hasDynamicProps(props: readonly PropIR[]): boolean {
  return props.some((p) => p.kind === "DynamicProp" || (p.kind === "SpreadProp" && p.dependencies.length > 0));
}
