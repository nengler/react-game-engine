// Layer 3 of ComponentLowering: the JSX tree (elements, props, transforms, children, keyed lists) into ElementIR.
import { SyntaxKind, type CallExpression, type Expression, type JsxAttribute, type PropertyAccessExpression, type JsxAttributes, type JsxChild, type JsxFragment, type JsxSelfClosingElement, type Node } from "typescript/ast";
import { isBinaryExpression, isCallExpression, isPropertyAccessExpression, isConditionalExpression, isIdentifier, isJsxAttribute, isJsxSpreadAttribute, isJsxElement, isJsxExpression, isJsxSelfClosingElement, isJsxText, isObjectLiteralExpression, isPropertyAssignment, isShorthandPropertyAssignment, isArrowFunction, isJsxFragment, isStringLiteral, isBlock, isReturnStatement } from "typescript/ast/is";
import { unwrapParens, type JsxRoot } from "../analyzer/analyzer.ts";
import { DiagnosticCode, warning } from "../diagnostics/diagnostics.ts";
import { localId, type KeyedListChildIR, type ParamIR, readsParam, collectDependencies, elementId, TRANSFORM_FIELDS, type TransformField, type TransformPropIR, type ValuePropIR, type CallbackPropIR, type ChildIR, type ComponentRef, type ElementIR, type ExprIR, type HostElementIR, type PropIR, type StatementIR } from "../ir/types.ts";
import { checkFreshName, lowerFunction } from "./statements.ts";
import { GAME_TAG, type JsxElementNode, HTML_ENTITY, cleanJsxText, SPECIAL_ATTRIBUTES, findAttribute, nearest } from "./helpers.ts";
import { HookLowering } from "./hooks.ts";


/** `<Game>` props the player reads every frame, not only before the tree is built: these may be state (`timeScale={speed}`). */
const LIVE_GAME_SETTINGS: ReadonlySet<string> = new Set(["timeScale", "paused"]);

/**
 * The type of a built-in callback prop's parameter, from the manifest: a plain value (a slider's `onChange(value: number)`) is a
 * primitive, which a handler uses as any number, flag or string; anything else is a handle type, which it can only call methods on.
 */
function callbackParamType(type: string): { readonly kind: "Primitive"; readonly name: "number" | "boolean" | "string" } | { readonly kind: "Named"; readonly name: string } {
  return type === "number" || type === "boolean" || type === "string" ? { kind: "Primitive", name: type } : { kind: "Named", name: type };
}

export class ElementLowering extends HookLowering {
  /**
   * `onDefeated={() => setScore(…)}`, passed to a child component. The
   * handler runs like any other (state through `this`, refs allowed), but its
   * parameters are not annotated: the child's props type provides them.
   */
  protected lowerCallback(
    name: string,
    fn: Node & { kind: SyntaxKind.ArrowFunction },
    params?: readonly { readonly name: string; readonly type: string }[],
  ): CallbackPropIR | null {
    const handler = this.within({ inHandler: true }, () =>
      lowerFunction(this, fn as unknown as Parameters<typeof lowerFunction>[1], {
        paramTypes: params ? params.map((p) => callbackParamType(p.type)) : "contextual",
        returns: "void",
        what: `${name} callback`,
      }),
    );
    return handler && { kind: "CallbackProp", name, handler };
  }

  /**
   * The root is a built-in element (the component's class extends it) or a
   * fragment, which is an implicit container: a bare `<Entity>` with no props.
   */
  /**
   * A fragment `<>…</>` as a child, or as a branch of a condition: an implicit container, a bare `<Entity>` with no props,
   * so `{alive && <>…</>}` adds and removes its children together.
   */
  protected lowerFragment(jsx: JsxFragment, path: readonly number[]): ElementIR {
    return {
      kind: "Element",
      id: elementId(this.component.name, path),
      fieldName: this.allocateFieldName(this.hostIntrinsic, null),
      component: { kind: "Intrinsic", name: this.hostIntrinsic },
      props: [],
      transform: [],
      children: this.lowerChildren(jsx.children, path, { slot: false, passed: false }),
      span: this.span(jsx),
    };
  }

