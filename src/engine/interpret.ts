// The interpreter: each node of the tree (tree.ts) as two closures, made once, the first time a
// validator needs them. `check` returns at the first failure and makes no error object, as
// dotschema's `.is()` does; `collect` reports every error, as ajv with `allErrors` reports them, in its
// order, with its `instancePath`, `schemaPath`, `keyword`, `params`, `message` and `propertyName`, and
// ajv-errors' `errorMessage` applied, as dotschema's `.validate()` does.
//
// What a schema evaluated, which `unevaluatedProperties` and `unevaluatedItems` read, is an `Ev`
// passed down to the keywords that apply in place (2019-09 core 9.3; 2020-12 core 11): a node with
// either keyword keeps its own and passes the result up when done; every other node writes into its
// caller's. A keyword merges what a subschema evaluated as ajv 8.20.0 does, as dotschema patches it:
// `allOf` and a `$ref` always, `anyOf`, `oneOf`, `if`, `then`, `else`, `dependentSchemas` and a
// schema of `dependencies` only where the subschema passed. 2020-12's `contains` marks the items it
// matched (core 11.2), 2019-09's none. With no keyword to read it, nothing is kept.
//
// The dynamic scope, which a `$dynamicRef` or `$recursiveRef` that resolves dynamically reads, is the
// stack of schema resources the evaluation has entered, kept only where some reference needs it.
import { equal, ucs2length } from "./equal.ts";
import type { Resource } from "./resources.ts";
import type { DataPointer, Group, JsonType, KeywordNode, MessageConfig, SchemaNode, Template } from "./tree.ts";
import { escapePointer } from "./uri.ts";

/** An error, as ajv makes one. */
export interface EngineError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message: string;
  /** The key whose name failed, on an error inside `propertyNames`. */
  propertyName?: string;
  /** Set by `errorMessage` on each error a message replaced, which is then in that message's `params.errors`. */
  emUsed?: true;
}

/** What a schema evaluated: every property (`true`) or these, and every item, the first `items`, and in 2020-12 those `contains` matched. */
export interface Ev {
  props: true | Set<string> | undefined;
  items: true | number;
  idx: Set<number> | undefined;
}

const newEv = (): Ev => ({ props: undefined, items: 0, idx: undefined });

export function merge(to: Ev, from: Ev): void {
  if (to.props !== true) {
    if (from.props === true) to.props = true;
    else if (from.props) {
      if (!to.props) to.props = new Set(from.props);
      else for (const key of from.props) to.props.add(key);
    }
  }
  if (to.items !== true) {
    if (from.items === true) to.items = true;
    else if (from.items > to.items) to.items = from.items;
  }
  if (from.idx) {
    if (!to.idx) to.idx = new Set(from.idx);
    else for (const i of from.idx) to.idx.add(i);
  }
}

export const record = (ev: Ev, key: string): void => {
  const props = ev.props;
  if (props === undefined) ev.props = new Set([key]);
  else if (props !== true) props.add(key);
};

/** What a check carries through a call: the dynamic scope, where one is kept. */
export interface Dyn {
  scope: Resource[];
}

/** What `collect` carries: the errors so far, where in the value it is, and the values above it for `errorMessage`'s templates. */
export interface State extends Dyn {
  errors: EngineError[];
  path: (string | number)[];
  data: unknown[];
  keys: unknown[];
  /** Where in `errors` the current function's begin, from which `errorMessage` reads. */
  base: number;
  propName: string | undefined;
  root: unknown;
}

export type Check = (data: any, ev: Ev | undefined, st: Dyn | undefined) => boolean;
export type Collect = (data: any, st: State, ev: Ev | undefined) => boolean;
type Step = (data: any, st: State, ev: Ev | undefined) => void;

const TRUE: Check = () => true;
const FALSE: Check = () => false;
const OK: Collect = () => true;

const hasOwn = Object.prototype.hasOwnProperty;
const present = (d: any, key: string): boolean => d[key] !== undefined && hasOwn.call(d, key);

export function isType(t: JsonType, d: any): boolean {
  switch (t) {
    case "null":
      return d === null;
    case "array":
      return Array.isArray(d);
    case "object":
      return d !== null && typeof d == "object" && !Array.isArray(d);
    case "integer":
      // ajv's test, which takes Infinity for an integer (Infinity % 1 is NaN).
      return typeof d == "number" && !(d % 1) && !isNaN(d);
    case "number":
      return typeof d == "number";
    default:
      return typeof d == t;
  }
}

function typesTest(types: readonly JsonType[]): (d: any) => boolean {
  if (types.length === 1) {
    const t = types[0]!;
    switch (t) {
      case "object":
        return (d) => d !== null && typeof d == "object" && !Array.isArray(d);
      case "string":
        return (d) => typeof d == "string";
      case "number":
        return (d) => typeof d == "number";
      case "array":
        return Array.isArray;
      default:
        return (d) => isType(t, d);
    }
  }
  return (d) => {
    for (let i = 0; i < types.length; i++) if (isType(types[i]!, d)) return true;
    return false;
  };
}

const GROUP_OF: Record<JsonType, Group | undefined> = { number: "number", integer: "number", string: "string", array: "array", object: "object", boolean: undefined, null: undefined };

const GUARDS: Record<"number" | "string" | "array" | "object", (d: any) => boolean> = {
  number: (d) => typeof d == "number",
  string: (d) => typeof d == "string",
  array: Array.isArray,
  object: (d) => d !== null && typeof d == "object" && !Array.isArray(d),
};

const GROUP_ORDER: readonly Group[] = ["any", "number", "string", "array", "object", "post"];

function seq(fns: Check[]): Check {
  const list = fns.filter((f) => f !== TRUE);
  if (list.some((f) => f === FALSE)) return FALSE;
  const n = list.length;
  if (n === 0) return TRUE;
  if (n === 1) return list[0]!;
  if (n === 2) {
    const [a, b] = list as [Check, Check];
    return (d, ev, st) => a(d, ev, st) && b(d, ev, st);
  }
  if (n === 3) {
    const [a, b, c] = list as [Check, Check, Check];
    return (d, ev, st) => a(d, ev, st) && b(d, ev, st) && c(d, ev, st);
  }
  return (d, ev, st) => {
    for (let i = 0; i < n; i++) if (!list[i]!(d, ev, st)) return false;
    return true;
  };
}

