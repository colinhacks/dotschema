// Motherload's data loaders and dotschema in one project (tests/motherload.test.ts): each import is
// typed by its own package's content mapper, loaded by its preload or bundled by its esbuild plugin,
// whichever order the host was given them in.
import settings from "./settings.jsonc";
import data from "./data.json5";
import user, { type Type as User } from "./user.schema.jsonc";
import point, { type Type as Point } from "./point.schema.json5";

// Exact equality of two types, not mere assignability.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};

expect<Equal<typeof settings, { readonly "editor.fontSize": 14 }>>();
expect<Equal<typeof data, { readonly hex: 16 }>>();
expect<Equal<Pick<User, keyof User>, { name: string; role?: "admin" | "member" }>>();
expect<Equal<Point, { x: number; y: number; [key: string]: unknown }>>();

console.log(JSON.stringify({ fontSize: settings["editor.fontSize"], hex: data.hex, vendors: [user["~standard"].vendor, point["~standard"].vendor], valid: user.is({ name: "Ada" }), invalid: user.is({ name: "" }), point: [point.is({ x: 1, y: 2 }), point.is({ x: 1.5, y: 2 })] }));
