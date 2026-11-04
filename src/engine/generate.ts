// The code generator: a validator's compiled tree (tree.ts) written out as the source of a check
// that returns true or false, the verdict the interpreter's `check` gives (interpret.ts), with no
// error object made. dotschema's `.is()` runs it, and `.validate()` runs it first, leaving the
// interpreter's `errors` to a value it refuses: the errors always come from the interpreter.
//
// The source is a function expression `(r) => (value) => boolean`; `r` is built by `link`
// (link.ts) from the tree, so the source holds no path, no format and no regular expression, only the
// literals its checks compare (property names, `const` and `enum` values, discriminator tags), each
// written as a JSON string. It is a pure function of the tree: the same resources compiled with the
// same options give the same text.
//
// Two uses: `jit`, at run time, through `new Function`, undefined where the runtime refuses to build
// code from a string (a Content Security Policy, `--disallow-code-generation-from-strings`, a
// Cloudflare Worker), and ahead of time, the source written into a module at build time beside
// `link`, which the module calls with it, so nothing is built from a string at run time.
//
// The code follows the interpreter keyword by keyword, in its order, and inlines what it checks:
// each schema ajv compiles as a function of its own is a function here, called by every `$ref` to
// it, recursion included, and every other schema is written in place. A failure is a `return false`
// or a `break` out of a labelled block, so a passing value makes no object for the keywords that
// read only the value; an object's keys are read with `for...in` and `hasOwnProperty`, which give
// `Object.keys`' keys without making an array.
//
// `unevaluatedProperties` and `unevaluatedItems` read what the schema's other keywords evaluated.
// Where that is decided by the schema alone, or by which branches of an `anyOf`, `oneOf`, `if`,
// `dependentSchemas` or discriminator written in the same function passed, each recorded in a local
// boolean, the code tests a key or an item against those directly ("static"). Where it is not (a
// function that evaluates by branches of its own, a reference back into the same value, a dynamic
// reference), the code keeps the interpreter's record of what was evaluated, an object passed down,
// and makes one at each schema that reads it ("dynamic"). The dynamic scope that a `$dynamicRef` or
// `$recursiveRef` reads is kept as the interpreter keeps it, a stack of resources, here by index.
//
// No keyword is left to the interpreter: every node of the tree is written out.
import type { Validator } from "./index.ts";
import { constPlan, enumPlan, literal, planOf, tablesOf, type Plan } from "./link.ts";
import type { JsonType, KeywordNode, SchemaNode } from "./tree.ts";

export { link } from "./link.ts";

/** A pass/fail check's source: a JavaScript function expression `(r) => (value) => boolean`, where `r` holds what the code reads from the compiled tree (formats, regular expressions, deep equality, string length; no node is left to the interpreter). Deterministic for the same resources and options. */
export interface Generated {
  source: string;
}

type Group = "any" | "number" | "string" | "array" | "object";

const GROUP_ORDER: readonly Group[] = ["any", "number", "string", "array", "object"];

const GROUP_OF: Record<JsonType, Group | undefined> = { number: "number", integer: "number", string: "string", array: "array", object: "object", boolean: undefined, null: undefined };

const GUARD: Record<Exclude<Group, "any">, (d: string) => string> = {
  number: (d) => `typeof ${d} == "number"`,
  string: (d) => `typeof ${d} == "string"`,
  array: (d) => `Array.isArray(${d})`,
  object: (d) => `typeof ${d} == "object" && ${d} !== null && !Array.isArray(${d})`,
};

/** A value of one JSON type, as the interpreter's `isType` tests it. */
function typeTest(t: JsonType, d: string): string {
  switch (t) {
    case "null":
      return `${d} === null`;
    case "array":
      return `Array.isArray(${d})`;
    case "object":
      return `(typeof ${d} == "object" && ${d} !== null && !Array.isArray(${d}))`;
    case "integer":
      // ajv's test, which takes Infinity for an integer.
      return `(typeof ${d} == "number" && !(${d} % 1) && ${d} === ${d})`;
    case "number":
      return `typeof ${d} == "number"`;
    default:
      return `typeof ${d} == "${t}"`;
  }
}

/** Names in a fixed order whatever the locale: by their letters, then their number. */
const byName = (a: string, b: string): number => {
  const [, la = "", na = ""] = /^([a-z]*)(\d*)$/i.exec(a) ?? [];
  const [, lb = "", nb = ""] = /^([a-z]*)(\d*)$/i.exec(b) ?? [];
  return la < lb ? -1 : la > lb ? 1 : Number(na) - Number(nb);
};

const NEW_EV = "{ props: void 0, items: 0, idx: void 0 }";

/** A string or number as a literal; every value the code writes goes through `literal`. */
const lit = (value: unknown): string => {
  const text = literal(value);
  if (text === undefined) throw new Error(`dotschema's code generator cannot write ${typeof value} as a literal`);
  return text;
};

/** What one keyword evaluated: every property or item, a property by name or pattern, the first `n` items, or the items a `contains` schema matches. */
type Contribution =
  | { readonly kind: "propsAll" | "itemsAll" }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "pattern"; readonly re: number }
  | { readonly kind: "items"; readonly n: number }
  | { readonly kind: "contains"; readonly node: SchemaNode };

/** A contribution under the branches it was written in, each a condition on locals. */
type Term = Contribution & { readonly guard: readonly string[] };

/** A schema with `unevaluatedProperties` or `unevaluatedItems` checked statically: what the keywords before each have evaluated, and how deep in branches it is. */
interface Context {
  readonly terms: Term[];
  readonly depth: number;
  /** The locals of every branch below the outermost context, declared at its start. */
  readonly bits: string[];
}

/** Where a schema's code is written. */
interface Site {
  /** The variable holding the value. */
  readonly d: string;
  /** The statement that fails the schema. */
  readonly fail: string;
  /** The variable holding the interpreter's record of what was evaluated, in the dynamic mode, or null. */
  readonly ev: string | null;
  /** The static contexts the schema's evaluation counts for, innermost last. */
  readonly stack: readonly Context[];
  /** The branch conditions it is written under. */
  readonly guard: readonly string[];
  /** The resource known to be at the top of the dynamic scope, or -1. */
  readonly top: number;
}