function steps(fns: Step[]): Step | undefined {
  const n = fns.length;
  if (n === 0) return undefined;
  if (n === 1) return fns[0]!;
  return (d, st, ev) => {
    for (let i = 0; i < n; i++) fns[i]!(d, st, ev);
  };
}

/** An instance path as a JSON Pointer. */
const pointer = (path: readonly (string | number)[]): string => {
  let out = "";
  for (let i = 0; i < path.length; i++) out += "/" + escapePointer(path[i]!);
  return out;
};

/** ajv's limit keywords: what each compares and how its message reads. */
const LIMITS: Record<string, { ok: (a: number, b: number) => boolean; op: string }> = {
  maximum: { ok: (a, b) => a <= b, op: "<=" },
  minimum: { ok: (a, b) => a >= b, op: ">=" },
  exclusiveMaximum: { ok: (a, b) => a < b, op: "<" },
  exclusiveMinimum: { ok: (a, b) => a > b, op: ">" },
};

const FORMAT_LIMITS: Record<string, { fails: (c: number) => boolean; op: string }> = {
  formatMaximum: { fails: (c) => c > 0, op: "<=" },
  formatMinimum: { fails: (c) => c < 0, op: ">=" },
  formatExclusiveMaximum: { fails: (c) => c >= 0, op: "<" },
  formatExclusiveMinimum: { fails: (c) => c <= 0, op: ">" },
};

/** `multipleOf` with dotschema's `multipleOfPrecision: 7`, an infinite quotient decided by the remainder (DESIGN.md, "The validator"). */
export const multipleOf = (d: number, m: number): boolean => {
  if (m === 0) return false;
  const q = d / m;
  return isFinite(q) ? !(Math.abs(Math.round(q) - q) > 1e-7) : d % m === 0;
};

/** ajv's `uniqueItems`: the first two equal items found from the end, `[i, j]` as its error names them, or undefined. */
export function duplicate(d: any[], itemTypes: readonly JsonType[]): [number, number] | undefined {
  let i = d.length;
  if (i <= 1) return undefined;
  if (itemTypes.length && !itemTypes.some((t) => t === "object" || t === "array")) {
    const several = itemTypes.length > 1;
    const indices: Record<string, number> = {};
    for (; i--; ) {
      let item: any = d[i];
      let typed = false;
      for (const t of itemTypes) if (isType(t, item)) typed = true;
      if (!typed) continue;
      if (several && typeof item == "string") item += "_";
      const seen = indices[item];
      if (typeof seen == "number") return [i, seen];
      indices[item] = i;
    }
    return undefined;
  }
  for (; i--; ) for (let j = i; j--; ) if (equal(d[i], d[j])) return [i, j];
  return undefined;
}

function containsMessage(min: number, max: number | undefined): { params: Record<string, unknown>; message: string } {
  return max === undefined ? { params: { minContains: min }, message: `must contain at least ${min} valid item(s)` } : { params: { minContains: min, maxContains: max }, message: `must contain at least ${min} and no more than ${max} valid item(s)` };
}

const KEYWORD_PROPERTY_PARAMS: Record<string, string> = { required: "missingProperty", dependencies: "property", dependentRequired: "property" };

/** A template's value: the data a pointer reads, `&&` all the way as ajv's `getData` writes it, so a falsy value on the way is the result. */
function dataAt(p: DataPointer, st: State): unknown {
  let v: any = p.up === "root" ? st.root : p.key ? st.keys[st.keys.length - 1 - p.up] : st.data[st.data.length - 1 - p.up];
  for (const segment of p.segments) {
    if (!v) return v;
    v = v[segment];
  }
  return v;
}

const render = (template: Template, st: State): string => {
  let out = "";
  for (const part of template) out += typeof part === "string" ? part : String(JSON.stringify(dataAt(part, st)));
  return out;
};

/**
 * ajv-errors 3.0.0's `errorMessage` (src/keywords/error-message.cjs), applied to the errors of the
 * current function since its start, as its code reads them: keyword messages for errors one keyword
 * below this schema at this value, property messages for those keywords' properties, child messages
 * for errors under a property or an item, then the message for every other error at or below it;
 * each error a message takes is marked `emUsed`, kept in the message's `params.errors`, and dropped.
 */
