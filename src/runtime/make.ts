// What a schema module calls to become dotschema's module value (DESIGN.md, "The validator"): the
// part of the run time both entries share (./index.ts, the JIT's, and ./interpret.ts, the
// interpreter's), given how each turns a validator of the engine into the check `.is()` runs.
//
//   const entry = schemaModule("2020-12", [["dotschema:0", schema]], { email }, { nodes, post });
//   const user = entry("", schema, (s) => documents, { object: true, node: 0 });  // the root
//   const address = entry("#/$defs/address", schema.$defs.address, (s) => documents2, { object: true });
//
// Nothing is compiled when a module is imported: the engine is compiled from the module's schema
// resources the first time one of its validators is needed, once for the module, and shared by its
// root and its definitions; each validator's check, the JIT's code, the interpreter or code written
// when the module was built (`check`, linked), is made the first time it runs.
import { compile, type Draft, type Engine, type EngineError, type FormatDefinition, type Validator } from "../engine/index.ts";
import type { PlanNode } from "../output.ts";
import { issueOf, thrown, type Issue } from "./issues.ts";

/** A check written when the module was built (src/engine/generate.ts): a function of what it reads from the compiled tree. */
export type Factory = (r: any) => (value: unknown) => boolean;
/** How an entry of the run time makes a validator's check: the JIT's code, the interpreter's, or the code a module carries. */
export type Fast = (validator: Validator, factory?: Factory) => (value: unknown) => boolean;

/** A schema resource: its absolute URI, which holds no path (src/refs.ts's `forEngine`), and the schema. */
export type Resource = readonly [id: string, schema: unknown];

/** A target's document for Standard JSON Schema, computed when the module was built (src/json-schema.ts), or why it has none. */
type Documents = Record<string, { schema?: unknown; output?: unknown; error?: string }>;
/** An entry's documents as the module writes them: a function of the engine's root resource, which reads each part they share with it from there (src/schema.ts). */
type DocumentsOf = (s: any) => Documents;

/** What a module's run time reads beside its resources: the discriminators dotschema adds, and the plan of the value `.validate()` gives (src/output.ts), with the checks it chooses by and the functions that walk it (./output.ts). */
export interface ModuleOptions {
  discriminator?: boolean;
  nodes?: PlanNode[];
  /** The schema each of the plan's checks is, by URI from the root resource's; `checks` the code of each, written when the module was built. */
  tests?: string[];
  checks?: Factory[];
  pre?: (N: PlanNode[], T: ((value: unknown) => boolean)[], node: PlanNode, value: unknown) => unknown;
  post?: (N: PlanNode[], node: PlanNode, value: unknown) => unknown;
}

/** What an entry is beside its schema: a plain object, with `.pick()` and the other methods; its node in the plan; and its check, written when the module was built. */
export interface EntryOptions {
  object?: boolean;
  node?: number;
  check?: Factory;
}

type Result<T = unknown> = { value: T } | { issues: [Issue, ...Issue[]] };

/** A copy of a JSON value, each object's own keys kept, `__proto__` among them. */
const copy = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(copy) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;

/** `make`'s value, made the first time it is asked for. */
const once = <T>(make: () => T): (() => T) => {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
};

/** The module's engine, compiled from `resources` the first time it is asked for. */
const lazily = (resources: readonly Resource[], draft: Draft, formats: Readonly<Record<string, FormatDefinition>>, discriminator: boolean): (() => Engine) => {
  let engine: Engine | undefined;
  return () => (engine ??= compile(resources.map(([id, schema]) => ({ id, schema })), { draft, formats, discriminator }));
};

/** A copy of `value` with `edit` applied to what `segments` lead to, each object or array on the way copied. */
const editAt = (value: any, segments: readonly string[], edit: (schema: any) => unknown): any => {
  if (!segments.length) return edit(value);
  const [first, ...rest] = segments as [string, ...string[]];
  if (Array.isArray(value)) return value.map((item, i) => (String(i) === first ? editAt(item, rest, edit) : item));
  return { ...value, [first]: editAt(value[first], rest, edit) };
};

/** A JSON Pointer fragment's segments, unescaped. */
const segmentsOf = (uri: string): string[] => {
  const fragment = uri.slice(uri.indexOf("#") + 1);
  return fragment ? fragment.slice(1).split("/").map((s) => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~")) : [];
};

/** The schema with only the properties `keep` keeps, in `properties` and `required`; every other keyword as it was. */
const filtered = (schema: any, keep: (key: string) => boolean): any => {
  const out = { ...schema };
  if (typeof schema.properties === "object" && schema.properties !== null) out.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => keep(key)));
  if (Array.isArray(schema.required)) out.required = schema.required.filter(keep);
  return out;
};