/** What a function's schemas evaluate whatever the value, for the static mode, or null for a part that depends on branches inside the function. */
interface Unconditional {
  readonly props: { all: boolean; names: string[]; patterns: RegExp[] } | null;
  readonly items: { all: boolean; n: number; contains: SchemaNode[] } | null;
}

const NOTHING_KNOWN: Unconditional = { props: null, items: null };

/** The schemas a keyword applies to the same value, which write into what it evaluated. */
function inPlace(k: KeywordNode): readonly SchemaNode[] {
  switch (k.keyword) {
    case "$ref":
    case "$dynamicRef":
    case "$recursiveRef":
      return [k.child!];
    case "allOf":
    case "anyOf":
    case "oneOf":
    case "discriminator":
      return k.children!;
    case "if":
      return [k.child!, ...(k.then ? [k.then] : []), ...(k.else ? [k.else] : [])];
    case "dependencies":
    case "dependentSchemas":
      return k.entries!.map(([, node]) => node);
  }
  return [];
}

class Generator {
  readonly #plan: Plan;
  /** Whether `contains` marks the items it matched evaluated (2020-12). */
  readonly #marks: boolean;
  readonly #dyn: boolean;
  readonly #functions = new Map<string, string>();
  readonly #queue: [root: number, tracking: boolean][] = [];
  readonly #dynamicHelpers = new Map<string, string>();
  readonly #hoisted = new Set<string>();
  #counter = 0;
  readonly #touchMemo = new Map<SchemaNode, boolean>();
  readonly #staticMemo = new Map<SchemaNode, boolean>();
  readonly #unconditionalMemo = new Map<SchemaNode, Unconditional>();

  constructor(plan: Plan, marks: boolean) {
    this.#plan = plan;
    this.#marks = marks;
    this.#dyn = plan.dynamicScope;
  }