function applyMessages(config: MessageConfig, node: SchemaNode, path: string, d: any, st: State): void {
  const errors = st.errors;
  const base = st.base;
  if (errors.length <= base) return;
  const ip = pointer(st.path);
  const at = node.path;
  const report = (template: Template, list: EngineError[], instancePath = ip) => {
    const error: EngineError = { instancePath, schemaPath: path, keyword: "errorMessage", params: { errors: list }, message: render(template, st) };
    if (node.propertyName) error.propertyName = st.propName!;
    errors.push(error);
  };
  const keywordOf = (e: EngineError) => e.keyword !== "errorMessage" && !e.emUsed && e.instancePath === ip && e.schemaPath.indexOf(at) === 0 && /^\/[^/]*$/.test(e.schemaPath.slice(at.length));
  if (config.keywords) {
    const lists = new Map<string, EngineError[]>(config.keywords.map(([keyword]) => [keyword, []]));
    for (let i = base; i < errors.length; i++) {
      const e = errors[i]!;
      const list = keywordOf(e) ? lists.get(e.keyword) : undefined;
      if (list) {
        list.push(e);
        e.emUsed = true;
      }
    }
    for (const [keyword, template] of config.keywords) {
      const list = lists.get(keyword)!;
      if (list.length) report(template, list);
    }
  }
  if (config.keywordProps) {
    const lists = new Map(config.keywordProps.map(([keyword, props]) => [keyword, new Map<string, EngineError[]>(props.map(([p]) => [p, []]))]));
    for (let i = base; i < errors.length; i++) {
      const e = errors[i]!;
      if (!keywordOf(e)) continue;
      const props = lists.get(e.keyword);
      // ajv-errors indexes by the param its table names, `undefined` for a keyword it lists none for, as JavaScript reads it.
      const list = props?.get(String(e.params[String(KEYWORD_PROPERTY_PARAMS[e.keyword])]));
      if (list) {
        list.push(e);
        e.emUsed = true;
      }
    }
    for (const [keyword, props] of config.keywordProps)
      for (const [p, template] of props) {
        const list = lists.get(keyword)!.get(p)!;
        if (list.length) report(template, list);
      }
  }
  if (config.properties || config.items) {
    let entries: readonly (readonly [string, Template])[] | undefined;
    if (config.properties && config.items) {
      if (typeof d == "object") entries = Array.isArray(d) ? config.items.map((t, i) => [String(i), t] as const) : config.properties;
    } else if (config.items) {
      if (Array.isArray(d)) entries = config.items.map((t, i) => [String(i), t] as const);
    } else if (typeof d == "object" && !Array.isArray(d)) entries = config.properties;
    if (entries) {
      const lists = new Map<string, EngineError[]>(entries.map(([key]) => [key, []]));
      for (let i = base; i < errors.length; i++) {
        const e = errors[i]!;
        if (e.keyword === "errorMessage" || e.emUsed || e.instancePath.indexOf(ip) !== 0) continue;
        const match = /^\/([^/]*)(?:\/|$)/.exec(e.instancePath.slice(ip.length));
        const child = match ? match[1]!.replace(/~1/g, "/").replace(/~0/g, "~") : "null";
        const list = lists.get(child);
        if (list) {
          list.push(e);
          e.emUsed = true;
        }
      }
      for (const [key, template] of entries) {
        const list = lists.get(key)!;
        if (list.length) report(template, list, `${ip}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      }
    }
  }
  if (config.all) {
    const list: EngineError[] = [];
    for (let i = base; i < errors.length; i++) {
      const e = errors[i]!;
      if (e.keyword !== "errorMessage" && !e.emUsed && (e.instancePath === ip || (e.instancePath.indexOf(ip) === 0 && e.instancePath[ip.length] === "/")) && e.schemaPath.indexOf(at) === 0 && e.schemaPath[at.length] === "/") {
        list.push(e);
        e.emUsed = true;
      }
    }
    if (list.length) report(config.all, list);
  }
  let w = base;
  for (let i = base; i < errors.length; i++) {
    const e = errors[i]!;
    if (!e.emUsed) errors[w++] = e;
  }
  errors.length = w;
}

export interface InterpreterOptions {
  /** Whether some reference resolves in the dynamic scope, so the scope is kept. */
  readonly dynamic: boolean;
  /** Whether `contains` marks the items it matches evaluated (2020-12). */
  readonly containsEvaluates: boolean;
  /** Whether some `errorMessage` reads the value through a template, so `collect` keeps the values above it. */
  readonly templates: boolean;
}

export class Interpreter {
  private readonly checks = new Map<SchemaNode, Check>();
  private readonly collects = new Map<SchemaNode, Collect>();
  readonly options: InterpreterOptions;

  constructor(options: InterpreterOptions) {
    this.options = options;
  }

  /** The node as a check that stops at the first failure. */
  check(node: SchemaNode): Check {
    const known = this.checks.get(node);
    if (known) return known;
    if (!node.root) return this.buildCheck(node);
    let impl: Check | undefined;
    const trampoline: Check = (d, ev, st) => impl!(d, ev, st);
    this.checks.set(node, trampoline);
    impl = this.buildCheck(node);
    this.checks.set(node, impl);
    return impl;
  }

  /** The node as a check that reports every error. */
  collect(node: SchemaNode): Collect {
    const known = this.collects.get(node);
    if (known) return known;
    if (!node.root) return this.buildCollect(node);
    let impl: Collect | undefined;
    const trampoline: Collect = (d, st, ev) => impl!(d, st, ev);
    this.collects.set(node, trampoline);
    impl = this.buildCollect(node);
    this.collects.set(node, impl);
    return impl;
  }

  /** The closure of the schema a resource in the dynamic scope gives a dynamic reference, made the first time that resource is asked, or undefined where it declares no such anchor. */
  private candidates<F>(dynamic: NonNullable<KeywordNode["dynamic"]>, make: (node: SchemaNode) => F): (resource: Resource) => F | undefined {
    const made = new Map<Resource, F | null>();
    return (resource) => {
      let fn = made.get(resource);
      if (fn === undefined) {
        const node = dynamic.candidate(resource);
        made.set(resource, (fn = node ? make(node) : null));
      }
      return fn ?? undefined;
    };
  }

  private withScope<F extends (...args: any[]) => boolean>(node: SchemaNode, fn: F, stAt: 1 | 2): F {
    if (!this.options.dynamic) return fn;
    const resource = node.resource;
    return ((...args: any[]) => {
      const scope = (args[stAt] as Dyn).scope;
      if (scope[scope.length - 1] === resource) return fn(...args);
      scope.push(resource);
      const ok = fn(...args);
      scope.pop();
      return ok;
    }) as F;
  }

  // ---- check ----------------------------------------------------------------------------------

  private buildCheck(node: SchemaNode): Check {
    if (node.schema === true) return TRUE;
    if (node.schema === false) return FALSE;
    const fns: Check[] = [];
    const types = node.types;
    if (node.typeCheck !== "none") {
      const test = typesTest(types);
      fns.push((d) => test(d));
    }
    const checked = node.typeCheck !== "none";
    for (const group of GROUP_ORDER) {
      if (group === "post") continue;
      const keywords = node.keywords.filter((k) => k.group === group);
      if (!keywords.length) continue;
      const body = seq(keywords.map((k) => this.checkKeyword(k, node)));
      if (body === TRUE) continue;
      if (group === "any") {
        fns.push(body);
        continue;
      }
      // After the type check, a group no type of the schema's can be skips, and one every type is runs unguarded.
      if (checked && !types.some((t) => GROUP_OF[t] === group)) continue;
      if (checked && types.every((t) => GROUP_OF[t] === group)) fns.push(body);
      else {
        const guard = GUARDS[group];
        fns.push((d, ev, st) => !guard(d) || body(d, ev, st));
      }
    }
    let fn = seq(fns);
    if (node.unevaluated && fn !== TRUE && fn !== FALSE) {
      const inner = fn;
      fn = (d, ev, st) => {
        const own = newEv();
        const ok = inner(d, own, st);
        if (ev) merge(ev, own);
        return ok;
      };
    }
    return this.withScope(node, fn, 2);
  }

  private checkKeyword(k: KeywordNode, node: SchemaNode): Check {
    const value: any = k.value;
    switch (k.keyword) {
      case "$ref":
      case "$dynamicRef":
      case "$recursiveRef": {
        const target = this.check(k.child!);
        if (!k.dynamic) return target;
        const candidate = this.candidates(k.dynamic, (n) => this.check(n));
        return (d, ev, st) => {
          const scope = st!.scope;
          for (let i = 0; i < scope.length; i++) {
            const c = candidate(scope[i]!);
            if (c) return c(d, ev, st);
          }
          return target(d, ev, st);
        };
      }
      case "const":
        if (value && typeof value == "object") return (d) => equal(d, value);
        return (d) => d === value;
      case "enum": {
        if (!value.length) return FALSE;
        const objects = value.filter((v: unknown) => typeof v == "object" && v !== null);
        const primitives = value.filter((v: unknown) => !(typeof v == "object" && v !== null));
        if (!objects.length && primitives.length <= 4) return (d) => primitives.includes(d) && d === d;
        const set = new Set(primitives);
        return (d) => {
          if (typeof d != "object" || d === null) return set.has(d) && d === d;
          for (const v of objects) if (equal(d, v)) return true;
          return false;
        };
      }
      case "not": {
        const c = this.check(k.child!);
        return (d, _ev, st) => !c(d, undefined, st);
      }
      case "allOf":
        return seq(k.children!.filter((c) => !c.alwaysValid).map((c) => this.check(c)));
      case "anyOf": {
        const cs = k.children!.map((c) => this.check(c));
        return (d, ev, st) => {
          if (!ev) {
            for (let i = 0; i < cs.length; i++) if (cs[i]!(d, undefined, st)) return true;
            return false;
          }
          let ok = false;
          for (const c of cs) {
            const t = newEv();
            if (c(d, t, st)) {
              ok = true;
              merge(ev, t);
            }
          }
          return ok;
        };
      }
      case "oneOf": {
        const cs = k.children!.map((c) => (c.alwaysValid ? TRUE : this.check(c)));
        return (d, ev, st) => {
          let passed = false;
          for (let i = 0; i < cs.length; i++) {
            const t = ev ? newEv() : undefined;
            if (cs[i]!(d, t, st)) {
              if (passed) return false;
              passed = true;
              if (ev) merge(ev, t!);
            }
          }
          return passed;
        };
      }
      case "if": {
        const cIf = this.check(k.child!);
        const cThen = k.then && !k.then.alwaysValid ? this.check(k.then) : undefined;
        const cElse = k.else && !k.else.alwaysValid ? this.check(k.else) : undefined;
        return (d, ev, st) => {
          if (!ev) {
            if (!cThen && !cElse) return true;
            const branch = cIf(d, undefined, st) ? cThen : cElse;
            return branch ? branch(d, undefined, st) : true;
          }
          const t = newEv();
          const passed = cIf(d, t, st);
          if (passed) merge(ev, t);
          const branch = passed ? cThen : cElse;
          if (!branch) return true;
          const t2 = newEv();
          const ok = branch(d, t2, st);
          if (ok) merge(ev, t2);
          return ok;
        };
      }
      case "maximum":
      case "minimum":
      case "exclusiveMaximum":
      case "exclusiveMinimum": {
        const ok = LIMITS[k.keyword]!.ok;
        return (d) => ok(d, value);
      }
      case "multipleOf":
        return (d) => multipleOf(d, value);
      case "format": {
        const validate = k.format!.validate;
        return (d) => !!validate(d);
      }
      case "maxLength":
        return (d) => d.length <= value || ucs2length(d) <= value;
      case "minLength":
        return (d) => d.length >= value && ucs2length(d) >= value;
      case "pattern": {
        const re = k.regexp!;
        return (d) => re.test(d);
      }
      case "formatMaximum":
      case "formatMinimum":
      case "formatExclusiveMaximum":
      case "formatExclusiveMinimum": {
        const compare = k.format!.compare!;
        const fails = FORMAT_LIMITS[k.keyword]!.fails;
        return (d) => !fails(compare(d, value) as number);
      }
      case "maxItems":
        return (d) => d.length <= value;
      case "minItems":
        return (d) => d.length >= value;
      case "maxProperties":
        return (d) => Object.keys(d).length <= value;
      case "minProperties":
        return (d) => Object.keys(d).length >= value;
      case "prefixItems":
      case "items": {
        if (k.children) {
          const cs = k.children.map((c) => (c.alwaysValid ? undefined : this.check(c)));
          const n = cs.length;
          return (d, ev, st) => {
            const len = Math.min(d.length, n);
            for (let i = 0; i < len; i++) {
              const c = cs[i];
              if (c && !c(d[i], undefined, st)) return false;
            }
            if (ev && ev.items !== true && n > ev.items) ev.items = n;
            return true;
          };
        }
        return this.checkRest(k, k.prefix ?? 0, k.prefix !== undefined);
      }
      case "additionalItems":
        return this.checkRest(k, k.prefix!, true);
      case "contains":
        return this.checkContains(k);
      case "uniqueItems": {
        const itemTypes = k.itemTypes!;
        return (d) => duplicate(d, itemTypes) === undefined;
      }
      case "required": {
        const required = k.required as readonly string[];
        if (required.length === 1) {
          const p = required[0]!;
          return (d) => present(d, p);
        }
        return (d) => {
          for (let i = 0; i < required.length; i++) if (!present(d, required[i]!)) return false;
          return true;
        };
      }
      case "propertyNames": {
        if (k.child!.alwaysValid) return TRUE;
        const c = this.check(k.child!);
        return (d, _ev, st) => {
          for (const key of Object.keys(d)) if (!c(key, undefined, st)) return false;
          return true;
        };
      }
      case "additionalProperties": {
        const child = k.child!;
        const known = k.known!;
        const patterns = k.regexps!;
        const always = child.alwaysValid;
        const no = child.schema === false;
        const c = always || no ? undefined : this.check(child);
        return (d, ev, st) => {
          if (ev) ev.props = true;
          if (always) return true;
          for (const key of Object.keys(d)) {
            if (known.has(key)) continue;
            let matched = false;
            for (let i = 0; i < patterns.length; i++)
              if (patterns[i]!.test(key)) {
                matched = true;
                break;
              }
            if (matched) continue;
            if (no || !c!(d[key], undefined, st)) return false;
          }
          return true;
        };
      }
      case "dependencies":
      case "dependentRequired":
      case "dependentSchemas": {
        const required = (k.required ?? []) as readonly (readonly [string, readonly string[]])[];
        const entries = k.entries!.filter(([, n]) => !n.alwaysValid).map(([p, n]) => [p, this.check(n)] as const);
        return (d, ev, st) => {
          for (const [p, list] of required) {
            if (!list.length || !present(d, p)) continue;
            for (const r of list) if (!present(d, r)) return false;
          }
          for (const [p, c] of entries) {
            if (!present(d, p)) continue;
            const t = ev ? newEv() : undefined;
            if (!c(d, t, st)) return false;
            if (ev) merge(ev, t!);
          }
          return true;
        };
      }
      case "properties": {
        const keys = k.entries!.map(([key]) => key);
        const checks = k.entries!.map(([, n]) => (n.alwaysValid ? undefined : this.check(n)));
        const n = keys.length;
        return (d, ev, st) => {
          for (let i = 0; i < n; i++) {
            const key = keys[i]!;
            const c = checks[i];
            const v = d[key];
            if (v === undefined || !hasOwn.call(d, key)) continue;
            if (ev) record(ev, key);
            if (c && !c(v, undefined, st)) return false;
          }
          return true;
        };
      }
      case "patternProperties": {
        const regexps = k.regexps!;
        const cs = k.entries!.map(([, n]) => (n.alwaysValid ? undefined : this.check(n)));
        return (d, ev, st) => {
          const keys = Object.keys(d);
          for (let i = 0; i < regexps.length; i++) {
            const re = regexps[i]!;
            const c = cs[i];
            for (const key of keys) {
              if (!re.test(key)) continue;
              if (ev) record(ev, key);
              if (c && !c(d[key], undefined, st)) return false;
            }
          }
          return true;
        };
      }
      case "unevaluatedProperties": {
        const child = k.child!;
        const no = child.schema === false;
        const c = child.alwaysValid || no ? undefined : this.check(child);
        return (d, ev, st) => {
          const props = ev!.props;
          if (props !== true && (no || c))
            for (const key of Object.keys(d)) {
              if (props && props.has(key)) continue;
              if (no || !c!(d[key], undefined, st)) return false;
            }
          ev!.props = true;
          return true;
        };
      }
      case "unevaluatedItems": {
        const child = k.child!;
        const no = child.schema === false;
        const c = child.alwaysValid || no ? undefined : this.check(child);
        return (d, ev, st) => {
          const items = ev!.items;
          if (items !== true && (no || c)) {
            const idx = ev!.idx;
            for (let i = items; i < d.length; i++) {
              if (idx && idx.has(i)) continue;
              if (no || !c!(d[i], undefined, st)) return false;
            }
          }
          ev!.items = true;
          return true;
        };
      }
      case "discriminator": {
        const cs = k.children!.map((c) => this.check(c));
        const mapping = k.mapping!;
        const tagName = k.tagName!;
        return (d, ev, st) => {
          const tag = d[tagName];
          if (typeof tag !== "string") return false;
          const i = mapping.get(tag);
          return i !== undefined && cs[i]!(d, ev, st);
        };
      }
      case "errorMessage":
        return TRUE;
    }
    return TRUE;
  }

  /** The items after a tuple of `prefix` (`additionalItems`, 2020-12's `items` beside `prefixItems`), or every item (`items` alone). */
  private checkRest(k: KeywordNode, prefix: number, tuple: boolean): Check {
    const child = k.child!;
    if (tuple && child.schema === false)
      return (d, ev) => {
        if (ev) ev.items = true;
        return d.length <= prefix;
      };
    if (child.alwaysValid)
      return (d, ev) => {
        if (ev) ev.items = true;
        return true;
      };
    const c = this.check(child);
    return (d, ev, st) => {
      for (let i = prefix; i < d.length; i++) if (!c(d[i], undefined, st)) return false;
      if (ev) ev.items = true;
      return true;
    };
  }

  private checkContains(k: KeywordNode): Check {
    const min = k.min!;
    const max = k.max;
    const marks = this.options.containsEvaluates;
    const child = k.child!;
    const c = child.alwaysValid ? undefined : this.check(child);
    const mark = (d: any[], ev: Ev, st: Dyn | undefined) => {
      if (!c) ev.items = true;
      else for (let i = 0; i < d.length; i++) if (c(d[i], undefined, st)) (ev.idx ??= new Set()).add(i);
    };
    if (max === undefined && min === 0) return marks ? (d, ev, st) => (ev && mark(d, ev, st), true) : TRUE;
    if (max !== undefined && min > max) return FALSE;
    if (!c)
      return (d, ev) => {
        const ok = d.length >= min && (max === undefined || d.length <= max);
        if (ok && ev && marks) ev.items = true;
        return ok;
      };
    return (d, ev, st) => {
      const track = marks && ev !== undefined;
      let count = 0;
      for (let i = 0; i < d.length; i++) {
        if (!c(d[i], undefined, st)) continue;
        count++;
        if (track) (ev!.idx ??= new Set()).add(i);
        else if (max === undefined) {
          if (count >= min) return true;
        } else if (count > max) return false;
      }
      return count >= min && (max === undefined || count <= max);
    };
  }

  // ---- collect --------------------------------------------------------------------------------

  private buildCollect(node: SchemaNode): Collect {
    if (node.schema === true) return OK;
    const fail = this.failer(node);
    if (node.schema === false)
      return this.withScope(
        node,
        (_d: any, st: State) => {
          fail(st, `${node.path}/false schema`, "false schema", {}, "boolean schema is false");
          return false;
        },
        1,
      );
    const schemaType = (node.schema as Record<string, unknown>)["type"];
    const typeError = (st: State) => fail(st, `${node.path}/type`, "type", { type: schemaType }, `must be ${schemaType}`);
    const test = typesTest(node.types);
    const list: Step[] = [];
    if (node.typeCheck === "start")
      list.push((d, st) => {
        if (!test(d)) typeError(st);
      });
    const typeGroup = node.typeCheck === "group" ? GROUP_OF[node.types[0]!] : undefined;
    for (const group of GROUP_ORDER) {
      const keywords = node.keywords.filter((k) => k.group === group);
      const typed = typeGroup === group;
      // A type reported in its group's place is reported there even where no keyword of the group acts (an unknown `format`).
      if (!keywords.length && !typed) continue;
      const body = steps(keywords.map((k) => this.collectKeyword(k, node, fail)));
      if (group === "any" || group === "post") {
        if (body) list.push(body);
        continue;
      }
      const guard = GUARDS[group];
      list.push((d, st, ev) => {
        if (guard(d)) body?.(d, st, ev);
        else if (typed) typeError(st);
      });
    }
    const run = steps(list);
    const root = node.root;
    const own = node.unevaluated;
    const fn: Collect = (d, st, ev) => {
      const start = st.errors.length;
      const saved = st.base;
      if (root) st.base = start;
      if (run) {
        if (own) {
          const mine = newEv();
          run(d, st, mine);
          if (ev) merge(ev, mine);
        } else run(d, st, ev);
      }
      if (root) st.base = saved;
      return st.errors.length === start;
    };
    return this.withScope(node, fn, 1);
  }

  private failer(node: SchemaNode): (st: State, schemaPath: string, keyword: string, params: Record<string, unknown>, message: string) => void {
    if (node.propertyName)
      return (st, schemaPath, keyword, params, message) => {
        st.errors.push({ instancePath: pointer(st.path), schemaPath, keyword, params, message, propertyName: st.propName! });
      };
    return (st, schemaPath, keyword, params, message) => {
      st.errors.push({ instancePath: pointer(st.path), schemaPath, keyword, params, message });
    };
  }

  /** Runs `c` on the part `v` of the value at `key`. */
  private descend(): (c: Collect, v: unknown, key: string | number, st: State) => boolean {
    if (this.options.templates)
      return (c, v, key, st) => {
        st.path.push(key);
        st.data.push(v);
        st.keys.push(key);
        const ok = c(v, st, undefined);
        st.path.pop();
        st.data.pop();
        st.keys.pop();
        return ok;
      };
    return (c, v, key, st) => {
      st.path.push(key);
      const ok = c(v, st, undefined);
      st.path.pop();
      return ok;
    };
  }

  private collectKeyword(k: KeywordNode, node: SchemaNode, fail: ReturnType<Interpreter["failer"]>): Step {
    const value: any = k.value;
    const path = k.path;
    const descend = this.descend();
    switch (k.keyword) {
      case "$ref":
      case "$dynamicRef":
      case "$recursiveRef": {
        const target = this.collect(k.child!);
        if (!k.dynamic) return (d, st, ev) => void target(d, st, ev);
        const candidate = this.candidates(k.dynamic, (n) => this.collect(n));
        return (d, st, ev) => {
          const scope = st.scope;
          for (let i = 0; i < scope.length; i++) {
            const c = candidate(scope[i]!);
            if (c) return void c(d, st, ev);
          }
          target(d, st, ev);
        };
      }
      case "const": {
        const ok = this.checkKeyword(k, node);
        return (d, st) => {
          if (!ok(d, undefined, st)) fail(st, path, "const", { allowedValue: value }, "must be equal to constant");
        };
      }
      case "enum": {
        const ok = this.checkKeyword(k, node);
        return (d, st) => {
          if (!ok(d, undefined, st)) fail(st, path, "enum", { allowedValues: value }, "must be equal to one of the allowed values");
        };
      }
      case "not": {
        const c = this.check(k.child!);
        return (d, st) => {
          if (c(d, undefined, st)) fail(st, path, "not", {}, "must NOT be valid");
        };
      }
      case "allOf": {
        const run = steps(k.children!.filter((c) => !c.alwaysValid).map((c) => this.collect(c)));
        return run ?? (() => {});
      }
      case "anyOf": {
        const cs = k.children!.map((c) => this.collect(c));
        return (d, st, ev) => {
          const start = st.errors.length;
          let ok = false;
          for (const c of cs) {
            const t = ev ? newEv() : undefined;
            if (c(d, st, t)) {
              ok = true;
              if (!ev) break;
              merge(ev, t!);
            }
          }
          if (ok) st.errors.length = start;
          else fail(st, path, "anyOf", {}, "must match a schema in anyOf");
        };
      }
      case "oneOf": {
        const cs = k.children!.map((c) => (c.alwaysValid ? OK : this.collect(c)));
        return (d, st, ev) => {
          const start = st.errors.length;
          let valid = false;
          let passing: number | [number, number] | null = null;
          for (let i = 0; i < cs.length; i++) {
            const t = ev ? newEv() : undefined;
            if (!cs[i]!(d, st, t)) continue;
            if (valid) {
              valid = false;
              passing = [passing as number, i];
              break;
            }
            valid = true;
            passing = i;
            if (ev) merge(ev, t!);
          }
          if (valid) st.errors.length = start;
          else fail(st, path, "oneOf", { passingSchemas: passing }, "must match exactly one schema in oneOf");
        };
      }
      case "if": {
        const cIf = this.check(k.child!);
        const cThen = k.then && !k.then.alwaysValid ? this.collect(k.then) : undefined;
        const cElse = k.else && !k.else.alwaysValid ? this.collect(k.else) : undefined;
        return (d, st, ev) => {
          const t = ev ? newEv() : undefined;
          if (!cThen && !cElse && !ev) return;
          const passed = cIf(d, t, st);
          if (passed && ev) merge(ev, t!);
          const branch = passed ? cThen : cElse;
          if (!branch) return;
          const t2 = ev ? newEv() : undefined;
          if (branch(d, st, t2)) {
            if (ev) merge(ev, t2!);
          } else {
            const clause = passed ? "then" : "else";
            fail(st, path, "if", { failingKeyword: clause }, `must match "${clause}" schema`);
          }
        };
      }
      case "maximum":
      case "minimum":
      case "exclusiveMaximum":
      case "exclusiveMinimum": {
        const { ok, op } = LIMITS[k.keyword]!;
        const params = { comparison: op, limit: value };
        const message = `must be ${op} ${value}`;
        return (d, st) => {
          if (!ok(d, value)) fail(st, path, k.keyword, { ...params }, message);
        };
      }
      case "multipleOf":
        return (d, st) => {
          if (!multipleOf(d, value)) fail(st, path, "multipleOf", { multipleOf: value }, `must be multiple of ${value}`);
        };
      case "format": {
        const validate = k.format!.validate;
        return (d, st) => {
          if (!validate(d)) fail(st, path, "format", { format: value }, `must match format "${value}"`);
        };
      }
      case "maxLength":
        return (d, st) => {
          if (!(d.length <= value || ucs2length(d) <= value)) fail(st, path, "maxLength", { limit: value }, `must NOT have more than ${value} characters`);
        };
      case "minLength":
        return (d, st) => {
          if (!(d.length >= value && ucs2length(d) >= value)) fail(st, path, "minLength", { limit: value }, `must NOT have fewer than ${value} characters`);
        };
      case "pattern": {
        const re = k.regexp!;
        return (d, st) => {
          if (!re.test(d)) fail(st, path, "pattern", { pattern: value }, `must match pattern "${value}"`);
        };
      }
      case "formatMaximum":
      case "formatMinimum":
      case "formatExclusiveMaximum":
      case "formatExclusiveMinimum": {
        const compare = k.format!.compare!;
        const { fails, op } = FORMAT_LIMITS[k.keyword]!;
        return (d, st) => {
          if (fails(compare(d, value) as number)) fail(st, path, k.keyword, { comparison: op, limit: value }, `should be ${op} ${value}`);
        };
      }
      case "maxItems":
        return (d, st) => {
          if (d.length > value) fail(st, path, "maxItems", { limit: value }, `must NOT have more than ${value} items`);
        };
      case "minItems":
        return (d, st) => {
          if (d.length < value) fail(st, path, "minItems", { limit: value }, `must NOT have fewer than ${value} items`);
        };
      case "maxProperties":
        return (d, st) => {
          if (Object.keys(d).length > value) fail(st, path, "maxProperties", { limit: value }, `must NOT have more than ${value} properties`);
        };
      case "minProperties":
        return (d, st) => {
          if (Object.keys(d).length < value) fail(st, path, "minProperties", { limit: value }, `must NOT have fewer than ${value} properties`);
        };
      case "prefixItems":
      case "items": {
        if (k.children) {
          const cs = k.children.map((c) => (c.alwaysValid ? undefined : this.collect(c)));
          const n = cs.length;
          return (d, st, ev) => {
            const len = Math.min(d.length, n);
            for (let i = 0; i < len; i++) {
              const c = cs[i];
              if (c) descend(c, d[i], i, st);
            }
            if (ev && ev.items !== true && n > ev.items) ev.items = n;
          };
        }
        return this.collectRest(k, k.prefix ?? 0, k.prefix !== undefined, fail);
      }
      case "additionalItems":
        return this.collectRest(k, k.prefix!, true, fail);
      case "contains":
        return this.collectContains(k, fail);
      case "uniqueItems": {
        const itemTypes = k.itemTypes!;
        return (d, st) => {
          const found = duplicate(d, itemTypes);
          if (found) fail(st, path, "uniqueItems", { i: found[0], j: found[1] }, `must NOT have duplicate items (items ## ${found[1]} and ${found[0]} are identical)`);
        };
      }
      case "required": {
        const required = k.required as readonly string[];
        return (d, st) => {
          for (const p of required) if (!present(d, p)) fail(st, path, "required", { missingProperty: p }, `must have required property '${p}'`);
        };
      }
      case "propertyNames": {
        if (k.child!.alwaysValid) return () => {};
        const c = this.collect(k.child!);
        const templates = this.options.templates;
        return (d, st) => {
          for (const key of Object.keys(d)) {
            const saved = st.propName;
            st.propName = key;
            if (templates) {
              st.data.push(key);
              st.keys.push(undefined);
            }
            const ok = c(key, st, undefined);
            if (templates) {
              st.data.pop();
              st.keys.pop();
            }
            st.propName = saved;
            if (!ok) fail(st, path, "propertyNames", { propertyName: key }, "property name must be valid");
          }
        };
      }
      case "additionalProperties": {
        const child = k.child!;
        const known = k.known!;
        const patterns = k.regexps!;
        const always = child.alwaysValid;
        const no = child.schema === false;
        const c = always || no ? undefined : this.collect(child);
        return (d, st, ev) => {
          if (ev) ev.props = true;
          if (always) return;
          for (const key of Object.keys(d)) {
            if (known.has(key) || patterns.some((re) => re.test(key))) continue;
            if (no) fail(st, path, "additionalProperties", { additionalProperty: key }, "must NOT have additional properties");
            else descend(c!, d[key], key, st);
          }
        };
      }
      case "dependencies":
      case "dependentRequired":
      case "dependentSchemas": {
        const keyword = k.keyword;
        const required = (k.required ?? []) as readonly (readonly [string, readonly string[]])[];
        const entries = k.entries!.filter(([, n]) => !n.alwaysValid).map(([p, n]) => [p, this.collect(n)] as const);
        return (d, st, ev) => {
          for (const [p, list] of required) {
            if (!list.length || !present(d, p)) continue;
            const deps = list.join(", ");
            for (const r of list) if (!present(d, r)) fail(st, path, keyword, { property: p, missingProperty: r, depsCount: list.length, deps }, `must have ${list.length === 1 ? "property" : "properties"} ${deps} when property ${p} is present`);
          }
          for (const [p, c] of entries) {
            if (!present(d, p)) continue;
            const t = ev ? newEv() : undefined;
            if (c(d, st, t) && ev) merge(ev, t!);
          }
        };
      }
      case "properties": {
        const entries = k.entries!.map(([key, n]) => [key, n.alwaysValid ? undefined : this.collect(n)] as const);
        return (d, st, ev) => {
          for (const [key, c] of entries) {
            const v = d[key];
            if (v === undefined || !hasOwn.call(d, key)) continue;
            if (ev) record(ev, key);
            if (c) descend(c, v, key, st);
          }
        };
      }
      case "patternProperties": {
        const regexps = k.regexps!;
        const cs = k.entries!.map(([, n]) => (n.alwaysValid ? undefined : this.collect(n)));
        return (d, st, ev) => {
          const keys = Object.keys(d);
          for (let i = 0; i < regexps.length; i++) {
            const re = regexps[i]!;
            const c = cs[i];
            for (const key of keys) {
              if (!re.test(key)) continue;
              if (ev) record(ev, key);
              if (c) descend(c, d[key], key, st);
            }
          }
        };
      }
      case "unevaluatedProperties": {
        const child = k.child!;
        const no = child.schema === false;
        const c = child.alwaysValid || no ? undefined : this.collect(child);
        return (d, st, ev) => {
          const props = ev!.props;
          if (props !== true && (no || c))
            for (const key of Object.keys(d)) {
              if (props && props.has(key)) continue;
              if (no) fail(st, path, "unevaluatedProperties", { unevaluatedProperty: key }, "must NOT have unevaluated properties");
              else descend(c!, d[key], key, st);
            }
          ev!.props = true;
        };
      }
      case "unevaluatedItems": {
        const child = k.child!;
        const no = child.schema === false;
        const c = child.alwaysValid || no ? undefined : this.collect(child);
        return (d, st, ev) => {
          const items = ev!.items;
          if (items !== true && (no || c)) {
            const idx = ev!.idx;
            for (let i = items; i < d.length; i++) {
              if (idx && idx.has(i)) continue;
              if (no) {
                // One error for the array, as ajv's, at the first item nothing evaluated.
                fail(st, path, "unevaluatedItems", { limit: i }, `must NOT have more than ${i} items`);
                break;
              }
              descend(c!, d[i], i, st);
            }
          }
          ev!.items = true;
        };
      }
      case "discriminator": {
        const cs = k.children!.map((c) => this.collect(c));
        const mapping = k.mapping!;
        const tagName = k.tagName!;
        return (d, st, ev) => {
          const tag = d[tagName];
          if (typeof tag !== "string") return fail(st, path, "discriminator", { error: "tag", tag: tagName, tagValue: tag }, `tag "${tagName}" must be string`);
          const i = mapping.get(tag);
          if (i === undefined) return fail(st, path, "discriminator", { error: "mapping", tag: tagName, tagValue: tag }, `value of tag "${tagName}" must be in oneOf`);
          cs[i]!(d, st, ev);
        };
      }
      case "errorMessage": {
        const config = k.message!;
        return (d, st) => applyMessages(config, node, path, d, st);
      }
    }
    return () => {};
  }

  private collectRest(k: KeywordNode, prefix: number, tuple: boolean, fail: ReturnType<Interpreter["failer"]>): Step {
    const child = k.child!;
    const keyword = k.keyword;
    const path = k.path;
    if (tuple && child.schema === false)
      return (d, st, ev) => {
        if (ev) ev.items = true;
        if (d.length > prefix) fail(st, path, keyword, { limit: prefix }, `must NOT have more than ${prefix} items`);
      };
    if (child.alwaysValid)
      return (_d, _st, ev) => {
        if (ev) ev.items = true;
      };
    const c = this.collect(child);
    const descend = this.descend();
    return (d, st, ev) => {
      for (let i = prefix; i < d.length; i++) descend(c, d[i], i, st);
      if (ev) ev.items = true;
    };
  }

  private collectContains(k: KeywordNode, fail: ReturnType<Interpreter["failer"]>): Step {
    const min = k.min!;
    const max = k.max;
    const path = k.path;
    const { params, message } = containsMessage(min, max);
    const marks = this.options.containsEvaluates;
    const child = k.child!;
    const check = child.alwaysValid ? undefined : this.check(child);
    const mark = (d: any[], ev: Ev, st: State) => {
      if (!check) ev.items = true;
      else for (let i = 0; i < d.length; i++) if (check(d[i], undefined, st)) (ev.idx ??= new Set()).add(i);
    };
    if (max === undefined && min === 0)
      return (d, st, ev) => {
        if (marks && ev) mark(d, ev, st);
      };
    if (max !== undefined && min > max) return (_d, st) => fail(st, path, "contains", { ...params }, message);
    if (!check)
      return (d, st, ev) => {
        if (d.length >= min && (max === undefined || d.length <= max)) {
          if (marks && ev) ev.items = true;
        } else fail(st, path, "contains", { ...params }, message);
      };
    const c = this.collect(child);
    const descend = this.descend();
    return (d, st, ev) => {
      const start = st.errors.length;
      let valid: boolean;
      const len = d.length;
      if (max === undefined && min === 1) {
        valid = false;
        for (let i = 0; i < len; i++)
          if (descend(c, d[i], i, st)) {
            valid = true;
            break;
          }
      } else {
        valid = min === 0;
        if (min !== 0 || (max !== undefined && len > 0)) {
          let count = 0;
          for (let i = 0; i < len; i++) {
            if (!descend(c, d[i], i, st)) continue;
            count++;
            if (max === undefined) {
              if (count >= min) {
                valid = true;
                break;
              }
            } else {
              if (count > max) {
                valid = false;
                break;
              }
              if (min === 1 || count >= min) valid = true;
            }
          }
        }
      }
      if (valid) {
        st.errors.length = start;
        if (marks && ev) mark(d, ev, st);
      } else fail(st, path, "contains", { ...params }, message);
    };
  }
}