/** The schema with `required` in place of its own; every other keyword as it was. */
const requiring = (schema: any, required: string[]): any => {
  const out = { ...schema };
  if (Array.isArray(schema.required) || required.length) out.required = required;
  return out;
};

/** A schema's checks as the module value reads them: whether a value passes, at the first failure, and every error otherwise. */
interface Checks {
  check(): (value: unknown) => boolean;
  errors(value: unknown): EngineError[] | null;
}

/**
 * A module's value, or a definition's: `.validate()`, which checks first and lists every issue where
 * the value fails, `.is()`, Standard Schema and Standard JSON Schema, around `checks`. Nothing on it
 * throws but Standard JSON Schema's conversion to a target it has no schema for, as that spec asks:
 * what the engine throws for a value (one nested deeper than the stack, a getter that throws) is one
 * issue at the root with its message, and `.is()` false.
 */
function value(checks: Checks, schema: unknown, documents: () => Documents, input: (value: unknown) => unknown, output: ((value: unknown) => unknown) | undefined, outputDocuments: boolean): Record<string, any> {
  const validate = (value: unknown): Result => {
    let checked = value;
    let errors: EngineError[] | null = null;
    try {
      checked = input(value);
      if (checks.check()(checked) || !(errors = checks.errors(checked))) return { value: output ? output(checked) : checked };
    } catch (error) {
      return { issues: [{ message: "could not be checked: " + thrown(error), path: [], keyword: "error" }] };
    }
    return { issues: errors.map((error) => issueOf(checked, error)) as [Issue, ...Issue[]] };
  };
  // Checked as `.validate()` checks it, filled and transformed, and left as it was; a value that
  // cannot be checked is not known to be valid.
  const is = (value: unknown): boolean => {
    try {
      return checks.check()(input(value));
    } catch {
      return false;
    }
  };
  // Standard JSON Schema v1: the schema in the target's draft, self-contained; a fresh copy each call,
  // so a caller may change it. `output`, the document of the value `.validate()` gives, where a
  // default makes it differ (src/json-schema.ts).
  const jsonSchema = (wantOutput: boolean) => (options?: { target?: string }) => {
    const target = options?.target;
    const all = documents();
    const entry = typeof target === "string" && Object.hasOwn(all, target) ? all[target] : undefined;
    if (!entry) throw new TypeError(`dotschema converts a schema to the "draft-07" and "draft-2020-12" targets, not ${JSON.stringify(target)}.`);
    if (entry.error) throw new TypeError(entry.error);
    // A fresh tree: the documents read the parts they share with the schema from one copy of it, so
    // the same object can sit at two places of one, which a caller editing it in place must not meet.
    return copy(wantOutput && outputDocuments && entry.output ? entry.output : entry.schema);
  };
  return { validate, is, schema, "~standard": { version: 1, vendor: "dotschema", validate, jsonSchema: { input: jsonSchema(false), output: jsonSchema(true) } } };
}

/** The value of `.keyof()`: the keys a plain object's `properties` and `required` name, as a schema of its own, `{ "enum": [...] }`. */
function keyofValue(keys: string[]): Record<string, any> {
  const error = (): EngineError[] => [{ instancePath: "", schemaPath: "#/enum", keyword: "enum", params: { allowedValues: keys }, message: "must be equal to one of the allowed values" }];
  const check = (data: unknown) => typeof data === "string" && keys.includes(data);
  const document = (uri: string) => ({ schema: { $schema: uri, enum: [...keys] } });
  return value({ check: () => check, errors: (data) => (check(data) ? null : error()) }, { enum: [...keys] }, () => ({ "draft-07": document("http://json-schema.org/draft-07/schema#"), "draft-2020-12": document("https://json-schema.org/draft/2020-12/schema") }), (v) => v, undefined, false);
}

/**
 * The function a schema module calls once, with its draft, its schema resources (the root's first),
 * the formats they use and what its run time reads beside them, which gives its root and each
 * definition, an entry by its URI from the root resource's (`""` for the root itself).
 */