  source(): string {
    this.#fn(0, false);
    while (this.#queue.length) {
      const [root, tracking] = this.#queue.shift()!;
      this.#functions.set(this.#name(root, tracking), this.#emitFunction(root, tracking));
    }
    const lines: string[] = [`"use strict";`, `if (r.sig !== ${lit(this.#plan.sig)}) throw new Error("dotschema: a generated check was linked to a schema other than its own");`];
    const hoisted = [...this.#hoisted].sort(byName);
    if (hoisted.length) lines.push(`const ${hoisted.map((name) => `${name} = ${this.#hoistedValue(name)}`).join(", ")};`);
    const names = [...this.#functions.keys()].sort(byName);
    for (const name of names) lines.push(this.#functions.get(name)!);
    for (const name of [...this.#dynamicHelpers.keys()].sort(byName)) lines.push(this.#dynamicHelpers.get(name)!);
    lines.push(this.#dyn ? "return (d) => v0(d, []);" : "return v0;");
    return `(r) => {\n${lines.join("\n")}\n}`;
  }

  #hoistedValue(name: string): string {
    if (name === "h") return "Object.prototype.hasOwnProperty";
    if (name === "eq" || name === "len" || name === "mul" || name === "uq" || name === "oe" || name === "M" || name === "R") return `r.${name}`;
    const index = name.slice(2);
    switch (name.slice(0, 2)) {
      case "re":
        return `r.re[${index}]`;
      case "fm":
        return `r.f[${index}]`;
      case "cm":
        return `r.c[${index}]`;
      case "vl":
        return `r.v[${index}]`;
    }
    throw new Error(`unknown hoisted name ${name}`);
  }

  #use(name: string): string {
    this.#hoisted.add(name);
    return name;
  }

  #name(root: number, tracking: boolean): string {
    return `${tracking ? "e" : "v"}${root}`;
  }

  /** The function of a root, written once. */
  #fn(root: number, tracking: boolean): string {
    const name = this.#name(root, tracking);
    if (!this.#functions.has(name)) {
      this.#functions.set(name, "");
      this.#queue.push([root, tracking]);
    }
    return name;
  }

  #local(prefix: string): string {
    return `${prefix}${++this.#counter}`;
  }

  #emitFunction(root: number, tracking: boolean): string {
    this.#counter = 0;
    const node = this.#plan.roots[root]!;
    const name = this.#name(root, tracking);
    const params = ["d", ...(tracking ? ["ev"] : []), ...(this.#dyn ? ["sc"] : [])].join(", ");
    if (node.schema === true) return `function ${name}(${params}) { return true; }`;
    if (node.schema === false) return `function ${name}(${params}) { return false; }`;
    const site = { d: "d", ev: tracking ? "ev" : null, stack: [], guard: [] };
    if (!this.#dyn) return `function ${name}(${params}) {\n${this.#inner(node, { ...site, fail: "return false;", top: -1 })}return true;\n}`;
    const resource = this.#plan.resourceOf.get(node.resource)!;
    const label = this.#local("L");
    const body = this.#inner(node, { ...site, fail: `break ${label};`, top: resource });
    return `function ${name}(${params}) {\nconst p = sc[sc.length - 1] !== ${resource};\nif (p) sc.push(${resource});\nlet o = false;\n${label}: {\n${body}o = true;\n}\nif (p) sc.pop();\nreturn o;\n}`;
  }

  // ---- what the static mode can see ------------------------------------------------------------

  /** Whether a schema, or one it applies in place, has a keyword that writes what it evaluated. */
  #touches(node: SchemaNode): boolean {
    const known = this.#touchMemo.get(node);
    if (known !== undefined) return known;
    const seen = new Set<SchemaNode>();
    const walk = (n: SchemaNode): boolean => {
      if (seen.has(n)) return false;
      seen.add(n);
      for (const k of n.keywords) {
        switch (k.keyword) {
          case "properties":
          case "patternProperties":
          case "additionalProperties":
          case "unevaluatedProperties":
          case "unevaluatedItems":
          case "prefixItems":
          case "items":
          case "additionalItems":
            return true;
          case "contains":
            if (this.#marks) return true;
            break;
        }
        if (k.dynamic) return true;
        for (const child of inPlace(k)) if (walk(child)) return true;
      }
      return false;
    };
    const result = walk(node);
    this.#touchMemo.set(node, result);
    return result;
  }

  /** What a function's schema evaluates on every value it passes, for each of the two parts that depends on no branch. */
  #unconditional(node: SchemaNode, visiting = new Set<SchemaNode>()): Unconditional {
    const known = this.#unconditionalMemo.get(node);
    if (known) return known;
    if (visiting.has(node)) return NOTHING_KNOWN;
    visiting.add(node);
    let props: { all: boolean; names: string[]; patterns: RegExp[] } | null = { all: false, names: [], patterns: [] };
    let items: { all: boolean; n: number; contains: SchemaNode[] } | null = { all: false, n: 0, contains: [] };
    const add = (u: Unconditional) => {
      if (!u.props) props = null;
      else if (props) {
        props.all ||= u.props.all;
        props.names.push(...u.props.names);
        props.patterns.push(...u.props.patterns);
      }
      if (!u.items) items = null;
      else if (items) {
        items.all ||= u.items.all;
        items.n = Math.max(items.n, u.items.n);
        items.contains.push(...u.items.contains);
      }
    };
    const branch = (u: Unconditional) => {
      if (!u.props || u.props.all || u.props.names.length || u.props.patterns.length) props = null;
      if (!u.items || u.items.all || u.items.n || u.items.contains.length) items = null;
    };
    for (const k of node.keywords) {
      switch (k.keyword) {
        case "properties":
          props?.names.push(...k.entries!.map(([key]) => key));
          break;
        case "patternProperties":
          props?.patterns.push(...k.regexps!);
          break;
        case "additionalProperties":
        case "unevaluatedProperties":
          if (props) props.all = true;
          break;
        case "prefixItems":
        case "items":
          if (items) {
            if (k.children) items.n = Math.max(items.n, k.children.length);
            else items.all = true;
          }
          break;
        case "additionalItems":
        case "unevaluatedItems":
          if (items) items.all = true;
          break;
        case "contains":
          if (this.#marks && items) {
            if (k.child!.alwaysValid) items.all = true;
            else items.contains.push(k.child!);
          }
          break;
        case "$ref":
        case "$dynamicRef":
        case "$recursiveRef":
          if (k.dynamic) add(NOTHING_KNOWN);
          else add(this.#unconditional(k.child!, visiting));
          break;
        case "allOf":
          for (const child of k.children!) add(this.#unconditional(child, visiting));
          break;
        case "anyOf":
        case "oneOf":
          if (k.children!.length === 1) add(this.#unconditional(k.children![0]!, visiting));
          else for (const child of k.children!) branch(this.#unconditional(child, visiting));
          break;
        case "if":
        case "dependencies":
        case "dependentSchemas":
        case "discriminator":
          for (const child of inPlace(k)) branch(this.#unconditional(child, visiting));
          break;
      }
    }
    visiting.delete(node);
    const result: Unconditional = { props, items };
    this.#unconditionalMemo.set(node, result);
    return result;
  }

  /** Whether a schema with `unevaluated*`, where it is checked with nothing passed to it, can be checked statically: no dynamic scope, no reference back into the same value, and every function it applies in place evaluating the same whatever its branches. */
  #isStatic(u: SchemaNode): boolean {
    if (this.#dyn) return false;
    const known = this.#staticMemo.get(u);
    if (known !== undefined) return known;
    const needs = { props: false, items: false };
    const roots: SchemaNode[] = [];
    const path = new Set<SchemaNode>();
    let ok = true;
    const visit = (n: SchemaNode) => {
      if (!ok) return;
      if (path.has(n)) {
        ok = false;
        return;
      }
      path.add(n);
      for (const k of n.keywords) {
        if (k.keyword === "unevaluatedProperties") needs.props = true;
        if (k.keyword === "unevaluatedItems") needs.items = true;
        if (k.dynamic) ok = false;
        for (const child of inPlace(k)) {
          if (child.root) roots.push(child);
          else visit(child);
        }
      }
      path.delete(n);
    };
    visit(u);
    for (const root of roots) {
      if (!ok) break;
      if (root === u) ok = false;
      const x = this.#unconditional(root);
      if ((needs.props && !x.props) || (needs.items && !x.items)) ok = false;
    }
    this.#staticMemo.set(u, ok);
    return ok;
  }

  /** Records a contribution in every static context the site counts for, under the branches since each began. */
  #contribute(s: Site, term: Contribution): void {
    for (const ctx of s.stack) ctx.terms.push({ ...term, guard: s.guard.slice(ctx.depth) });
  }

  /** A local for a branch condition, declared at the outermost static context. */
  #bit(s: Site, init: string): string {
    const name = this.#local("b");
    s.stack[0]!.bits.push(`${name} = ${init}`);
    return name;
  }

  #tracking(s: Site): boolean {
    return s.ev !== null || s.stack.length > 0;
  }

  /** A site for a part of the value: nothing evaluated there counts for the schema above. */
  #part(s: Site, d: string, fail = s.fail): Site {
    return { d, fail, ev: null, stack: [], guard: [], top: s.top };
  }

  /** The same value, outside what the schema above evaluates (`not`, a branch that touches nothing). */
  #plain(s: Site, fail = s.fail): Site {
    return { d: s.d, fail, ev: null, stack: [], guard: [], top: s.top };
  }

  // ---- schemas ---------------------------------------------------------------------------------

  /** A schema: a call to its function, or its code in place, entering its resource in the dynamic scope. */
  #node(n: SchemaNode, s: Site): string {
    if (n.schema === true) return "";
    if (n.schema === false) return `${s.fail}\n`;
    if (n.root) return this.#call(n, s);
    if (this.#dyn) {
      const resource = this.#plan.resourceOf.get(n.resource)!;
      if (resource !== s.top) {
        const label = this.#local("L");
        const ok = this.#local("o");
        const body = this.#inner(n, { ...s, fail: `break ${label};`, top: resource });
        return `sc.push(${resource});\nlet ${ok} = false;\n${label}: {\n${body}${ok} = true;\n}\nsc.pop();\nif (!${ok}) ${s.fail}\n`;
      }
    }
    return this.#inner(n, s);
  }

  #call(n: SchemaNode, s: Site): string {
    const root = this.#plan.rootOf.get(n)!;
    const scope = this.#dyn ? ", sc" : "";
    if (s.ev && this.#touches(n)) return `if (!${this.#fn(root, true)}(${s.d}, ${s.ev}${scope})) ${s.fail}\n`;
    if (s.stack.length && this.#touches(n)) this.#contributeUnconditional(n, s);
    return `if (!${this.#fn(root, false)}(${s.d}${scope})) ${s.fail}\n`;
  }

  /** What a function's schema evaluates, recorded where it is called from a static context. */
  #contributeUnconditional(n: SchemaNode, s: Site): void {
    // A part left unknown is one no context needs: `isStatic` checked each context's.
    const u = this.#unconditional(n);
    if (u.props) {
      if (u.props.all) this.#contribute(s, { kind: "propsAll" });
      for (const name of u.props.names) this.#contribute(s, { kind: "name", name });
      for (const re of u.props.patterns) this.#contribute(s, { kind: "pattern", re: this.#plan.regexpOf.get(re)! });
    }
    if (u.items) {
      if (u.items.all) this.#contribute(s, { kind: "itemsAll" });
      if (u.items.n) this.#contribute(s, { kind: "items", n: u.items.n });
      for (const node of u.items.contains) this.#contribute(s, { kind: "contains", node });
    }
  }

  /** A schema's code in place: its own record of what it evaluated where it reads one, then its keywords. */
  #inner(n: SchemaNode, s: Site): string {
    if (n.schema === true) return "";
    if (n.schema === false) return `${s.fail}\n`;
    if (!n.unevaluated) return this.#body(n, s);
    if (s.ev) {
      const t = this.#local("t");
      this.#use("M");
      return `const ${t} = ${NEW_EV};\n${this.#body(n, { ...s, ev: t, stack: [], guard: [] })}M(${s.ev}, ${t});\n`;
    }
    if (this.#isStatic(n)) {
      const ctx: Context = { terms: [], depth: s.guard.length, bits: [] };
      const code = this.#body(n, { ...s, stack: [...s.stack, ctx] });
      return (s.stack.length === 0 && ctx.bits.length ? `let ${ctx.bits.join(", ")};\n` : "") + code;
    }
    if (s.stack.length) throw new Error("dotschema's code generator: a schema below a static context is not static");
    const t = this.#local("t");
    return `const ${t} = ${NEW_EV};\n${this.#body(n, { ...s, ev: t })}`;
  }

  /** The type check and the keywords, each group of a type run on a value of that type, as the interpreter's `buildCheck` does. */
  #body(n: SchemaNode, s: Site): string {
    let code = "";
    const checked = n.typeCheck !== "none";
    if (checked) code += `if (!(${n.types.map((t) => typeTest(t, s.d)).join(" || ")})) ${s.fail}\n`;
    for (const group of GROUP_ORDER) {
      const keywords = n.keywords.filter((k) => k.group === group);
      if (!keywords.length) continue;
      if (group !== "any" && checked && !n.types.some((t) => GROUP_OF[t] === group)) continue;
      let part = "";
      for (const k of keywords) part += this.#keyword(k, s);
      if (!part) continue;
      if (group === "any" || (checked && n.types.every((t) => GROUP_OF[t] === group))) code += part;
      else code += `if (${GUARD[group](s.d)}) {\n${part}}\n`;
    }
    return code;
  }

  // ---- keywords --------------------------------------------------------------------------------

  #keyword(k: KeywordNode, s: Site): string {
    const d = s.d;
    const fail = s.fail;
    const value: any = k.value;
    switch (k.keyword) {
      case "$ref":
      case "$dynamicRef":
      case "$recursiveRef":
        return k.dynamic ? this.#dynamicRef(k, s) : this.#node(k.child!, s);
      case "const": {
        const plan = constPlan(value);
        if (plan.kind === "literal") return `if (${d} !== ${plan.text}) ${fail}\n`;
        const v = this.#use(`vl${this.#plan.valueOf.get(k)!}`);
        if (plan.kind === "equal") return `if (!${this.#use("eq")}(${d}, ${v})) ${fail}\n`;
        return `if (${d} !== ${v}) ${fail}\n`;
      }
      case "enum": {
        const plan = enumPlan(value);
        if (plan.kind === "never") return `${fail}\n`;
        if (plan.kind === "inline") return `if (!(${plan.values.map((v) => `${d} === ${lit(v)}`).join(" || ")})) ${fail}\n`;
        const at = this.#plan.valueOf.get(k)!;
        const primitives = plan.primitives.length ? `${this.#use(`vl${at}`)}.has(${d}) && ${d} === ${d}` : "false";
        if (!plan.objects.length) return `if (!(${primitives})) ${fail}\n`;
        this.#use("oe");
        const objects = `oe(${d}, ${this.#use(`vl${at + 1}`)})`;
        return `if (!(typeof ${d} != "object" || ${d} === null ? ${primitives} : ${objects})) ${fail}\n`;
      }
      case "not": {
        const label = this.#local("N");
        const inner = this.#node(k.child!, this.#plain(s, `break ${label};`));
        if (!inner) return `${fail}\n`;
        return `${label}: {\n${inner}${fail}\n}\n`;
      }
      case "allOf": {
        let code = "";
        for (const child of k.children!) if (!child.alwaysValid) code += this.#branch(child, s);
        return code;
      }
      case "anyOf":
        return this.#anyOf(k, s);
      case "oneOf":
        return this.#oneOf(k, s);
      case "if":
        return this.#ifThenElse(k, s);
      case "maximum":
        return `if (!(${d} <= ${lit(value)})) ${fail}\n`;
      case "minimum":
        return `if (!(${d} >= ${lit(value)})) ${fail}\n`;
      case "exclusiveMaximum":
        return `if (!(${d} < ${lit(value)})) ${fail}\n`;
      case "exclusiveMinimum":
        return `if (!(${d} > ${lit(value)})) ${fail}\n`;
      case "multipleOf":
        return `if (!${this.#use("mul")}(${d}, ${lit(value)})) ${fail}\n`;
      case "format":
        return `if (!${this.#use(`fm${this.#plan.formatOf.get(k.format!.name)!}`)}(${d})) ${fail}\n`;
      case "maxLength":
        return `if (!(${d}.length <= ${lit(value)} || ${this.#use("len")}(${d}) <= ${lit(value)})) ${fail}\n`;
      case "minLength":
        // A string of at least one code unit holds at least one code point.
        if (value <= 1) return `if (!(${d}.length >= ${lit(value)})) ${fail}\n`;
        return `if (!(${d}.length >= ${lit(value)} && ${this.#use("len")}(${d}) >= ${lit(value)})) ${fail}\n`;
      case "pattern":
        return `if (!${this.#use(`re${this.#plan.regexpOf.get(k.regexp!)!}`)}.test(${d})) ${fail}\n`;
      case "formatMaximum":
      case "formatMinimum":
      case "formatExclusiveMaximum":
      case "formatExclusiveMinimum": {
        const op = { formatMaximum: "> 0", formatMinimum: "< 0", formatExclusiveMaximum: ">= 0", formatExclusiveMinimum: "<= 0" }[k.keyword];
        return `if (${this.#use(`cm${this.#plan.compareOf.get(k.format!.name)!}`)}(${d}, ${lit(value)}) ${op}) ${fail}\n`;
      }
      case "maxItems":
        return `if (!(${d}.length <= ${lit(value)})) ${fail}\n`;
      case "minItems":
        return `if (!(${d}.length >= ${lit(value)})) ${fail}\n`;
      case "maxProperties":
      case "minProperties": {
        const count = this.#local("n");
        const key = this.#local("k");
        const op = k.keyword === "maxProperties" ? "<=" : ">=";
        return `let ${count} = 0;\nfor (const ${key} in ${d}) if (${this.#use("h")}.call(${d}, ${key})) ${count}++;\nif (!(${count} ${op} ${lit(value)})) ${fail}\n`;
      }
      case "prefixItems":
      case "items": {
        if (!k.children) return this.#rest(k, k.prefix ?? 0, k.prefix !== undefined, s);
        const n = k.children.length;
        let code = "";
        k.children.forEach((child, i) => {
          if (child.alwaysValid) return;
          const x = this.#local("x");
          code += `if (${d}.length > ${i}) {\nconst ${x} = ${d}[${i}];\n${this.#node(child, this.#part(s, x))}}\n`;
        });
        if (s.ev) code += `if (${s.ev}.items !== true && ${n} > ${s.ev}.items) ${s.ev}.items = ${n};\n`;
        if (n) this.#contribute(s, { kind: "items", n });
        return code;
      }
      case "additionalItems":
        return this.#rest(k, k.prefix!, true, s);
      case "contains":
        return this.#contains(k, s);
      case "uniqueItems":
        return `if (!${this.#use("uq")}(${d}, ${this.#use(`vl${this.#plan.valueOf.get(k)!}`)})) ${fail}\n`;
      case "required": {
        const h = this.#use("h");
        let code = "";
        for (const p of k.required as readonly string[]) code += `if (${d}[${lit(p)}] === undefined || !${h}.call(${d}, ${lit(p)})) ${fail}\n`;
        return code;
      }
      case "propertyNames": {
        if (k.child!.alwaysValid) return "";
        const key = this.#local("k");
        return `for (const ${key} in ${d}) {\nif (!${this.#use("h")}.call(${d}, ${key})) continue;\n${this.#node(k.child!, this.#part(s, key))}}\n`;
      }
      case "additionalProperties":
        return this.#additionalProperties(k, s);
      case "dependencies":
      case "dependentRequired":
      case "dependentSchemas":
        return this.#dependencies(k, s);
      case "properties":
        return this.#properties(k, s);
      case "patternProperties":
        return this.#patternProperties(k, s);
      case "unevaluatedProperties":
        return this.#unevaluatedProperties(k, s);
      case "unevaluatedItems":
        return this.#unevaluatedItems(k, s);
      case "discriminator":
        return this.#discriminator(k, s);
      case "errorMessage":
        // It changes errors, never a verdict.
        return "";
    }
    // A keyword the tree compiles and this file does not write would pass every value: refused, so a keyword added to the tree is added here too.
    throw new Error(`dotschema's code generator does not write the keyword ${k.keyword}`);
  }

  /** A schema applied to the same value whose evaluation counts for the schema above, or that is checked plainly where it evaluates nothing. */
  #branch(n: SchemaNode, s: Site, fail = s.fail): string {
    if (!this.#tracking(s) || !this.#touches(n)) return this.#node(n, this.#plain(s, fail));
    return this.#node(n, { ...s, fail });
  }

  #dynamicRef(k: KeywordNode, s: Site): string {
    const index = this.#plan.dynamics.indexOf(k);
    const tracking = s.ev !== null;
    const name = `${tracking ? "z" : "y"}${index}`;
    if (!this.#dynamicHelpers.has(name)) {
      this.#dynamicHelpers.set(name, "");
      const args = tracking ? "d, ev, sc" : "d, sc";
      const target = this.#plan.rootOf.get(k.child!)!;
      let cases = "";
      for (const [resource, root] of this.#plan.candidates.get(k)!) cases += `case ${resource}: return ${this.#fn(root, tracking)}(${args});\n`;
      const loop = cases ? `for (let i = 0; i < sc.length; i++) switch (sc[i]) {\n${cases}}\n` : "";
      this.#dynamicHelpers.set(name, `function ${name}(${args}) {\n${loop}return ${this.#fn(target, tracking)}(${args});\n}`);
    }
    return `if (!${name}(${s.d}${tracking ? `, ${s.ev}` : ""}, sc)) ${s.fail}\n`;
  }

  #anyOf(k: KeywordNode, s: Site): string {
    const children = k.children!;
    const touching = this.#tracking(s) && children.some((c) => this.#touches(c));
    if (!touching) {
      if (children.some((c) => c.alwaysValid)) return "";
      const outer = this.#local("A");
      let code = `${outer}: {\n`;
      for (const child of children) {
        const label = this.#local("B");
        code += `${label}: {\n${this.#node(child, this.#plain(s, `break ${label};`))}break ${outer};\n}\n`;
      }
      return `${code}${s.fail}\n}\n`;
    }
    if (s.ev) {
      this.#use("M");
      const ok = this.#local("a");
      let code = `let ${ok} = false;\n`;
      for (const child of children) {
        const label = this.#local("B");
        if (this.#touches(child)) {
          const t = this.#local("t");
          code += `const ${t} = ${NEW_EV};\n${label}: {\n${this.#node(child, { ...s, fail: `break ${label};`, ev: t })}${ok} = true;\nM(${s.ev}, ${t});\n}\n`;
        } else code += `${label}: {\n${this.#node(child, this.#plain(s, `break ${label};`))}${ok} = true;\n}\n`;
      }
      return `${code}if (!${ok}) ${s.fail}\n`;
    }
    const bits: string[] = [];
    let code = "";
    for (const child of children) {
      const b = this.#bit(s, "false");
      bits.push(b);
      const label = this.#local("B");
      code += `${label}: {\n${this.#branch(child, { ...s, guard: [...s.guard, b] }, `break ${label};`)}${b} = true;\n}\n`;
    }
    return `${code}if (!(${bits.join(" || ")})) ${s.fail}\n`;
  }

  #oneOf(k: KeywordNode, s: Site): string {
    const children = k.children!;
    const touching = this.#tracking(s) && children.some((c) => this.#touches(c));
    const count = this.#local("n");
    let code = `let ${count} = 0;\n`;
    for (const child of children) {
      const label = this.#local("B");
      const pass = `if (${count}) ${s.fail}\n${count} = 1;\n`;
      if (!touching || !this.#touches(child)) {
        code += `${label}: {\n${this.#node(child, this.#plain(s, `break ${label};`))}${pass}}\n`;
      } else if (s.ev) {
        this.#use("M");
        const t = this.#local("t");
        code += `const ${t} = ${NEW_EV};\n${label}: {\n${this.#node(child, { ...s, fail: `break ${label};`, ev: t })}${pass}M(${s.ev}, ${t});\n}\n`;
      } else {
        const b = this.#bit(s, "false");
        code += `${label}: {\n${this.#node(child, { ...s, fail: `break ${label};`, guard: [...s.guard, b] })}${pass}${b} = true;\n}\n`;
      }
    }
    return `${code}if (!${count}) ${s.fail}\n`;
  }

  #ifThenElse(k: KeywordNode, s: Site): string {
    const thenNode = k.then && !k.then.alwaysValid ? k.then : undefined;
    const elseNode = k.else && !k.else.alwaysValid ? k.else : undefined;
    const touching = this.#tracking(s) && [k.child!, ...(thenNode ? [thenNode] : []), ...(elseNode ? [elseNode] : [])].some((c) => this.#touches(c));
    const label = this.#local("I");
    if (!touching) {
      if (!thenNode && !elseNode) return "";
      const p = this.#local("p");
      let code = `let ${p} = false;\n${label}: {\n${this.#node(k.child!, this.#plain(s, `break ${label};`))}${p} = true;\n}\n`;
      if (thenNode) code += `if (${p}) {\n${this.#node(thenNode, this.#plain(s))}}\n`;
      if (elseNode) code += `${thenNode ? "else" : `if (!${p})`} {\n${this.#node(elseNode, this.#plain(s))}}\n`;
      return code;
    }
    if (s.ev) {
      this.#use("M");
      const p = this.#local("p");
      const t = this.#local("t");
      let code = `const ${t} = ${NEW_EV};\nlet ${p} = false;\n${label}: {\n${this.#node(k.child!, { ...s, fail: `break ${label};`, ev: t })}${p} = true;\nM(${s.ev}, ${t});\n}\n`;
      const clause = (node: SchemaNode) => {
        const u = this.#local("t");
        return `const ${u} = ${NEW_EV};\n${this.#node(node, { ...s, ev: u })}M(${s.ev}, ${u});\n`;
      };
      if (thenNode) code += `if (${p}) {\n${clause(thenNode)}}\n`;
      if (elseNode) code += `${thenNode ? "else" : `if (!${p})`} {\n${clause(elseNode)}}\n`;
      return code;
    }
    const p = this.#bit(s, "false");
    let code = `${label}: {\n${this.#branch(k.child!, { ...s, guard: [...s.guard, p] }, `break ${label};`)}${p} = true;\n}\n`;
    if (thenNode) code += `if (${p}) {\n${this.#branch(thenNode, { ...s, guard: [...s.guard, p] })}}\n`;
    if (elseNode) code += `${thenNode ? "else" : `if (!${p})`} {\n${this.#branch(elseNode, { ...s, guard: [...s.guard, `!${p}`] })}}\n`;
    return code;
  }

  /** The items after a tuple of `prefix` (`additionalItems`, 2020-12's `items` beside `prefixItems`), or every item (`items` alone). */
  #rest(k: KeywordNode, prefix: number, tuple: boolean, s: Site): string {
    const child = k.child!;
    const d = s.d;
    let code = "";
    if (tuple && child.schema === false) code = `if (${d}.length > ${prefix}) ${s.fail}\n`;
    else if (!child.alwaysValid) {
      const i = this.#local("i");
      const x = this.#local("x");
      code = `for (let ${i} = ${prefix}; ${i} < ${d}.length; ${i}++) {\nconst ${x} = ${d}[${i}];\n${this.#node(child, this.#part(s, x))}}\n`;
    }
    if (s.ev) code += `${s.ev}.items = true;\n`;
    this.#contribute(s, { kind: "itemsAll" });
    return code;
  }

