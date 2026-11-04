// The run time of the value `.validate()` gives (DESIGN.md, "The value `.validate()` gives"): the
// walk of a module's plan (src/output.ts, `outputPlan`) beside a value. `pre`, before the value is
// checked, fills each property's `default` it lacks (or holds `undefined`) and applies each
// `transform`, where the schema applies (`allOf`, a `$ref`, the member of an `anyOf` or `oneOf` its
// tag names or that passes its check once filled, `then` or `else` as `if` passes, a present key's
// `dependentSchemas`); `post`, once it passed, drops each property that holds `undefined`, which the
// keywords pass as absent, and each key of an open object that no schema there lists (every member of
// an `anyOf` or `oneOf` read, but for the one its tag names). Each copies an object or array before
// it changes it, once, and returns the value it was given where nothing changed. `N` is the module's
// nodes, `T` the checks its plan chooses a member or a branch with.
//
// A module imports what its plan uses, so a bundler leaves out the rest: `pre` where something fills
// or transforms, and `post`, or `postOne` where every object stands alone, its properties holding
// nothing the plan reads, which reads one node as `post` reads that plan. Until the engine, a module
// carried this code as text, written for it with the parts its plan used; shared by every module of
// a bundle, it is written once and whole.
import type { PlanNode, Test, Union } from "../output.ts";

type Node = PlanNode;
type Check = (value: unknown) => boolean;

const own = (o: object, k: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

const patterns = new Map<string, RegExp>();
const matches = (source: string, key: string): boolean => {
  let re = patterns.get(source);
  if (!re) patterns.set(source, (re = new RegExp(source, "u")));
  return re.test(key);
};

/** Copy on write: `v` with `k` set to `x`, copied first unless this pass made it (`fresh`). */
const write = (v: any, k: string | number, x: unknown, fresh: Set<object>): any => {
  if (own(v, k) && Object.is(v[k], x)) return v;
  const c = fresh.has(v) ? v : Array.isArray(v) ? v.slice() : { ...v };
  fresh.add(c);
  Object.defineProperty(c, k, { value: x, writable: true, enumerable: true, configurable: true });
  return c;
};

const without = (v: any, k: string, fresh: Set<object>): any => {
  const c = fresh.has(v) ? v : { ...v };
  fresh.add(c);
  delete c[k];
  return c;
};

/** Whether a value passes an `if` that tests one property with `const` or `enum`. */
const passes = (test: Exclude<Test, number>, v: unknown): boolean => (isObject(v) ? (own(v, test.k) ? test.v.includes(v[test.k]) : !test.q) : !test.o);

/** The members of an `anyOf` or `oneOf` its tag names, or every member. */
const members = (u: Union, v: unknown): (number | null)[] => (u.k === undefined ? u.b : u.b.filter((_, i) => isObject(v) && own(v, u.k!) && u.v![i]!.includes(v[u.k!])));

/** The schemas of a key's value, in each node of `all`, as JSON Schema applies them. */
const keyed = (all: Node[], k: string, out: number[]): number[] => {
  for (const s of all) {
    const found = s.p && s.p.find((p) => p[0] === k);
    if (found && found[1] !== null) out.push(found[1]);
    let matched = false;
    for (const [source, c] of s.q || [])
      if (matches(source, k)) {
        matched = true;
        if (c !== null) out.push(c);
      }
    if (!found && !matched && s.a !== undefined) out.push(s.a);
  }
  return out;
};

const indexed = (all: Node[], i: number, out: number[]): number[] => {
  for (const s of all) {
    const c = s.t && i < s.t.length ? s.t[i] : s.i;
    if (c !== null && c !== undefined) out.push(c);
  }
  return out;
};

const transformed = (n: Node, s: string): string => {
  for (const t of n.x!) {
    if (t === "toEnumCase") {
      const lower = s.toLowerCase();
      const found = n.y!.find((y) => y[0] === lower);
      if (found) s = found[1];
    } else s = t === "trimLeft" ? s.trimStart() : t === "trimRight" ? s.trimEnd() : (s as any)[t]();
  }
  return s;
};

/** The value as `.validate()` and `.is()` check it: each default filled and each string transformed, where `root`, a node of `N`, says so. */
export function pre(N: Node[], T: Check[], root: Node, value: unknown): unknown {
  const visit = (n: Node, v: any, seen: Set<Node>, fresh: Set<object>): any => {
    if (n.x && typeof v === "string") v = transformed(n, v);
    if (isObject(v)) {
      for (const [k, d] of n.d || []) if (!own(v, k) || v[k] === undefined) v = write(v, k, d !== null && typeof d === "object" ? structuredClone(d) : d, fresh);
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (x === undefined) continue;
        let y = x;
        for (const c of keyed([n], k, [])) if (N[c]!.f) y = visit(N[c]!, y, new Set(), fresh);
        if (y !== x) v = write(v, k, y, fresh);
      }
    } else if (Array.isArray(v))
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        let y = x;
        for (const c of indexed([n], i, [])) if (N[c]!.f) y = visit(N[c]!, y, new Set(), fresh);
        if (y !== x) v = write(v, i, y, fresh);
      }
    // In place, once each where it applies to this value.
    if (seen.has(n)) return v;
    seen.add(n);
    for (const m of n.m || []) if (N[m]!.f) v = visit(N[m]!, v, seen, fresh);
    for (const u of n.u || []) {
      if (!u.f) continue;
      if (u.k !== undefined) {
        const b = members(u, v)[0];
        if (b !== undefined && b !== null && N[b]!.f) v = visit(N[b]!, v, seen, fresh);
        continue;
      }
      // The first member that passes once filled, its filling kept.
      for (let i = 0; i < u.b.length; i++) {
        const b = u.b[i]!;
        const tried = new Set<object>();
        const candidate = b !== null && N[b]!.f ? visit(N[b]!, v, new Set(seen), tried) : v;
        if (T[u.t![i]!]!(candidate)) {
          for (const made of tried) fresh.add(made);
          v = candidate;
          break;
        }
      }
    }
    if (n.c) {
      const [, then, otherwise, test] = n.c;
      const branch = test === null ? null : (typeof test === "number" ? T[test]!(v) : passes(test, v)) ? then : otherwise;
      if (branch !== null && N[branch]!.f) v = visit(N[branch]!, v, seen, fresh);
    }
    for (const [k, b] of n.e || []) if (N[b]!.f && isObject(v) && own(v, k)) v = visit(N[b]!, v, seen, fresh);
    return v;
  };
  return visit(root, value, new Set(), new Set());
}