export function define(fast: Fast, draft: Draft, written: readonly Resource[], formats: Readonly<Record<string, FormatDefinition>>, options: ModuleOptions = {}) {
  const { discriminator = false, nodes = [], tests = [], checks = [], pre, post } = options;
  // The root resource is the module's `.schema` where the engine reads the schema as written
  // (src/schema.ts), so the engine compiles from a copy taken now, which the documents read too: a
  // caller that changes `.schema`, or a library it hands it to, changes nothing `.validate()`, `.is()`
  // and Standard JSON Schema give, before their first call as after it.
  const resources: readonly Resource[] = written.map(([id, schema], i) => [id, i === 0 ? copy(schema) : schema]);
  const engine = lazily(resources, draft, formats, discriminator);
  // The checks the plan chooses a member of a union, or `then` or `else`, with, each made when first used.
  const made: ((value: unknown) => boolean)[] = [];
  const T = tests.map((uri, i) => (value: unknown) => (made[i] ??= fast(engine().validator(uri), checks[i]))(value));

  /** An entry: the module's root or a definition, or what a method of one gives, on `engine`, from `resources`. */
  const entry = (engine: () => Engine, resources: readonly Resource[], uri: string, schema: any, documents: () => Documents, object: boolean, node: PlanNode | undefined, factory?: Factory): Record<string, any> => {
    let validator: Validator | undefined;
    let check: ((value: unknown) => boolean) | undefined;
    const get = () => (validator ??= engine().validator(uri || undefined));
    const checks: Checks = { check: () => (check ??= fast(get(), factory)), errors: (value) => get().errors(value) };
    const input = pre && node?.f ? (value: unknown) => pre(nodes, T, node, value) : (value: unknown) => value;
    const output = post && node ? (value: unknown) => post(nodes, node, value) : undefined;
    const result = value(checks, schema, documents, input, output, true);
    if (!object) return result;
    // `.pick()`, `.omit()`, `.partial()` and `.required()` give the schema whose `properties` and
    // `required` keep or name the keys asked for, every other keyword as it was, compiled from the
    // module's resources with it in the entry's place, when one of its validators is first needed;
    // its documents are the same edit of the entry's, and its node keeps the defaults and the keys it keeps.
    const segments = segmentsOf(uri);
    const derive = (edit: (schema: any, output: boolean) => any, change: (node: PlanNode) => PlanNode): Record<string, any> => {
      const edited: Resource[] = resources.map(([id, root], i) => [id, i === 0 ? editAt(root, segments, (s) => edit(s, false)) : root]);
      const docs = once((): Documents => Object.fromEntries(Object.entries(documents()).map(([target, d]) => [target, d.schema ? { schema: edit(d.schema, false), ...(d.output ? { output: edit(d.output, true) } : {}) } : d])));
      return entry(lazily(edited, draft, formats, discriminator), edited, uri, edit(schema, false), docs, true, node && change(node));
    };
    const properties = Object.keys(schema.properties ?? {});
    const required: string[] = schema.required ?? [];
    // The keys whose default `.validate()` fills in, which the output's document requires.
    const defaulted = node?.d ? node.d.map((d) => d[0]) : [];
    const narrow = (keep: (key: string) => boolean) =>
      derive(
        (s) => filtered(s, keep),
        (n) => ({ ...n, ...(n.p ? { p: n.p.filter((p) => keep(p[0])) } : {}), ...(n.r ? { r: n.r.filter(keep) } : {}), ...(n.d ? { d: n.d.filter((d) => keep(d[0])) } : {}) }),
      );
    const requireOnly = (keys: string[]) =>
      derive(
        (s, output) => requiring(s, output ? [...keys, ...defaulted.filter((key) => !keys.includes(key))] : keys),
        (n) => ({ ...n, r: keys }),
      );
    result["pick"] = (...keys: string[]) => narrow((key) => keys.includes(key));
    result["omit"] = (...keys: string[]) => narrow((key) => !keys.includes(key));
    result["partial"] = (...keys: string[]) => requireOnly(keys.length ? required.filter((key) => !keys.includes(key)) : []);
    result["required"] = (...keys: string[]) => requireOnly([...required, ...properties.filter((key) => (!keys.length || keys.includes(key)) && !required.includes(key))]);
    result["keyof"] = () => keyofValue([...new Set([...properties, ...required])]);
    return result;
  };

  return (uri: string, schema: unknown, documents: DocumentsOf, options: EntryOptions = {}) => entry(engine, resources, uri, schema, once(() => documents(resources[0]![1])), options.object ?? false, options.node === undefined ? undefined : nodes[options.node], options.check);
}
