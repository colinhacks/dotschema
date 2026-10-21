// Sets the version dotschema is released at (DESIGN.md, "Releasing"): `nub run bump 0.2.0` writes it
// into package.json, the one manifest, from which scripts/build.ts takes the published version and
// release.yml the version it stages. The file is edited as text, so its layout is kept.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const next = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) throw new Error(`usage: nub run bump <version>, a semver such as 0.2.0; got "${next}"`);

const path = join(root, "package.json");
const bumped = readFileSync(path, "utf8").replace(/^( {2}"version": )"[^"]*"/m, `$1"${next}"`);
if (JSON.parse(bumped).version !== next) throw new Error(`package.json: no top-level "version" to set`);
writeFileSync(path, bumped);
console.log(`package.json: ${next}`);
