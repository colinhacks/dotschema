// Schemas that write ajv-errors' `errorMessage`, and unions dotschema gives ajv's `discriminator`
// (`withDiscriminators` in src/schema.ts), each with values to check, for tests/engine-parity.test.ts,
// which compares the engine with dotschema's module on them; neither the 205 schemas of the keyword
// measurement nor the Test Suite writes either. Those marked "ajv-errors" are the schemas and values
// of ajv-errors 3.0.0's own tests (spec/object.spec.ts, spec/string.spec.ts and spec/options.spec.ts
// at 7efe8c2, MIT, Copyright (c) 2017 Evgeny Poberezkin), those marked "ajv" of ajv 8.20.0's
// spec/discriminator.spec.ts (MIT, the same author) without the `discriminator` keyword, which
// dotschema takes out and adds where each variant names one tag (so `"enum": ["y"]` where ajv's
// test has `["y", "z"]`); the rest are dotschema's, each for a case those leave
// out: a message in a schema ajv compiles as a function of its own, inside `propertyNames`, in a
// branch, beside one of its children's, a template reading above its value, and the later drafts'
// keywords.
const D2019 = "https://json-schema.org/draft/2019-09/schema";
const D2020 = "https://json-schema.org/draft/2020-12/schema";

export interface MessageCase {
  id: string;
  schema: Record<string, unknown>;
  values: unknown[];
  /** Whether dotschema gives the schema a discriminator, which the test checks. */
  discriminator?: boolean;
}

const fooBarObject = {
  type: "object",
  required: ["foo", "bar"],
  properties: { foo: { type: "object", required: ["baz"], properties: { baz: { type: "integer", maximum: 2 } } }, bar: { type: "array", items: { type: "string", maxLength: 3 }, minItems: 1 } },
  additionalProperties: false,
};
const fooBarValues = [{ foo: { baz: 1 }, bar: ["abc"] }, {}, { foo: 1 }, { foo: 1, bar: 2 }, { foo: { baz: "a" } }, { foo: { baz: 3 } }, { foo: { baz: 3 }, bar: [] }, { foo: { baz: 3 }, bar: [1] }, { foo: { baz: 3 }, bar: ["abcd"] }];
const fooBarItems = {
  type: "array",
  items: [{ type: "object", required: ["baz"], properties: { baz: { type: "integer", maximum: 2 } } }, { type: "array", items: { type: "string", maxLength: 3 }, minItems: 1 }],
  minItems: 2,
  additionalItems: false,
};
const fooBarItemValues = [[{ baz: 1 }, ["abc"]], [], [1], [1, 2], [{ baz: "a" }], [{ baz: 3 }], [{ baz: 3 }, []], [{ baz: 3 }, [1]], [{ baz: 3 }, ["abcd"]]];
const propsAndItems = {
  definitions: { foo: fooBarItems.items[0], bar: fooBarItems.items[1] },
  anyOf: [
    { type: "object", required: ["foo", "bar"], properties: { foo: { $ref: "#/definitions/foo" }, bar: { $ref: "#/definitions/bar" } }, additionalProperties: false },
    { type: "array", items: [{ $ref: "#/definitions/foo" }, { $ref: "#/definitions/bar" }], minItems: 2, additionalItems: false },
  ],
};
const propertyMessages = { foo: 'data.foo should be an object with the integer property "baz" <= 2', bar: "data.bar should be an array with at least one string item with length <= 3" };
const propertyTemplates = { foo: 'data.foo should be an object with the integer property "baz" <= 2, "baz" is ${/foo/baz}', bar: 'data.bar should be an array with at least one string item with length <= 3, "bar" is ${/bar}' };
const itemMessages = ['data[0] should be an object with the integer property "baz" <= 2', "data[1] should be an array with at least one string item with length <= 3"];
const itemTemplates = ['data[0] should be an object with the integer property "baz" <= 2, data[0].baz is ${/0/baz}', "data[1] should be an array with at least one string item with length <= 3, data[1] is ${/1}"];
const fooInteger = { type: "object", required: ["foo"], properties: { foo: { type: "integer" } }, additionalProperties: false };
const fooIntegerValues = [{ foo: 1 }, {}, { bar: 2 }, { foo: 1, bar: 2 }, { foo: "a" }, { foo: "a", bar: 2 }, 1];
const requiredFooBar = { type: "object", required: ["foo", "bar"], properties: { foo: { type: "integer" }, bar: { type: "string" } } };
const requiredValues = [{ foo: 1, bar: "a" }, {}, { foo: 1 }, { foo: "a" }, { bar: "a" }];
const node = { type: "object", properties: { value: { type: "number" }, next: { $ref: "#/$defs/node" } } };
const variants = [
  { properties: { foo: { const: "x" }, a: { type: "string" } }, required: ["foo", "a"] },
  { properties: { foo: { enum: ["y"] }, b: { type: "string" } }, required: ["foo", "b"] },
];
const variantValues = [{ foo: "x", a: "a" }, { foo: "y", b: "b" }, { foo: "z", b: "b" }, {}, { foo: 1 }, { foo: "bar" }, { foo: "x", b: "b" }, { foo: "y", a: "a" }, { foo: "z", a: "a" }, 1];