  protected lowerRoot(jsx: JsxRoot): HostElementIR | null {
    // `return <Panel …>…</Panel>`, `return open ? <Menu /> : null`, `return null`: the component is a bare container that layout
    // sees through (`layoutContents`), holding that one child, so a `<Flex>` above it lays out the panel as its own child.
    const isElement = isJsxElement(jsx) || isJsxSelfClosingElement(jsx);
    const elementTag = isElement ? (isJsxElement(jsx) ? jsx.openingElement : jsx).tagName : null;
    if (!isElement && !isJsxFragment(jsx) || (elementTag !== null && isIdentifier(elementTag) && !this.intrinsics.has(elementTag.text) && (this.locals.has(elementTag.text) || this.imported.has(elementTag.text)))) {
      const children: ChildIR[] = [];
      const expression = unwrapParens(jsx as Expression);
      if (isElement) children.push(...this.lowerChildren([jsx as JsxElementNode], [], { slot: true, passed: false }));
      else if (expression.kind !== SyntaxKind.NullKeyword) {
        let index = 1;
        this.lowerExpressionChild(expression, jsx, [0], () => [index++], { slot: true, passed: false }, children);
      }
      return { kind: "HostElement", component: { kind: "Intrinsic", name: this.hostIntrinsic }, props: [], transform: [], children, layoutContents: true, span: this.span(jsx) };
    }
    if (isJsxFragment(jsx)) {
      return {
        kind: "HostElement",
        component: { kind: "Intrinsic", name: this.hostIntrinsic },
        props: [],
        transform: [],
        children: this.lowerChildren(jsx.children, [], { slot: true, passed: false }),
        span: this.span(jsx),
      };
    }
    const opening = isJsxElement(jsx) ? jsx.openingElement : (jsx as JsxSelfClosingElement);
    const tag = opening.tagName;
    if (!isIdentifier(tag) || !this.intrinsics.has(tag.text)) {
      this.report(
        DiagnosticCode.RootMustBeEntity,
        `The root of component '${this.component.name}' must be a built-in element (${this.manifest.intrinsics.map((t) => `<${t}>`).join(", ")}), a component, a fragment \`<>…</>\`, a condition (\`open ? <Menu /> : null\`) or \`null\`.`,
        tag,
      );
      return null;
    }
    this.requireImport(tag.text, tag);
    const props = this.lowerProps(opening.attributes, tag.text, false);
    const transform = this.lowerTransform(opening.attributes, tag.text, false);
    const textProp = this.manifest.textContent[tag.text];
    let children: ChildIR[] = [];
    if (textProp !== undefined) props.push(...this.lowerTextContent(isJsxElement(jsx) ? jsx.children : [], textProp, props, tag.text, jsx));
    else if (isJsxElement(jsx)) children = this.lowerChildren(jsx.children, [], { slot: true, passed: false });
    this.checkContainer(tag.text, children.length, jsx);
    return {
      kind: "HostElement",
      component: { kind: "Intrinsic", name: tag.text },
      props,
      transform,
      children,
      span: this.span(jsx),
    };
  }

  /**
   * The text content of a built-in like `<Text>`: its JSX text and `{expressions}`
   * become one string prop (`text`), a template literal when they mix, so
   * `<Text>Score: {score}</Text>` is the one way to write it (a `text` attribute is an
   * error, see `lowerProps`). Returns the prop to add (none when the content is empty).
   */
  protected lowerTextContent(children: readonly JsxChild[], prop: string, props: readonly PropIR[], tag: string, at: Node): PropIR[] {
    const code = DiagnosticCode.UnsupportedJsxChild;
    const quasis: string[] = [""];
    const expressions: ExprIR[] = [];
    let ok = true;
    let any = false;
    for (const child of children) {
      if (isJsxText(child)) {
        if (HTML_ENTITY.test(child.text)) {
          this.report(code, `<${tag}> text cannot contain HTML entities like \`&amp;\`: write the character itself, or an expression such as {"&"}.`, child);
          ok = false;
          continue;
        }
        const text = cleanJsxText(child.text);
        if (text !== "") any = true;
        quasis[quasis.length - 1] += text;
      } else if (isJsxExpression(child)) {
        if (!child.expression) continue; // `{/* comment */}`
        if (child.dotDotDotToken) {
          this.report(code, `<${tag}> cannot spread children.`, child);
          ok = false;
          continue;
        }
        const value = this.lowerNode(child.expression);
        if (!value) {
          ok = false;
          continue;
        }
        any = true;
        // A literal is just text; anything else is interpolated (a number becomes its digits).
        if (value.kind === "StringLiteral") quasis[quasis.length - 1] += value.value;
        else if (value.kind === "NumberLiteral") quasis[quasis.length - 1] += String(value.value);
        else {
          expressions.push(value);
          quasis.push("");
        }
      } else {
        this.report(code, `<${tag}> holds text, not elements: put elements next to it, inside an <${this.hostIntrinsic}>.`, child);
        ok = false;
      }
    }
    if (!ok) return [];
    const given = props.some((p) => p.name === prop);
    if (given && any) {
      this.report(DiagnosticCode.UnsupportedAttribute, `<${tag}> takes its content as text between its tags or as \`${prop}\`, not both.`, at);
      return [];
    }
    if (given) return [];
    if (!any) {
      this.report(DiagnosticCode.UnsupportedJsxChild, `<${tag}> needs content: the text between its tags (\`<${tag}>Score: {score}</${tag}>\`).`, at);
      return [];
    }
    // `{`Score: ${score}`}` alone is already a template: use it as it is.
    const only = expressions.length === 1 && quasis.every((q) => q === "") ? expressions[0]! : null;
    const value: ExprIR =
      expressions.length === 0 ? { kind: "StringLiteral", value: quasis[0]! } : only && only.kind === "TemplateLiteral" ? only : { kind: "TemplateLiteral", quasis, expressions };
    return [valueProp(prop, value)];
  }