/** The value `.validate()` gives once `value` passed: each property that holds `undefined`, and each key of an open object no schema there lists, dropped, where `root`, a node of `N`, says so. */
export function post(N: Node[], root: Node, value: unknown): unknown {
  const fresh = new Set<object>();
  const visit = (nodes: (Node | number)[], v: any): any => {
    // Every schema that applies here: those given, and in place, what each applies.
    const all: Node[] = [];
    const add = (n: Node | number | null | undefined) => {
      if (n === null || n === undefined) return;
      const s = typeof n === "number" ? N[n]! : n;
      if (all.includes(s)) return;
      all.push(s);
      for (const m of s.m || []) add(m);
      for (const u of s.u || []) for (const b of members(u, v)) add(b);
      if (s.c) {
        const [test, then, otherwise, how] = s.c;
        add(test);
        if (how !== null && typeof how === "object") add(passes(how, v) ? then : otherwise);
        else {
          add(then);
          add(otherwise);
        }
      }
      for (const [k, b] of s.e || []) if (isObject(v) && own(v, k)) add(b);
    };
    for (const n of nodes) add(n);
    if (isObject(v)) {
      const open = !all.some((s) => s.n || s.o) && all.some((s) => (s.p && s.p.length) || (s.r && s.r.length));
      for (const k of Object.keys(v)) {
        const x = v[k];
        const declared = all.some((s) => s.p && s.p.some((p) => p[0] === k));
        if (x === undefined && declared) {
          v = without(v, k, fresh);
          continue;
        }
        if (open && !declared && !all.some((s) => (s.r && s.r.includes(k)) || (s.q && s.q.some((q) => matches(q[0], k))))) {
          v = without(v, k, fresh);
          continue;
        }
        const children = keyed(all, k, []);
        if (!children.length) continue;
        const y = visit(children, x);
        if (y !== x) v = write(v, k, y, fresh);
      }
    } else if (Array.isArray(v))
      for (let i = 0; i < v.length; i++) {
        const children = indexed(all, i, []);
        if (!children.length) continue;
        const y = visit(children, v[i]);
        if (y !== v[i]) v = write(v, i, y, fresh);
      }
    return v;
  };
  return visit([root], value);
}

/** `post` for a plan where every object stands alone, reading the one node that applies: what `post` gives there. */
export function postOne(_N: Node[], s: Node, v: any): unknown {
  if (!isObject(v)) return v;
  const open = !s.n && !s.o && ((s.p && s.p.length) || (s.r && s.r.length));
  let c: Record<string, unknown> | undefined;
  for (const k of Object.keys(v))
    if (s.p && s.p.some((p) => p[0] === k) ? v[k] === undefined : open && !(s.r && s.r.includes(k))) {
      c = c || { ...v };
      delete c[k];
    }
  return c || v;
}