export const MESSAGE_CASES: MessageCase[] = [
  // ajv-errors
  { id: "keywords", schema: { ...fooInteger, errorMessage: { type: "should be an object", required: "should have property foo", additionalProperties: "should not have properties other than foo" } }, values: fooIntegerValues },
  // These two one property deeper than ajv-errors' tests have them: the module compiles each property
  // of a plain object as a validator of its own too, where `${0#}` reads above the value, so it
  // refuses the schemas as written ("Cannot access property/index 0 levels up"), which ajv-errors and
  // the engine compile.
  {
    id: "keyword templates",
    schema: { type: "object", properties: { x: { type: "object", properties: { foo: { type: "number", minimum: 5, maximum: 10, errorMessage: { type: "property ${0#} should be number, it is ${0}", minimum: "property ${0#} should be >= 5, it is ${0}", maximum: "property foo should be <= 10" } } } } } },
    values: [{ foo: 7 }, { foo: "a" }, { foo: ["a"] }, { foo: 4.5 }, { foo: 10.5 }].map((x) => ({ x })),
  },
  {
    id: "keyword templates, integer",
    schema: { type: "object", properties: { x: { type: "object", properties: { foo: { type: "integer", minimum: 5, maximum: 10, errorMessage: { type: "property ${0#} should be integer, it is ${0}", minimum: "property ${0#} should be >= 5, it is ${0}", maximum: "property foo should be <= 10" } } } } } },
    values: [{ foo: 7 }, { foo: "a" }, { foo: ["a"] }, { foo: 5.5 }, { foo: 4.5 }, { foo: 4 }, { foo: 11 }].map((x) => ({ x })),
  },
  { id: "required by property", schema: { ...requiredFooBar, errorMessage: { type: "should be an object", required: { foo: 'an integer property "foo" is required', bar: 'a string property "bar" is required' } } }, values: requiredValues },
  { id: "required, one property", schema: { ...requiredFooBar, errorMessage: { type: "should be an object", required: { foo: 'an integer property "foo" is required' } } }, values: requiredValues },
  {
    id: "required and dependencies, templates",
    schema: {
      ...requiredFooBar,
      dependencies: { foo: ["quux"], bar: ["boo"] },
      errorMessage: {
        type: "should be an object",
        required: { foo: 'an integer property "foo" is required, "bar" is ${/bar}', bar: 'a string property "bar" is required, "foo" is ${/foo}' },
        dependencies: { foo: '"quux" should be present when "foo" is present, "foo" is ${/foo}', bar: '"boo" should be present when "bar" is present, "bar" is ${/bar}' },
      },
    },
    values: [{ foo: 1, bar: "a", quux: 2, boo: 3 }, {}, { foo: 1 }, { foo: "a" }, { bar: "a" }, { foo: 1, bar: "a" }, { foo: 1, bar: "a", quux: 2 }],
  },
  { id: "required, templates", schema: { ...requiredFooBar, errorMessage: { type: "should be an object", required: { foo: 'an integer property "foo" is required, "bar" is ${/bar}', bar: 'a string property "bar" is required, "foo" is ${/foo}' } } }, values: requiredValues },
  { id: "properties", schema: { ...fooBarObject, errorMessage: { properties: propertyMessages } }, values: fooBarValues },
  { id: "properties, templates", schema: { ...fooBarObject, errorMessage: { properties: propertyTemplates } }, values: fooBarValues },
  { id: "items", schema: { ...fooBarItems, errorMessage: { items: itemMessages } }, values: fooBarItemValues },
  { id: "items, templates", schema: { ...fooBarItems, errorMessage: { items: itemTemplates } }, values: fooBarItemValues },
  { id: "properties and items", schema: { ...propsAndItems, errorMessage: { properties: propertyMessages, items: itemMessages } }, values: [...fooBarValues, ...fooBarItemValues] },
  { id: "properties and items, templates", schema: { ...propsAndItems, errorMessage: { properties: propertyTemplates, items: itemTemplates } }, values: [...fooBarValues, ...fooBarItemValues] },
  {
    id: "default message",
    schema: { ...requiredFooBar, errorMessage: { properties: { foo: "data.foo should be integer", bar: "data.bar should be integer" }, required: "properties foo and bar are required", _: 'should be an object with properties "foo" (integer) and "bar" (string)' } },
    values: [{ foo: 1, bar: "a" }, { foo: 1 }, { foo: "a" }, null],
  },
  { id: "string", schema: { ...fooInteger, errorMessage: "should be an object with an integer property foo only" }, values: fooIntegerValues },
  ...['properties "foo" = ${/foo}, "bar" = ${/bar}, should be integer', '${/foo}, ${/bar} are the values of properties "foo", "bar", should be integer', 'properties "foo", "bar" should be integer, they are ${/foo}, ${/bar}'].map((message, i) => ({
    id: `string template ${i}`,
    schema: { type: "object", properties: { foo: { type: "integer" }, bar: { type: "integer" } }, errorMessage: message },
    values: [{ foo: 1 }, { foo: 1.2, bar: 2.3 }, { foo: "a", bar: "b" }, { foo: false, bar: true }],
  })),
  { id: "nested string", schema: { type: "object", properties: { foo: { type: "object", properties: { baz: { type: "integer" } }, errorMessage: "should be an object with an integer property baz" }, bar: { type: "integer" } } }, values: [{ foo: { baz: 1 }, bar: 2 }, { foo: 1 }, { foo: { baz: "x" }, bar: "y" }] },
  { id: "number keywords", schema: { type: "number", minimum: 2, maximum: 10, multipleOf: 2, errorMessage: { minimum: "should be >= 2", maximum: "should be <= 10" } }, values: [4, 11, 1, 3, "x"] },

  // dotschema's
  { id: "a message in a function of its own", schema: { $defs: { node: { ...node, errorMessage: { properties: { value: "value is ${0}" } } } }, $ref: "#/$defs/node" }, values: [{ value: 1 }, { value: "x" }, { value: 1, next: { value: "y" } }, { value: 1, next: { value: 2, next: { value: false } } }] },
  {
    id: "a child message over a function's errors",
    schema: { properties: { tree: { $ref: "#/$defs/node" } }, errorMessage: { properties: { tree: "bad tree" } }, $defs: { node: { type: "object", properties: { kids: { type: "array", items: { $ref: "#/$defs/node" } }, n: { type: "integer" } } } } },
    values: [{ tree: { n: 1 } }, { tree: { n: "x" } }, { tree: { kids: [{ n: 1.5 }] } }, { tree: 5 }],
  },
  { id: "a message for every error over a function's", schema: { allOf: [{ $ref: "#/$defs/node" }], errorMessage: "invalid node ${/value}", $defs: { node } }, values: [{ value: 1 }, { value: "x" }, { value: 1, next: { value: [] } }, 7] },
  { id: "propertyNames' own message", schema: { propertyNames: { pattern: "^[a-z]+$", maxLength: 3, errorMessage: "property name ${0} is not valid" } }, values: [{ abc: 1 }, { ABC: 1 }, { abcd: 1, X: 2 }] },
  { id: "a message for propertyNames", schema: { propertyNames: { pattern: "^a" }, errorMessage: { propertyNames: "keys must start with a" } }, values: [{ a: 1 }, { b: 1, c: 2 }] },
  { id: "a child's message beside the parent's", schema: { properties: { a: { type: "string", errorMessage: "a must be a string" }, b: { type: "number" } }, errorMessage: { _: "the object is invalid", properties: { b: "b must be a number" } } }, values: [{ a: 1 }, { b: "x" }, { a: 1, b: "x" }, 5] },
  { id: "messages in then and else", schema: { if: { properties: { kind: { const: "a" } } }, then: { required: ["x"], errorMessage: { required: "x is needed for kind a" } }, else: { required: ["y"], errorMessage: "y is needed" } }, values: [{ kind: "a" }, { kind: "b" }, { kind: "a", x: 1 }, {}] },
  { id: "a message for oneOf", schema: { oneOf: [{ type: "string", errorMessage: "s" }, { type: "number", minimum: 3 }], errorMessage: { oneOf: "must be a string or a number >= 3" } }, values: ["x", 5, 1, true] },
  { id: "item messages over prefixItems", schema: { $schema: D2020, prefixItems: [{ type: "string" }, { type: "number" }], items: false, errorMessage: { items: ["the first must be a string", "the second is ${/1}"] } }, values: [["a", 1], [1, "a"], ["a", 1, 2], []] },
  // ajv-errors' meta-schema takes a message by property for `required` and `dependencies` alone, so `dependentRequired` has one message.
  { id: "a message for dependentRequired", schema: { $schema: D2019, dependentRequired: { a: ["b", "c"] }, errorMessage: { dependentRequired: "with a, b and c are needed; a is ${/a}" } }, values: [{ a: 1 }, { a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, {}] },
  { id: "keys that read as indices", schema: { properties: { "10": { type: "string" }, b: { type: "string" }, "2": { type: "string" } }, errorMessage: { properties: { b: "b!", "10": "ten!", "2": "two!" } } }, values: [{ "10": 1, "2": 1, b: 1 }, { b: "x" }] },
  { id: "templates reading above their value", schema: { properties: { a: { properties: { b: { type: "number", errorMessage: "the root is ${2}, a is ${1}, at ${1#}/${0#}, missing ${/x/y}, first ${/list/0}" } } } } }, values: [{ a: { b: "x" } }, { a: { b: 1 } }, { a: { b: "x" }, list: [null], x: 0 }] },
  { id: "empty messages", schema: { properties: { a: { type: "string", errorMessage: "" }, b: { type: "string", errorMessage: { _: "" } }, c: { type: "string", errorMessage: { type: "" } } } }, values: [{ a: 1, b: 1, c: 1 }] },
  { id: "type in its group", schema: { type: "string", minLength: 2, const: "abc", errorMessage: { type: "T", const: "C" } }, values: [5, "a", "ab", "abc"] },
  { id: "a keyword no error has", schema: { type: "string", errorMessage: { foo: "never", type: "T" } }, values: [1, "x"] },
  { id: "a message for contains", schema: { contains: { type: "number" }, errorMessage: { contains: "needs a number" } }, values: [[], ["a"], [1]] },

  // ajv
  { id: "discriminator", schema: { type: "object", oneOf: variants }, values: variantValues, discriminator: true },
  { id: "discriminator, tag required beside", schema: { type: "object", required: ["foo"], oneOf: variants.map((v) => ({ ...v, required: v.required.slice(1) })) }, values: variantValues, discriminator: true },
  { id: "discriminator through $refs", schema: { type: "object", definitions: { schema1: variants[0], schema2: variants[1] }, oneOf: [{ $ref: "#/definitions/schema1" }, { $ref: "#/definitions/schema2" }] }, values: variantValues, discriminator: true },
  // dotschema's
  {
    id: "discriminator with messages",
    schema: {
      type: "object",
      required: ["kind"],
      oneOf: [
        { properties: { kind: { const: "circle" }, r: { type: "number" } }, required: ["r"], errorMessage: { required: "a circle needs r" } },
        { properties: { kind: { const: "square" }, side: { type: "number" } }, required: ["side"] },
      ],
      errorMessage: { discriminator: "unknown kind ${/kind}" },
    },
    values: [{ kind: "circle", r: 1 }, { kind: "circle" }, { kind: "tri" }, {}, { kind: "square", side: "x" }, { kind: 1 }],
    discriminator: true,
  },
  {
    id: "discriminator in a property, 2020-12",
    schema: { $schema: D2020, properties: { shape: { type: "object", oneOf: [{ $ref: "#/$defs/c" }, { $ref: "#/$defs/s" }] } }, $defs: { c: { type: "object", properties: { t: { const: "c" }, r: { type: "number" } }, required: ["t"] }, s: { type: "object", properties: { t: { const: "s" } }, required: ["t"] } } },
    values: [{ shape: { t: "c" } }, { shape: { t: "c", r: "x" } }, { shape: { t: "x" } }, { shape: {} }, { shape: 1 }],
    discriminator: true,
  },
];