  /**
   * `{enemies.map((e, i) => <Enemy key={e.id} speed={e.speed} />)}`. The
   * source is a state or prop array, optionally filtered; the callback is an
   * inline arrow returning one element with a `key` and no children. The
   * item and index are parameters in a scope of their own, and the element's
   * props that read them become dynamic with an `Item` dependency, so every
   * item's props are re-applied when the list renders.
   */
  protected lowerList(call: CallExpression, path: readonly number[]): KeyedListChildIR | null {
    const code = DiagnosticCode.InvalidList;
    const callee = call.expression as PropertyAccessExpression;
    const shape = "A list is written `{items.map((item) => <Element key={item.id} … />)}`";
    if (call.questionDotToken || callee.questionDotToken) {
      this.report(code, `${shape}, without \`?.\`.`, call);
      return null;
    }
    const fn = call.arguments.length === 1 ? unwrapParens(call.arguments[0]!) : null;
    if (!fn || !isArrowFunction(fn)) {
      this.report(code, `${shape}: \`map\` takes one inline arrow function.`, call);
      return null;
    }
    let returned: Expression | null = null;
    if (!isBlock(fn.body)) returned = fn.body;
    else if (fn.body.statements.length === 1 && isReturnStatement(fn.body.statements[0]!) && fn.body.statements[0].expression) returned = fn.body.statements[0].expression;
    // The callback returns one element, or a condition choosing: `cond && <El />`, `cond ? <A /> : <B />`, `cond ? <A /> : null`.
    const body = returned ? unwrapParens(returned) : null;
    let conditionNode: Expression | null = null;
    let jsx: Expression | null = body;
    let otherJsx: Expression | null = null;
    if (body && isBinaryExpression(body) && body.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
      conditionNode = body.left;
      jsx = unwrapParens(body.right);
    } else if (body && isConditionalExpression(body)) {
      conditionNode = body.condition;
      jsx = unwrapParens(body.whenTrue);
      const other = unwrapParens(body.whenFalse);
      if (other.kind !== SyntaxKind.NullKeyword) otherJsx = other;
    }
    const isJsx = (e: Expression | null): e is JsxElementNode => e !== null && (isJsxElement(e) || isJsxSelfClosingElement(e));
    if (!isJsx(jsx) || (otherJsx !== null && !isJsx(otherJsx))) {
      this.report(code, `${shape}: the callback returns one element, or \`cond && <El …/>\`, or \`cond ? <A …/> : <B …/>\` (no fragments or other statements).`, fn.body);
      return null;
    }
    if (fn.parameters.length < 1 || fn.parameters.length > 2) {
      this.report(code, `${shape}: the callback takes the item, and optionally its index.`, fn);
      return null;
    }
    // The items are any array the component can compute: state or a prop, a member of one (`world.enemies`), a filtered or
    // mapped array, or the result of a plain function (`spotsOf(run)`). The type-check of the generated code checks it is an array.
    const source = this.lowerNode(callee.expression);
    if (!source) return null;

    return this.inScope((): KeyedListChildIR | null => {
      const params: ParamIR[] = [];
      for (const param of fn.parameters) {
        if (!isIdentifier(param.name) || param.initializer || param.dotDotDotToken || param.type) {
          this.report(code, "The list callback's parameters are plain names: `(item, index) =>`.", param);
          return null;
        }
        const name = param.name.text;
        if (!checkFreshName(this, name, param)) return null;
        const id = localId(this.componentName, name, this.nextSerial());
        this.scope.declare(name, { kind: "param", id, name, type: { kind: "Contextual" } });
        params.push({ id, name, type: { kind: "Contextual" } });
      }
      const [item, index = null] = params as [ParamIR, ParamIR?];

      const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
      const keyAttribute = findAttribute(opening.attributes, "key");
      if (!keyAttribute) {
        this.report(code, `Each item of a list needs a \`key\` that identifies it across renders: \`key={${item.name}.id}\`.`, opening);
        return null;
      }
      const keyInit = keyAttribute.initializer;
      const keyNode = keyInit && isJsxExpression(keyInit) && keyInit.expression && !keyInit.dotDotDotToken ? keyInit.expression : null;
      if (!keyNode) {
        this.report(code, `\`key\` takes an expression that reads the item: \`key={${item.name}.id}\`.`, keyAttribute);
        return null;
      }
      const key = this.lowerNode(keyNode);
      const lowered = this.lowerElement(jsx, path, true);
      if (!key || !lowered) return null;
      let condition: ExprIR | null = null;
      let alternate: ElementIR | null = null;
      if (conditionNode !== null) {
        if (index !== null) {
          this.report(code, "A list whose items are conditional cannot take the index (`(item, index) => cond && …`): the index would count the items that are left out. Use the item's own id.", fn.parameters[1]!);
          return null;
        }
        condition = this.lowerNode(conditionNode);
        if (!condition) return null;
      }
      if (otherJsx !== null) {
        const otherOpening = isJsxElement(otherJsx) ? otherJsx.openingElement : otherJsx;
        const otherKey = findAttribute(otherOpening.attributes, "key")?.initializer;
        const otherKeyNode = otherKey && isJsxExpression(otherKey) && otherKey.expression && !otherKey.dotDotDotToken ? otherKey.expression : null;
        const otherKeyIr = otherKeyNode ? this.lowerNode(otherKeyNode) : null;
        if (!otherKeyIr) {
          if (!otherKeyNode) this.report(code, "Both branches of a conditional item need a `key`, and the same one.", otherOpening);
          return null;
        }
        if (JSON.stringify(otherKeyIr) !== JSON.stringify(key)) {
          this.report(code, "Both branches of a conditional item need the same `key` expression: an item keeps its place when it switches from one to the other.", otherKeyNode!);
          return null;
        }
        alternate = this.lowerElement(otherJsx, [...path, 1], true);
        if (!alternate) return null;
      }
      const readsItem = readsParam(key, item.id);
      const readsIndex = index !== null && readsParam(key, index.id);
      if (!readsItem && !readsIndex) {
        this.report(code, `\`key\` must read the item (\`key={${item.name}.id}\`): a key that is the same for every item is always a duplicate.`, keyNode);
        return null;
      }
      if (!readsItem) {
        this.diagnostics.push(
          warning(code, `\`key\` reads only the index, so an item keeps its instance by position, not by identity: removing or reordering items moves state between them. Prefer an id from the item.`, this.span(keyNode)),
        );
      }
      if (alternate !== null && alternate.children.length > 0) {
        this.report(code, "A list item that switches between two elements cannot have children yet: make the branch a component that renders them.", jsx);
        return null;
      }
      const children = this.listItemChildren(lowered.children, item, index, jsx);
      if (!children) return null;
      const element = this.asListItem({ ...lowered, children }, item, index);
      const alternateElement = alternate && this.asListItem(alternate, item, index);
      if (!element || (alternate && !alternateElement)) return null;
      const dependencies = [...collectDependencies(source), ...(condition ? collectDependencies(condition) : [])];
      return { kind: "KeyedListChild", source, item, index, key, element, condition, alternate: alternateElement, dependencies };
    });
  }