  #contains(k: KeywordNode, s: Site): string {
    const min = k.min!;
    const max = k.max;
    const child = k.child!;
    const d = s.d;
    const marks = this.#marks && this.#tracking(s);
    const ev = s.ev;
    const mark = () => {
      if (child.alwaysValid) {
        this.#contribute(s, { kind: "itemsAll" });
        return ev ? `${ev}.items = true;\n` : "";
      }
      this.#contribute(s, { kind: "contains", node: child });
      if (!ev) return "";
      const i = this.#local("i");
      const x = this.#local("x");
      const label = this.#local("C");
      return `for (let ${i} = 0; ${i} < ${d}.length; ${i}++) {\nconst ${x} = ${d}[${i}];\n${label}: {\n${this.#node(child, this.#part(s, x, `break ${label};`))}(${ev}.idx || (${ev}.idx = new Set())).add(${i});\n}\n}\n`;
    };
    if (max === undefined && min === 0) return marks ? mark() : "";
    if (max !== undefined && min > max) return `${s.fail}\n`;
    const within = (n: string) => `${n} >= ${lit(min)}${max === undefined ? "" : ` && ${n} <= ${lit(max)}`}`;
    if (child.alwaysValid) {
      const code = `if (!(${within(`${d}.length`)})) ${s.fail}\n`;
      return marks ? code + mark() : code;
    }
    const count = this.#local("n");
    const i = this.#local("i");
    const x = this.#local("x");
    const label = this.#local("C");
    const loop = this.#local("F");
    const tracked = marks && ev !== null;
    let step: string;
    if (tracked) step = `(${ev}.idx || (${ev}.idx = new Set())).add(${i});\n`;
    else if (max === undefined) step = `if (${count} >= ${lit(min)}) break ${loop};\n`;
    else step = `if (${count} > ${lit(max)}) ${s.fail}\n`;
    const code = `let ${count} = 0;\n${loop}: for (let ${i} = 0; ${i} < ${d}.length; ${i}++) {\nconst ${x} = ${d}[${i}];\n${label}: {\n${this.#node(child, this.#part(s, x, `break ${label};`))}${count}++;\n${step}}\n}\nif (!(${within(count)})) ${s.fail}\n`;
    if (marks && !ev) this.#contribute(s, { kind: "contains", node: child });
    return code;
  }

  /** A test that a key is one of `names`, as statements that `continue` the loop where it is and `extra` holds. */
  #skipNames(key: string, names: readonly string[], extra: string, guard: string): string {
    if (!names.length) return "";
    const when = guard ? `${guard} && ` : "";
    if (names.length <= 4) return `if (${when}(${names.map((name) => `${key} === ${lit(name)}`).join(" || ")})${extra}) continue;\n`;
    const body = `switch (${key}) {\n${names.map((name) => `case ${lit(name)}:`).join("\n")}\n${extra ? `if (${extra.slice(4)}) continue;` : "continue;"}\n}\n`;
    return guard ? `if (${guard}) {\n${body}}\n` : body;
  }

  #additionalProperties(k: KeywordNode, s: Site): string {
    const child = k.child!;
    const d = s.d;
    let code = "";
    if (s.ev) code += `${s.ev}.props = true;\n`;
    this.#contribute(s, { kind: "propsAll" });
    if (child.alwaysValid) return code;
    const h = this.#use("h");
    const key = this.#local("k");
    code += `for (const ${key} in ${d}) {\nif (!${h}.call(${d}, ${key})) continue;\n`;
    code += this.#skipNames(key, [...k.known!], "", "");
    const regexps = k.regexps!.map((re) => this.#use(`re${this.#plan.regexpOf.get(re)!}`));
    if (regexps.length) code += `if (${regexps.map((re) => `${re}.test(${key})`).join(" || ")}) continue;\n`;
    if (child.schema === false) code += `${s.fail}\n`;
    else {
      const x = this.#local("x");
      code += `const ${x} = ${d}[${key}];\n${this.#node(child, this.#part(s, x))}`;
    }
    return `${code}}\n`;
  }

  #present(d: string, p: string): string {
    return `${d}[${lit(p)}] !== undefined && ${this.#use("h")}.call(${d}, ${lit(p)})`;
  }

  #dependencies(k: KeywordNode, s: Site): string {
    const d = s.d;
    let code = "";
    for (const [p, list] of (k.required ?? []) as readonly (readonly [string, readonly string[]])[]) {
      if (!list.length) continue;
      code += `if (${this.#present(d, p)}) {\n${list.map((r) => `if (!(${this.#present(d, r)})) ${s.fail}\n`).join("")}}\n`;
    }
    for (const [p, node] of k.entries!) {
      if (node.alwaysValid) continue;
      if (!this.#tracking(s) || !this.#touches(node)) code += `if (${this.#present(d, p)}) {\n${this.#node(node, this.#plain(s))}}\n`;
      else if (s.ev) {
        this.#use("M");
        const t = this.#local("t");
        code += `if (${this.#present(d, p)}) {\nconst ${t} = ${NEW_EV};\n${this.#node(node, { ...s, ev: t })}M(${s.ev}, ${t});\n}\n`;
      } else {
        const b = this.#bit(s, "false");
        code += `${b} = ${this.#present(d, p)};\nif (${b}) {\n${this.#node(node, { ...s, guard: [...s.guard, b] })}}\n`;
      }
    }
    return code;
  }

  #properties(k: KeywordNode, s: Site): string {
    const d = s.d;
    let code = "";
    for (const [key, child] of k.entries!) {
      this.#contribute(s, { kind: "name", name: key });
      if (child.alwaysValid && !s.ev) continue;
      const x = this.#local("x");
      code += `const ${x} = ${d}[${lit(key)}];\nif (${x} !== undefined && ${this.#use("h")}.call(${d}, ${lit(key)})) {\n`;
      if (s.ev) {
        this.#use("R");
        code += `R(${s.ev}, ${lit(key)});\n`;
      }
      if (!child.alwaysValid) code += this.#node(child, this.#part(s, x));
      code += "}\n";
    }
    return code;
  }

  #patternProperties(k: KeywordNode, s: Site): string {
    const d = s.d;
    const entries = k.entries!;
    const key = this.#local("k");
    let inner = "";
    entries.forEach(([, child], i) => {
      const index = this.#plan.regexpOf.get(k.regexps![i]!)!;
      this.#contribute(s, { kind: "pattern", re: index });
      if (child.alwaysValid && !s.ev) return;
      let body = "";
      if (s.ev) {
        this.#use("R");
        body += `R(${s.ev}, ${key});\n`;
      }
      if (!child.alwaysValid) {
        const x = this.#local("x");
        body += `const ${x} = ${d}[${key}];\n${this.#node(child, this.#part(s, x))}`;
      }
      inner += `if (${this.#use(`re${index}`)}.test(${key})) {\n${body}}\n`;
    });
    if (!inner) return "";
    return `for (const ${key} in ${d}) {\nif (!${this.#use("h")}.call(${d}, ${key})) continue;\n${inner}}\n`;
  }

  #unevaluatedProperties(k: KeywordNode, s: Site): string {
    const child = k.child!;
    const d = s.d;
    const no = child.schema === false;
    const active = no || !child.alwaysValid;
    const h = this.#use("h");
    const check = (key: string) => {
      if (no) return `${s.fail}\n`;
      const x = this.#local("x");
      return `const ${x} = ${d}[${key}];\n${this.#node(child, this.#part(s, x))}`;
    };
    if (s.ev) {
      let code = "";
      if (active) {
        const q = this.#local("q");
        const key = this.#local("k");
        code += `const ${q} = ${s.ev}.props;\nif (${q} !== true) for (const ${key} in ${d}) {\nif (!${h}.call(${d}, ${key}) || (${q} && ${q}.has(${key}))) continue;\n${check(key)}}\n`;
      }
      return `${code}${s.ev}.props = true;\n`;
    }
    const ctx = s.stack[s.stack.length - 1]!;
    let code = "";
    if (active) {
      const terms = ctx.terms;
      const guardOf = (t: Term) => t.guard.join(" && ");
      const all = terms.filter((t) => t.kind === "propsAll");
      if (!all.some((t) => !t.guard.length)) {
        const key = this.#local("k");
        let loop = `for (const ${key} in ${d}) {\nif (!${h}.call(${d}, ${key})) continue;\n`;
        const names = new Map<string, Set<string>>();
        const patterns = new Map<string, Set<number>>();
        for (const t of terms) {
          if (t.kind === "name") {
            const g = guardOf(t);
            if (!names.has(g)) names.set(g, new Set());
            names.get(g)!.add(t.name);
          } else if (t.kind === "pattern") {
            const g = guardOf(t);
            if (!patterns.has(g)) patterns.set(g, new Set());
            patterns.get(g)!.add(t.re);
          }
        }
        for (const [g, set] of names) loop += this.#skipNames(key, [...set], ` && ${d}[${key}] !== undefined`, g);
        for (const [g, set] of patterns) loop += `if (${g ? `${g} && ` : ""}(${[...set].map((i) => `${this.#use(`re${i}`)}.test(${key})`).join(" || ")})) continue;\n`;
        loop += `${check(key)}}\n`;
        code += all.length ? `if (!(${all.map((t) => `(${guardOf(t)})`).join(" || ")})) {\n${loop}}\n` : loop;
      }
    }
    this.#contribute(s, { kind: "propsAll" });
    return code;
  }

  #unevaluatedItems(k: KeywordNode, s: Site): string {
    const child = k.child!;
    const d = s.d;
    const no = child.schema === false;
    const active = no || !child.alwaysValid;
    const check = (x: string) => (no ? `${s.fail}\n` : this.#node(child, this.#part(s, x)));
    if (s.ev) {
      let code = "";
      if (active) {
        const q = this.#local("q");
        const ix = this.#local("j");
        const i = this.#local("i");
        const x = this.#local("x");
        code += `const ${q} = ${s.ev}.items;\nif (${q} !== true) {\nconst ${ix} = ${s.ev}.idx;\nfor (let ${i} = ${q}; ${i} < ${d}.length; ${i}++) {\nif (${ix} && ${ix}.has(${i})) continue;\nconst ${x} = ${d}[${i}];\n${check(x)}}\n}\n`;
      }
      return `${code}${s.ev}.items = true;\n`;
    }
    const ctx = s.stack[s.stack.length - 1]!;
    let code = "";
    if (active) {
      const terms = ctx.terms;
      const guardOf = (t: Term) => t.guard.join(" && ");
      const all = terms.filter((t) => t.kind === "itemsAll");
      if (!all.some((t) => !t.guard.length)) {
        let start = 0;
        const guarded: [string, number][] = [];
        for (const t of terms)
          if (t.kind === "items") {
            if (!t.guard.length) start = Math.max(start, t.n);
            else guarded.push([guardOf(t), t.n]);
          }
        const i = this.#local("i");
        const x = this.#local("x");
        let from = String(start);
        let pre = "";
        if (guarded.length) {
          from = this.#local("s");
          pre = `let ${from} = ${start};\n${guarded.map(([g, n]) => `if (${g} && ${n} > ${from}) ${from} = ${n};\n`).join("")}`;
        }
        let loop = `${pre}for (let ${i} = ${from}; ${i} < ${d}.length; ${i}++) {\nconst ${x} = ${d}[${i}];\n`;
        for (const t of terms) {
          if (t.kind !== "contains") continue;
          const label = this.#local("C");
          const test = `${label}: {\n${this.#node(t.node, this.#part(s, x, `break ${label};`))}continue;\n}\n`;
          loop += t.guard.length ? `if (${guardOf(t)}) {\n${test}}\n` : test;
        }
        loop += `${check(x)}}\n`;
        code += all.length ? `if (!(${all.map((t) => `(${guardOf(t)})`).join(" || ")})) {\n${loop}}\n` : loop;
      }
    }
    this.#contribute(s, { kind: "itemsAll" });
    return code;
  }

  #discriminator(k: KeywordNode, s: Site): string {
    const d = s.d;
    const tag = this.#local("g");
    const label = this.#local("S");
    const byVariant = new Map<number, string[]>();
    for (const [name, i] of k.mapping!) {
      if (!byVariant.has(i)) byVariant.set(i, []);
      byVariant.get(i)!.push(name);
    }
    const children = k.children!;
    const touching = this.#tracking(s) && children.some((c) => this.#touches(c));
    const which = touching && !s.ev ? this.#bit(s, "-1") : undefined;
    let code = `const ${tag} = ${d}[${lit(k.tagName!)}];\nif (typeof ${tag} !== "string") ${s.fail}\n${label}: switch (${tag}) {\n`;
    for (const [i, names] of [...byVariant].sort((a, b) => a[0] - b[0])) {
      const child = children[i]!;
      let body: string;
      if (!touching) body = this.#node(child, this.#plain(s));
      else if (s.ev) body = this.#branch(child, s);
      else body = `${this.#branch(child, { ...s, guard: [...s.guard, `${which} === ${i}`] })}${which} = ${i};\n`;
      code += `${names.map((name) => `case ${lit(name)}:`).join("\n")} {\n${body}break ${label};\n}\n`;
    }
    return `${code}default: ${s.fail}\n}\n`;
  }
}

/** The source of the pass/fail check of a validator's schema. */
export function generate(validator: Validator): Generated {
  return { source: new Generator(planOf(validator), validator.draft === "2020-12").source() };
}

let allowed: boolean | undefined;

/** Whether this realm builds code from a string, probed once. */
function codeFromStrings(): boolean {
  if (allowed === undefined) {
    try {
      new Function("");
      allowed = true;
    } catch {
      allowed = false;
    }
  }
  return allowed;
}

const jitted = new WeakMap<Validator, (value: unknown) => boolean>();

/** `generate` + `new Function` + `link`; undefined where the runtime refuses `new Function` (a probe, `try { new Function("") }`, cached once per realm). The check is made once for each validator. */
export function jit(validator: Validator): ((value: unknown) => boolean) | undefined {
  if (!codeFromStrings()) return undefined;
  let check = jitted.get(validator);
  if (!check) {
    const plan = planOf(validator);
    const source = new Generator(plan, validator.draft === "2020-12").source();
    const factory = new Function(`return ${source}`)() as (r: any) => (value: unknown) => boolean;
    check = factory(tablesOf(plan));
    jitted.set(validator, check);
  }
  return check;
}

