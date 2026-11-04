// An engine error as one of dotschema's issues, `{ message, path, keyword }` (DESIGN.md, "The
// validator"). The engine reports ajv's errors (src/engine), so this is the mapping the module made of
// ajv's errors until the engine, unchanged.
import type { EngineError } from "../engine/index.ts";

export interface Issue {
  message: string;
  path: (string | number)[];
  keyword: string;
}

/**
 * The key of a property that is missing, unexpected or misnamed, which the error gives in its params
 * (for the discriminator, the tag's), and which ends the path.
 */
const KEYS: Record<string, string> = { required: "missingProperty", dependentRequired: "missingProperty", dependencies: "missingProperty", additionalProperties: "additionalProperty", unevaluatedProperties: "unevaluatedProperty", propertyNames: "propertyName", discriminator: "tag" };

type Place = Pick<EngineError, "instancePath" | "keyword"> & { params?: Record<string, unknown>; propertyName?: string };

/**
 * Standard Schema's path for an error. Its `instancePath` is a JSON Pointer, which writes an array
 * index as it writes an object key, so each segment is read against the value it names: in an array,
 * a number. The key an error names in its params ends the path; so does the key whose name an error
 * inside `propertyNames` is about, which the error gives itself.
 */
function pathOf(value: unknown, error: Place): (string | number)[] {
  const path: (string | number)[] = [];
  const segments = error.instancePath ? error.instancePath.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")) : [];
  let at: any = value;
  for (const segment of segments) {
    let index = false;
    // Reading the value again runs its getters again; one that throws now leaves the rest as keys.
    try {
      index = Array.isArray(at);
      at = typeof at === "object" && at !== null ? at[segment] : undefined;
    } catch {
      at = undefined;
    }
    path.push(index ? Number(segment) : segment);
  }
  const key = Object.hasOwn(KEYS, error.keyword) ? error.params?.[KEYS[error.keyword]!] : undefined;
  if (typeof key === "string") path.push(key);
  else if (typeof error.propertyName === "string") path.push(error.propertyName);
  return path;
}

/**
 * The issue for an error. ajv-errors' `errorMessage`, which the engine implements, reports a message
 * as one error with the errors it replaces in `params.errors`, never another message's, so the issue
 * takes the message, and the keyword of the first error it replaces; its path is the place the
 * message was written for, ended by the key every error it replaces names, when they name one (a
 * `required` message for a property, which ajv-errors reports at the object). The discriminator
 * dotschema adds for a `oneOf` whose variants a property tells apart is not in the schema as
 * written, so its failure is reported as the `oneOf`'s.
 */
export function issueOf(value: unknown, error: EngineError): Issue {
  let at: Place = error;
  if (error.keyword === "errorMessage") {
    const replaced = error.params["errors"] as EngineError[];
    const place = (e: Place) => JSON.stringify(pathOf(undefined, e));
    at = replaced.every((e) => e.instancePath === error.instancePath && place(e) === place(replaced[0]!)) ? replaced[0]! : { instancePath: error.instancePath, keyword: replaced[0]!.keyword };
  }
  return { message: error.message ?? "is not valid", path: pathOf(value, at), keyword: at.keyword === "discriminator" ? "oneOf" : at.keyword };
}

/** What was thrown, as text, for a value that could not be checked: one nested deeper than the stack, one that refers to itself where the schema recurses, a getter or proxy that throws. */
export function thrown(error: unknown): string {
  try {
    return typeof (error as Error)?.message === "string" ? (error as Error).message : String(error);
  } catch {
    return "a value that cannot be read";
  }
}