  /**
   * A list item's children: elements and conditions of them (`{d.locked && <Lock …/>}`), nested as deep as needed; any of them
   * may read the item. Not yet: a list, `{children}` or a <Route> among them. Null (after reporting) for one of those.
   */
  protected listItemChildren(kids: readonly ChildIR[], item: ParamIR, index: ParamIR | null, at: Node): ChildIR[] | null {
    const out: ChildIR[] = [];
    for (const c of kids) {
      if (c.kind === "KeyedListChild" || c.kind === "ChildrenSlot" || (c.element.component.kind === "Intrinsic" && c.element.component.name === ROUTE_TAG)) {
        const what = c.kind === "KeyedListChild" ? (isKeyedElement(c) ? "a keyed element" : "a list") : c.kind === "ChildrenSlot" ? "`{children}`" : "a <Route>";
        const holder = isKeyedElement({ item }) ? "A keyed element" : "A list item";
        this.report(DiagnosticCode.InvalidList, `${holder} cannot hold ${what} among its children yet: make it a component that renders it.`, at);
        return null;
      }
      const grand = this.listItemChildren(c.element.children, item, index, at);
      const element = grand && this.asListItem({ ...c.element, children: grand }, item, index);
      if (!element) return null;
      if (c.kind === "StaticChild") out.push({ kind: "StaticChild", element });
      else {
        const reads = readsParam(c.condition, item.id) || (index !== null && readsParam(c.condition, index.id));
        out.push({ ...c, element, dependencies: reads ? [...c.dependencies, { kind: "Item" }] : c.dependencies });
      }
    }
    return out;
  }

  /**
   * `<Dialogue key={talk.id} />` outside a list: React's way to start an element over when what it shows changes. It is a keyed
   * list of one item, the key itself (`[talk.id]`), so a new key unmounts the old instance and mounts a new one, with fresh state,
   * and the list machinery does the rest. `condition`: the element is a branch of `cond && …` or `cond ? … : …`.
   */
  protected lowerKeyedElement(jsx: JsxElementNode, path: readonly number[], condition: ExprIR | null): KeyedListChildIR | null {
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const keyAttribute = findAttribute(opening.attributes, "key")!;
    const init = keyAttribute.initializer;
    const keyNode = init && isJsxExpression(init) && init.expression && !init.dotDotDotToken ? init.expression : init && isStringLiteral(init) ? init : null;
    if (!keyNode) {
      this.report(DiagnosticCode.UnsupportedAttribute, "`key` takes a value that identifies what the element shows: `key={talk.id}`.", keyAttribute);
      return null;
    }
    const keyValue = this.lowerNode(keyNode);
    if (!keyValue) return null;
    const id = localId(this.componentName, KEYED_ITEM, this.nextSerial());
    const item: ParamIR = { id, name: KEYED_ITEM, type: { kind: "Contextual" } };
    const lowered = this.lowerElement(jsx, path, true);
    if (!lowered) return null;
    const children = this.listItemChildren(lowered.children, item, null, jsx);
    if (!children) return null;
    const source: ExprIR = { kind: "ArrayLiteral", elements: [{ spread: false, value: keyValue }] };
    const key: ExprIR = { kind: "ParamRead", param: id, name: KEYED_ITEM };
    const dependencies = [...collectDependencies(source), ...(condition ? collectDependencies(condition) : [])];
    return { kind: "KeyedListChild", source, item, index: null, key, element: { ...lowered, children }, condition, alternate: null, dependencies };
  }

