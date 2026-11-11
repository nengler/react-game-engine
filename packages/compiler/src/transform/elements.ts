// Layer 3 of ComponentLowering: the JSX tree (elements, props, transforms, children, keyed lists) into ElementIR.
import { SyntaxKind, type CallExpression, type Expression, type JsxAttribute, type PropertyAccessExpression, type JsxAttributes, type JsxChild, type JsxFragment, type Node } from "typescript/ast";
import { isBinaryExpression, isCallExpression, isPropertyAccessExpression, isConditionalExpression, isIdentifier, isJsxAttribute, isJsxElement, isJsxExpression, isJsxSelfClosingElement, isJsxText, isObjectLiteralExpression, isPropertyAssignment, isShorthandPropertyAssignment, isArrowFunction, isJsxFragment, isStringLiteral, isBlock, isReturnStatement } from "typescript/ast/is";
import { unwrapParens, type JsxRoot } from "../analyzer/analyzer.ts";
import { DiagnosticCode, warning } from "../diagnostics/diagnostics.ts";
import { localId, type KeyedListChildIR, type ParamIR, readsParam, collectDependencies, elementId, TRANSFORM_FIELDS, type TransformField, type TransformPropIR, type CallbackPropIR, type ChildIR, type ComponentRef, type ElementIR, type ExprIR, type HostElementIR, type PropIR } from "../ir/types.ts";
import { Scope } from "./scope.ts";
import { checkFreshName, lowerFunction } from "./statements.ts";
import { GAME_TAG, type JsxElementNode, HTML_ENTITY, cleanJsxText, SPECIAL_ATTRIBUTES, isListSource, findAttribute } from "./helpers.ts";
import { HookLowering } from "./hooks.ts";

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
    this.functionDepth++;
    const handler = lowerFunction(this, fn as unknown as Parameters<typeof lowerFunction>[1], {
      paramTypes: params ? params.map((p) => ({ kind: "Named" as const, name: p.type })) : "contextual",
      returns: "void",
      what: `${name} callback`,
    });
    this.functionDepth--;
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
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag) || !this.intrinsics.has(tag.text)) {
      this.report(
        DiagnosticCode.RootMustBeEntity,
        `The root of component '${this.component.name}' must be a built-in element (${this.manifest.intrinsics.map((t) => `<${t}>`).join(", ")}) or a fragment \`<>…</>\`; a component cannot be the root of another.`,
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
   * `<Text>Score: {score}</Text>` and `<Text text={`Score: ${score}`} />` are the
   * same thing and update the same way. The element may use one form or the other.
   * Returns the prop to add (none when the content is the attribute or is empty).
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
      this.report(DiagnosticCode.UnsupportedJsxChild, `<${tag}> needs content: text between its tags (\`<${tag}>Score: {score}</${tag}>\`) or a \`${prop}\` prop.`, at);
      return [];
    }
    // `{`Score: ${score}`}` alone is already a template: use it as it is.
    const only = expressions.length === 1 && quasis.every((q) => q === "") ? expressions[0]! : null;
    const value: ExprIR =
      expressions.length === 0 ? { kind: "StringLiteral", value: quasis[0]! } : only && only.kind === "TemplateLiteral" ? only : { kind: "TemplateLiteral", quasis, expressions };
    const dependencies = collectDependencies(value);
    return [dependencies.length > 0 ? { kind: "DynamicProp", name: prop, value, dependencies } : { kind: "StaticProp", name: prop, value }];
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
    const jsx = returned ? unwrapParens(returned) : null;
    if (!jsx || !(isJsxElement(jsx) || isJsxSelfClosingElement(jsx))) {
      this.report(code, `${shape}: the callback returns exactly one element (no conditionals, fragments or other statements).`, fn.body);
      return null;
    }
    if (fn.parameters.length < 1 || fn.parameters.length > 2) {
      this.report(code, `${shape}: the callback takes the item, and optionally its index.`, fn);
      return null;
    }
    const source = this.lowerNode(callee.expression);
    if (!source) return null;
    if (!isListSource(source)) {
      this.report(code, "A list's items come from a state or prop array, optionally followed by `.filter(…)`: `enemies.map(…)` or `enemies.filter((e) => e.alive).map(…)`.", callee.expression);
      return null;
    }

    const outer = this.scope;
    this.scope = new Scope(outer);
    try {
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
      if (lowered.children.length > 0) {
        this.report(code, "A list item cannot have children yet: make the item a component that renders them.", jsx);
        return null;
      }
      const element = this.asListItem(lowered, item, index);
      return element && { kind: "KeyedListChild", source, item, index, key, element, dependencies: collectDependencies(source) };
    } finally {
      this.scope = outer;
    }
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
      this.report(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>. Declare it in this file, import it from a .tsx file, or use a runtime intrinsic.`, tag);
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
    else if (isJsxElement(jsx)) children = this.lowerChildren(jsx.children, path, { slot: slotOk && !isComponent, passed: isComponent });
    if (isComponent && children.some((c) => c.kind === "KeyedListChild") && children.length > 1) {
      this.report(
        DiagnosticCode.InvalidList,
        `A list passed to <${tag.text}> must be its only child: the list's items and the other children would share positions. Wrap the list in an <${this.hostIntrinsic}> or make the others part of the list.`,
        jsx,
      );
    }
    if (!isComponent) this.checkContainer(tag.text, children.length, jsx);

    return {
      kind: "Element",
      id: elementId(this.component.name, path),
      fieldName: this.allocateFieldName(tag.text, listItem ? "Items" : null),
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
      const name = field as TransformField;
      const dependencies = collectDependencies(value);
      out.push(dependencies.length > 0 ? { kind: "DynamicProp", name, value, dependencies } : { kind: "StaticProp", name, value });
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
      if (name === "key" || name === "children") {
        this.report(
          DiagnosticCode.UnsupportedAttribute,
          name === "key" ? "`key` belongs on the element a list returns: `{items.map((item) => <Element key={item.id} />)}`." : "`children` cannot be passed yet.",
          attribute,
        );
        continue;
      }
      if (name === "ref") {
        this.report(DiagnosticCode.InvalidUseRef, "Elements cannot be referenced: refs hold values (`const timer = useRef(0)`), and what is on screen is driven by state and props.", attribute);
        continue;
      }
      const init = attribute.initializer;
      if (!toComponent && tag === GAME_TAG) {
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
        // `onX={onX}` forwards a callback prop whole.
        this.allowCallbackRead = toComponent && (isIdentifier(expression) || isPropertyAccessExpression(expression));
        try {
          value = this.lowerNode(init.expression);
        } finally {
          this.allowCallbackRead = false;
        }
      } else {
        this.report(DiagnosticCode.UnsupportedAttribute, `Unsupported value for attribute '${name}'.`, init);
        continue;
      }
      if (!value) continue;
      if (!toComponent && !this.checkLiteralChoice(tag, name, value, attribute)) continue;
      const dependencies = collectDependencies(value);
      props.push(dependencies.length > 0 ? { kind: "DynamicProp", name, value, dependencies } : { kind: "StaticProp", name, value });
    }
    return props;
  }

  /**
   * A prop of `<Game>`: the player reads these before the tree is built, so each is a literal (`width={640}`, `smooth`), and
   * `controls={controls}` the game's actions, imported from a .ts module. Anything else (a state read, an expression)
   * would not exist yet, so it is `RGE1210`.
   */
  protected lowerGameSetting(name: string, init: JsxAttribute["initializer"], at: Node): ExprIR | null {
    if (name === "state") {
      // Retired (2026-11-11): every game state starts from its initial values when a game starts, so there is nothing to hand over.
      this.report(DiagnosticCode.UnsupportedAttribute, `<${GAME_TAG} state> is no longer needed: the game state starts fresh with every game. Remove it.`, at);
      return null;
    }
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
  protected lowerChildren(children: readonly JsxChild[], parentPath: readonly number[], context: { readonly slot: boolean; readonly passed: boolean }): ChildIR[] {
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
        const expression = unwrapParens(child.expression);
        if (this.isChildrenReference(expression)) {
          if (this.lowerChildrenSlot(child, context)) out.push({ kind: "ChildrenSlot" });
          continue;
        }
        if (isCallExpression(expression) && isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "map") {
          const list = this.lowerList(expression, path);
          if (list) out.push(list);
          continue;
        }
        if (isBinaryExpression(expression) && expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
          const right = unwrapParens(expression.right);
          if (isJsxElement(right) || isJsxSelfClosingElement(right) || isJsxFragment(right)) {
            const condition = this.lowerNode(expression.left);
            const element = isJsxFragment(right) ? this.lowerFragment(right, path) : this.lowerElement(right, path);
            if (condition && element) {
              out.push({ kind: "ConditionalChild", condition, dependencies: collectDependencies(condition), element });
            }
            continue;
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
            if (!condition) continue;
            const conditions: ExprIR[] = [condition, { kind: "Unary", operator: "!", operand: condition }];
            branches.forEach((branch, i) => {
              if (!(isJsxElement(branch) || isJsxSelfClosingElement(branch) || isJsxFragment(branch))) return;
              const at = i === 0 ? path : [...parentPath, index++];
              const element = isJsxFragment(branch) ? this.lowerFragment(branch, at) : this.lowerElement(branch, at);
              const when = conditions[i]!;
              if (element) out.push({ kind: "ConditionalChild", condition: when, dependencies: collectDependencies(when), element });
            });
            continue;
          }
        }
        this.report(DiagnosticCode.UnsupportedJsxChild, "Expression children must have the form `{condition && <Element />}`, `{condition ? <A /> : <B />}` (a branch may be `null`, and an element may be a fragment `<>…</>`) or `{items.map((item) => <Element key={item.id} />)}`.", child);
        continue;
      }
      this.report(DiagnosticCode.UnsupportedJsxChild, `Unsupported JSX child (${SyntaxKind[child.kind]}).`, child);
    }
    return out;
  }
}