  /** `slotOk`: a `{children}` slot may appear in this element's children (it is in a static chain from the root). */
  protected lowerElement(jsx: JsxElementNode, path: readonly number[], listItem = false, slotOk = false): ElementIR | null {
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag)) {
      this.report(DiagnosticCode.UnsupportedSyntax, "Only simple identifier tag names are supported.", tag);
      return null;
    }
    let component: ComponentRef;
    if (this.intrinsics.has(tag.text)) {
      this.requireImport(tag.text, tag);
      component = { kind: "Intrinsic", name: tag.text };
    }
    else if (this.locals.has(tag.text)) component = { kind: "Local", name: tag.text };
    else if (this.imported.has(tag.text)) {
      const { module, isDefault } = this.imported.get(tag.text)!;
      component = { kind: "Imported", name: tag.text, module, isDefault };
    }
    else {
      const near = nearest(tag.text, [...this.intrinsics, ...this.locals, ...this.imported.keys()]);
      this.report(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>${near ? ` (did you mean <${near}>?)` : ""}. Declare it in this file, import it from a .tsx file, or use a runtime intrinsic.`, tag);
      return null;
    }

    if (component.kind === "Intrinsic" && tag.text === GAME_TAG) {
      this.report(DiagnosticCode.RootMustBeEntity, `<${GAME_TAG}> is the root of a component, never a child: it configures the whole game. Make it the root of your main component.`, tag);
      return null;
    }
    const isComponent = component.kind !== "Intrinsic";
    const props = this.lowerProps(opening.attributes, tag.text, isComponent, listItem);
    const transform = this.lowerTransform(opening.attributes, tag.text, isComponent);
    // On a component, the children are passed to it: the block is lowered here (this component owns them) but mounts
    // at the receiver's slot. A built-in keeps them.
    const textProp = isComponent ? undefined : this.manifest.textContent[tag.text];
    let children: ChildIR[] = [];
    if (textProp !== undefined) props.push(...this.lowerTextContent(isJsxElement(jsx) ? jsx.children : [], textProp, props, tag.text, jsx));
    else if (isJsxElement(jsx)) children = this.lowerChildren(jsx.children, path, { slot: slotOk && !isComponent, passed: isComponent, forward: slotOk && isComponent });
    if (isComponent && children.some((c) => c.kind === "KeyedListChild") && children.length > 1) {
      const what = children.some((c) => c.kind === "KeyedListChild" && !isKeyedElement(c)) ? "A list" : "A keyed element";
      this.report(
        DiagnosticCode.InvalidList,
        `${what} passed to <${tag.text}> must be its only child: its items and the other children would share positions. Wrap it in an <${this.hostIntrinsic}>.`,
        jsx,
      );
    }
    if (isComponent && children.length > 1 && children.some((c) => c.kind === "ChildrenSlot")) {
      this.report(
        DiagnosticCode.UnsupportedJsxChild,
        `\`{children}\` forwarded to <${tag.text}> must be the only child passed to it: put the other children inside <${tag.text}> itself, or pass them through \`{children}\` from the parent.`,
        jsx,
      );
    }
    if (!isComponent) this.checkContainer(tag.text, children.length, jsx);

    const fieldName = this.allocateFieldName(tag.text, listItem ? "Items" : null);
    // A <Route>'s children exist only while the route is active (shown, or being left or entered): made fresh each time it
    // comes, and gone once it has left, as React Router's are. `keepAlive` keeps them (and their state) between visits.
    if (component.kind === "Intrinsic" && tag.text === ROUTE_TAG && !hasTrueAttribute(opening.attributes, "keepAlive")) {
      children = children.map((child) => whileActive(child, fieldName));
    }

    return {
      kind: "Element",
      id: elementId(this.component.name, path),
      fieldName,
      component,
      props,
      transform,
      children,
      span: this.span(jsx),
    };
  }

  /**
   * `transform={{ x, y: 0, rotation: angle }}`: each field becomes a static or
   * dynamic prop on the element's runtime transform, so moving is `setX(...)`.
   * Every intrinsic the manifest lists in `transformIntrinsics` takes it. On
   * a component element it is placement by the parent: it sets the child's
   * `placement`, which composes under the child's own `transform`.
   */
  protected lowerTransform(attributes: JsxAttributes, tag: string, isComponent: boolean): TransformPropIR[] {
    const attribute = findAttribute(attributes, "transform");
    if (!attribute) return [];
    const code = DiagnosticCode.InvalidTransformAttribute;
    if (!isComponent && !this.manifest.transformIntrinsics.includes(tag)) {
      this.report(code, `<${tag}> cannot be placed with \`transform\` (it is not in the runtime's transformIntrinsics). Wrap it in an <${this.hostIntrinsic}> to position it.`, attribute);
      return [];
    }
    const init = attribute.initializer;
    const object = init && isJsxExpression(init) && init.expression && !init.dotDotDotToken ? unwrapParens(init.expression) : null;
    if (!object || !isObjectLiteralExpression(object)) {
      this.report(code, "`transform` takes an object literal: `transform={{ x, y: 0 }}`.", attribute);
      return [];
    }
    const out: TransformPropIR[] = [];
    for (const property of object.properties) {
      let field: string;
      let valueNode: Expression;
      if (isPropertyAssignment(property) && isIdentifier(property.name)) {
        field = property.name.text;
        valueNode = property.initializer;
      } else if (isShorthandPropertyAssignment(property) && isIdentifier(property.name)) {
        field = property.name.text;
        valueNode = property.name;
      } else {
        this.report(code, "Transform fields must be written `field: value` or `field` (shorthand); no spreads or computed names.", property);
        continue;
      }
      if (!(TRANSFORM_FIELDS as readonly string[]).includes(field)) {
        this.report(code, `'${field}' is not a transform field (${TRANSFORM_FIELDS.join(", ")}).`, property);
        continue;
      }
      if (out.some((p) => p.name === field)) {
        this.report(code, `Duplicate transform field '${field}'.`, property);
        continue;
      }
      const value = this.lowerNode(valueNode);
      if (!value) continue;
      out.push(valueProp(field as TransformField, value));
    }
    return out;
  }

  /**
   * Props of an element. `transform` is lowered separately but still counts
   * for duplicate detection; `ref` is rejected. An arrow function is a callback
   * prop: on a component element its parameters come from the child's props
   * type; on a built-in it must be one the runtime manifest lists
   * (`<Collider onCollisionEnter>`), with the parameter types it gives.
   */
  protected lowerProps(attributes: JsxAttributes, tag: string, toComponent: boolean, listItem = false): PropIR[] {
    const props: PropIR[] = [];
    const seen = new Set<string>();
    for (const attribute of attributes.properties) {
      if (isJsxSpreadAttribute(attribute)) {
        if (!toComponent) {
          this.report(DiagnosticCode.UnsupportedAttribute, `Spreading props onto a built-in (<${tag} {...props} />) is not supported yet: a built-in's props are written to its fields one by one, so name them. Spreading onto a component works.`, attribute);
          continue;
        }
        const value = this.lowerNode(attribute.expression);
        if (value) props.push({ kind: "SpreadProp", value, dependencies: collectDependencies(value) });
        continue;
      }
      if (!isJsxAttribute(attribute) || !isIdentifier(attribute.name)) {
        this.report(DiagnosticCode.UnsupportedAttribute, "Only plain `name={value}` attributes are supported.", attribute);
        continue;
      }
      const name = attribute.name.text;
      if (seen.has(name)) {
        this.report(DiagnosticCode.UnsupportedAttribute, `Duplicate attribute '${name}'.`, attribute);
        continue;
      }
      seen.add(name);
      if (SPECIAL_ATTRIBUTES.has(name) || (name === "key" && listItem)) continue;
      // A built-in whose text is its children (`<Text>Score: {score}</Text>`) takes no `text` attribute: one way to write it.
      if (!toComponent && this.manifest.textContent[tag] === name) {
        this.report(
          DiagnosticCode.UnsupportedAttribute,
          `Write the text as the children of <${tag}>, not as a \`${name}\` attribute: \`<${tag}>Score: {score}</${tag}>\`, or \`<${tag}>{label}</${tag}>\`.`,
          attribute,
        );
        continue;
      }
      if (name === "key" || name === "children") {
        this.report(
          DiagnosticCode.UnsupportedAttribute,
          name === "key"
            ? "`key` goes where the component is used, not on its root: `<Dialogue key={talk.id} />` starts it over when the key changes."
            : "`children` cannot be passed yet.",
          attribute,
        );
        continue;
      }
      if (name === "ref") {
        this.report(DiagnosticCode.InvalidUseRef, "Elements cannot be referenced: refs hold values (`const timer = useRef(0)`), and what is on screen is driven by state and props.", attribute);
        continue;
      }
      const init = attribute.initializer;
      // `timeScale` and `paused` are read every frame, so they may be state, as any prop: they fall through.
      if (!toComponent && tag === GAME_TAG && !LIVE_GAME_SETTINGS.has(name)) {
        const setting = this.lowerGameSetting(name, init, attribute);
        if (setting) props.push({ kind: "StaticProp", name, value: setting });
        continue;
      }
      let value: ExprIR | null;
      if (!init) value = { kind: "BooleanLiteral", value: true };
      else if (isStringLiteral(init)) value = { kind: "StringLiteral", value: init.text };
      else if (isJsxExpression(init) && init.expression && !init.dotDotDotToken) {
        const expression = unwrapParens(init.expression);
        if (isArrowFunction(expression)) {
          const params = toComponent ? undefined : this.manifest.intrinsicCallbacks[tag]?.[name];
          if (!toComponent && !params) {
            this.report(DiagnosticCode.UnsupportedAttribute, `<${tag}> has no callback prop '${name}': callbacks can be passed to components, and to the built-in callback props the runtime lists.`, attribute);
            continue;
          }
          const callback = this.lowerCallback(name, expression, params);
          if (callback) props.push(callback);
          continue;
        }
        // `onPress={resume}` (a game-state action) or, to a built-in, `onPress={onPress}` (a callback prop): a function passed whole.
        const passed = this.functionValue(expression);
        if (passed === null) continue;
        if (passed !== undefined) {
          if (toComponent) {
            if (passed.kind === "action") {
              props.push({ kind: "StaticProp", name, value: { kind: "ActionRef", name: passed.action } });
              continue;
            }
            if (passed.kind === "function") {
              props.push({ kind: "StaticProp", name, value: { kind: "PlainRef", name: `this.${passed.field}` } });
              continue;
            }
          } else {
            const params = this.manifest.intrinsicCallbacks[tag]?.[name];
            if (!params) {
              this.report(DiagnosticCode.UnsupportedAttribute, `<${tag}> has no callback prop '${name}': callbacks can be passed to components, and to the built-in callback props the runtime lists.`, attribute);
              continue;
            }
            // Written as the arrow an author would write by hand: `onPress={() => resume()}`.
            const handlerParams = params.map((p) => ({ id: localId(this.component.name, p.name, this.nextSerial()), name: p.name, type: callbackParamType(p.type) }));
            const args: ExprIR[] = handlerParams.map((p) => ({ kind: "ParamRead", param: p.id, name: p.name }));
            const body: StatementIR[] =
              passed.kind === "action"
                ? [{ kind: "CallAction", action: passed.action, args }]
                : passed.kind === "function"
                  ? [{ kind: "ExpressionStatement", expression: { kind: "Call", callee: { kind: "Own", name: passed.field }, args } }]
                  : [{ kind: "ExpressionStatement", expression: { kind: "Call", callee: { kind: "Prop", name: passed.name, optional: true }, args } }];
            props.push({ kind: "CallbackProp", name, handler: { kind: "Function", params: handlerParams, body } });
            continue;
          }
        }
        // `onX={onX}` forwards a callback prop whole.
        const forwarded = init.expression;
        value = this.within({ allowCallbackRead: toComponent && (isIdentifier(expression) || isPropertyAccessExpression(expression)) }, () => this.lowerNode(forwarded));
      } else {
        this.report(DiagnosticCode.UnsupportedAttribute, `Unsupported value for attribute '${name}'.`, init);
        continue;
      }
      if (!value) continue;
      if (!toComponent && !this.checkLiteralChoice(tag, name, value, attribute)) continue;
      props.push(valueProp(name, value));
    }
    return props;
  }

  /**
   * A function passed whole as an attribute: a game-state action (`resume`) or a callback prop (`onPress`, `props.onPress`).
   * Undefined when the expression is neither; null when it is a callback prop that cannot be read (reported).
   */
  protected functionValue(expression: Expression): { kind: "action"; action: string } | { kind: "prop"; name: string } | { kind: "function"; field: string } | null | undefined {
    if (isIdentifier(expression)) {
      const binding = this.scope.get(expression.text);
      if (binding?.kind === "action") return { kind: "action", action: binding.action };
      if (binding?.kind === "function") return { kind: "function", field: binding.field };
      if (binding?.kind === "prop" && binding.role === "callback") return { kind: "prop", name: binding.name };
      return undefined;
    }
    if (isPropertyAccessExpression(expression)) {
      const member = this.propsObjectMember(expression);
      if (member === null) return null;
      if (member?.role === "callback") return { kind: "prop", name: member.name };
    }
    return undefined;
  }

  /**
   * A prop of `<Game>`: the player reads these before the tree is built, so each is a literal (`width={640}`, `smooth`), and
   * `controls={controls}` the game's actions, imported from a .ts module. Anything else (a state read, an expression)
   * would not exist yet, so it is `RGE1210`.
   */
  protected lowerGameSetting(name: string, init: JsxAttribute["initializer"], at: Node): ExprIR | null {
    if (name === "controls") {
      // `controls={controls}`: the game's actions, a `createControls(…)` imported from a .ts module. Made when that module
      // loads, so it exists before the tree is built, as a literal does.
      const expression = init && isJsxExpression(init) && init.expression && !init.dotDotDotToken ? unwrapParens(init.expression) : null;
      if (!expression || !isIdentifier(expression) || !this.plainImports.has(expression.text) || this.scope.has(expression.text)) {
        this.report(DiagnosticCode.InvalidPropValue, `<${GAME_TAG} controls> takes the game's controls, imported from a .ts module: \`export const controls = createControls({ jump: ["Z", "PadA"] })\`, then \`controls={controls}\`.`, at);
        return null;
      }
      return { kind: "PlainRef", name: expression.text };
    }
    const allowed = this.manifest.intrinsicMembers[GAME_TAG] ?? [];
    if (!allowed.includes(name) || name === "name") {
      if (name === "name") return this.gameLiteral(name, init, at);
      this.report(DiagnosticCode.UnsupportedAttribute, `<${GAME_TAG}> has no prop '${name}'. Its settings: ${allowed.filter((m) => m !== "name").join(", ")}.`, at);
      return null;
    }
    return this.gameLiteral(name, init, at);
  }

  protected gameLiteral(name: string, init: JsxAttribute["initializer"], at: Node): ExprIR | null {
    let value: ExprIR | null = null;
    if (!init) value = { kind: "BooleanLiteral", value: true };
    else if (isStringLiteral(init)) value = { kind: "StringLiteral", value: init.text };
    else if (isJsxExpression(init) && init.expression && !init.dotDotDotToken) {
      const lowered = this.lowerNode(init.expression);
      if (!lowered) return null;
      value = lowered;
    }
    const literal = value && (value.kind === "NumberLiteral" || value.kind === "StringLiteral" || value.kind === "BooleanLiteral" || (value.kind === "Unary" && value.operator === "-" && value.operand.kind === "NumberLiteral"));
    if (!value || !literal) {
      this.report(DiagnosticCode.InvalidPropValue, `<${GAME_TAG} ${name}> must be a literal (a number, string or true/false): the player reads it before the tree is built, so it cannot depend on state or props.`, at);
      return null;
    }
    return value;
  }

  /**
   * `slot`: a `{children}` may appear here (a container reachable through static elements). `passed`: these are
   * children passed to a component, which mount at its slot.
   */
  protected lowerChildren(children: readonly JsxChild[], parentPath: readonly number[], context: { readonly slot: boolean; readonly passed: boolean; readonly forward?: boolean }): ChildIR[] {
    const out: ChildIR[] = [];
    let index = 0;
    for (const child of children) {
      if (isJsxText(child)) {
        if (!child.containsOnlyTriviaWhiteSpaces) {
          this.report(DiagnosticCode.UnsupportedJsxChild, "Text children are not supported.", child);
        }
        continue;
      }
      if (isJsxExpression(child) && !child.expression) continue; // `{/* comment */}`
      const path = [...parentPath, index++];

      if (hasKey(child)) {
        const keyed = this.lowerKeyedElement(child, path, null);
        if (keyed) out.push(keyed);
        continue;
      }
      if (isJsxElement(child) || isJsxSelfClosingElement(child)) {
        const element = this.lowerElement(child, path, false, context.slot);
        if (element) out.push({ kind: "StaticChild", element });
        continue;
      }
      if (isJsxFragment(child)) {
        out.push({ kind: "StaticChild", element: this.lowerFragment(child, path) });
        continue;
      }
      if (isJsxExpression(child) && child.expression) {
        this.lowerExpressionChild(unwrapParens(child.expression), child, path, () => [...parentPath, index++], context, out);
        continue;
      }
      this.report(DiagnosticCode.UnsupportedJsxChild, `Unsupported JSX child (${SyntaxKind[child.kind]}).`, child);
    }
    return out;
  }

  /**
   * `{…}` among the children (or a component's root when it is an expression, `cond ? <A /> : null`): `{children}`, a list,
   * `cond && <El />` or `cond ? <A /> : <B />`. `next` gives the path of a second element (a condition's other branch).
   */
  protected lowerExpressionChild(
    expression: Expression,
    child: Node,
    path: readonly number[],
    next: () => readonly number[],
    context: { readonly slot: boolean; readonly passed: boolean; readonly forward?: boolean },
    out: ChildIR[],
  ): void {
    if (this.isChildrenReference(expression)) {
      if (this.lowerChildrenSlot(child, context)) out.push({ kind: "ChildrenSlot" });
      return;
    }
    if (isCallExpression(expression) && isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "map") {
      const list = this.lowerList(expression, path);
      if (list) out.push(list);
      return;
    }
    if (isBinaryExpression(expression) && expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
      const right = unwrapParens(expression.right);
      if (isJsxElement(right) || isJsxSelfClosingElement(right) || isJsxFragment(right)) {
        const condition = this.lowerNode(expression.left);
        if (hasKey(right)) {
          const keyed = condition && this.lowerKeyedElement(right, path, condition);
          if (keyed) out.push(keyed);
          return;
        }
        const element = isJsxFragment(right) ? this.lowerFragment(right, path) : this.lowerElement(right, path);
        if (condition && element) {
          out.push({ kind: "ConditionalChild", condition, dependencies: collectDependencies(condition), element });
        }
        return;
      }
    }
    if (isConditionalExpression(expression)) {
      // `{c ? <A /> : <B />}` (either branch may be `null`): one conditional child per branch, the
      // second on `!c`. Each branch keeps its own identity, so switching recreates, as React does
      // for different element types.
      const branches = [unwrapParens(expression.whenTrue), unwrapParens(expression.whenFalse)];
      const usable = branches.every((b) => isJsxElement(b) || isJsxSelfClosingElement(b) || isJsxFragment(b) || b.kind === SyntaxKind.NullKeyword);
      if (usable) {
        const condition = this.lowerNode(expression.condition);
        if (!condition) return;
        const conditions: ExprIR[] = [condition, { kind: "Unary", operator: "!", operand: condition }];
        branches.forEach((branch, i) => {
          if (!(isJsxElement(branch) || isJsxSelfClosingElement(branch) || isJsxFragment(branch))) return;
          const at = i === 0 ? path : next();
          const when = conditions[i]!;
          if (hasKey(branch)) {
            const keyed = this.lowerKeyedElement(branch, at, when);
            if (keyed) out.push(keyed);
            return;
          }
          const element = isJsxFragment(branch) ? this.lowerFragment(branch, at) : this.lowerElement(branch, at);
          if (element) out.push({ kind: "ConditionalChild", condition: when, dependencies: collectDependencies(when), element });
        });
        return;
      }
    }
    this.report(DiagnosticCode.UnsupportedJsxChild, "Expression children must have the form `{condition && <Element />}`, `{condition ? <A /> : <B />}` (a branch may be `null`, and an element may be a fragment `<>…</>`) or `{items.map((item) => <Element key={item.id} />)}`.", child);
  }
}

const ROUTE_TAG = "Route";

/** The item of a keyed element's list of one (`lowerKeyedElement`): a name source code cannot write (`$` is reserved). */
const KEYED_ITEM = "$keyed";

/** Whether a keyed list is a keyed element outside a list (`<Dialogue key={talk.id} />`), a list of one made by the compiler. */
function isKeyedElement(list: { readonly item: ParamIR }): boolean {
  return list.item.name === KEYED_ITEM;
}

/** Does the element carry a `key` (outside a list: a keyed element)? */
function hasKey(jsx: Node): jsx is JsxElementNode {
  if (!isJsxElement(jsx) && !isJsxSelfClosingElement(jsx)) return false;
  const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
  return findAttribute(opening.attributes, "key") !== null;
}

/** A prop that reads nothing that changes is static (evaluated once); otherwise it is dynamic, re-applied when what it reads changes. */
function valueProp<N extends string>(name: N, value: ExprIR): ValuePropIR & { readonly name: N } {
  const dependencies = collectDependencies(value);
  return dependencies.length > 0 ? { kind: "DynamicProp", name, value, dependencies } : { kind: "StaticProp", name, value };
}

/** Is the attribute written as `name` or `name={true}`? */
function hasTrueAttribute(attributes: JsxAttributes, name: string): boolean {
  const attribute = findAttribute(attributes, name);
  if (!attribute) return false;
  const init = attribute.initializer;
  if (!init) return true;
  return isJsxExpression(init) && init.expression !== undefined && init.expression.kind === SyntaxKind.TrueKeyword;
}

/** A route's child, made to exist only while the route (the element in field `route`) is active. */
function whileActive(child: ChildIR, route: string): ChildIR {
  const active: ExprIR = { kind: "ElementRead", field: route, member: "active" };
  if (child.kind === "StaticChild") return { kind: "ConditionalChild", condition: active, dependencies: [], element: child.element };
  if (child.kind === "ConditionalChild") {
    return { ...child, condition: { kind: "Binary", operator: "&&", left: active, right: child.condition } };
  }
  return child; // a list or a slot keeps its own rules
}
