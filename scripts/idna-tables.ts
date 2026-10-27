// Checks the Unicode tables of src/formats/idn-hostname.cjs against the Unicode Character Database
// (DESIGN.md, "Formats"), for every code point the file's ALLOWED takes, and prints the tables the data
// gives where they differ: the viramas (canonical combining class 9), the joining types (T; L or D; R
// or D, of code points that are not marks), the Bidi class each code point gets, and the code points
// UTS #46 ignores (for every code point); then runs the format on UTS #46's conformance tests, but
// for the lines with a code point IDNA2008 does not allow (NV8 or XV8), which the file says an IDNA2008
// implementation skips. Run by hand when the Unicode version changes, with a directory that holds
// DerivedJoiningType.txt, DerivedCombiningClass.txt and DerivedBidiClass.txt
// (https://www.unicode.org/Public/<version>/ucd/extracted/), IdnaMappingTable.txt and IdnaTestV2.txt
// (https://www.unicode.org/Public/idna/<version>/): `nub scripts/idna-tables.ts <dir>`. The engine's
// Unicode, which the file's property escapes read, must be the data's.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: nub scripts/idna-tables.ts <directory of the Unicode data files>");
const file = join(import.meta.dirname, "..", "src", "formats", "idn-hostname.cjs");

// The file's regular expressions, by name, each `const NAME = /.../flags;` on a line of its own.
const found = new Map<string, RegExp>();
for (const [, name = "", body = "", flags = ""] of readFileSync(file, "utf8").matchAll(/^const (\w+) = \/(.*)\/([a-z]*);$/gm)) found.set(name, new RegExp(body, flags));
const rx = (name: string): RegExp => {
  const regex = found.get(name);
  if (!regex) throw new Error(`src/formats/idn-hostname.cjs has no regular expression ${name}`);
  return regex;
};

/** The fields of a data file's line, its comment left out. */
const fieldsOf = (line: string) => (line.split("#")[0] ?? "").split(";").map((field) => field.trim());

/** A data file's property by code point, from its `code(..code) ; value` lines, and the Unicode version its header names. */
function read(name: string, value = (fields: string[]) => fields[1] ?? ""): { map: Map<number, string>; version: string } {
  const text = readFileSync(join(dir!, name), "utf8");
  const map = new Map<number, string>();
  for (const line of text.split("\n")) {
    const fields = fieldsOf(line);
    const [, first, last] = (fields[0] ?? "").match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?$/) ?? [];
    if (first) for (let c = parseInt(first, 16); c <= parseInt(last ?? first, 16); c++) map.set(c, value(fields));
  }
  return { map, version: text.match(/(\d+\.\d+)\.\d+/)?.[1] ?? "unknown" };
}
const joining = read("DerivedJoiningType.txt"), combining = read("DerivedCombiningClass.txt"), bidi = read("DerivedBidiClass.txt"), idna = read("IdnaMappingTable.txt");
const versions = new Set([joining.version, combining.version, bidi.version, idna.version]);
if (versions.size !== 1 || !versions.has(process.versions.unicode ?? "")) throw new Error(`the data is Unicode ${[...versions].join(", ")}, and this engine's Unicode is ${process.versions.unicode}`);

const char = (c: number) => String.fromCodePoint(c);
const surrogate = (c: number) => c >= 0xd800 && c <= 0xdfff;
const allowed = (c: number) => !surrogate(c) && rx("ALLOWED").test(char(c));
const mark = (c: number) => /^[\p{Mn}\p{Me}]$/u.test(char(c));
// The Bidi class as the file's `bidiClass` letters it, from the data, and as the file's rules give it.
const LETTER: Record<string, string> = { AN: "A", EN: "E", ES: "O", CS: "O", ET: "O", ON: "O", BN: "O", NSM: "N", R: "R", AL: "R", L: "L" };
const bidiClass = (c: number) => {
  const s = char(c);
  return rx("AN").test(s) ? "A" : rx("EN").test(s) ? "E" : rx("NEUTRAL").test(s) ? "O" : rx("NSM").test(s) ? "N" : /\p{M}/u.test(s) ? "L" : rx("RTL").test(s) ? "R" : "L";
};
const ignored = new RegExp(rx("IGNORED").source, "u");

/** A table as a character class: the code points `want` takes, ranges merged across the ones `free` takes, which never reach the table. */
function table(want: (c: number) => boolean, free: (c: number) => boolean): string {
  const out: [number, number][] = [];
  let open: [number, number] | undefined;
  for (let c = 0; c < 0x110000; c++) {
    if (want(c)) {
      if (open) open[1] = c;
      else out.push((open = [c, c]));
    } else if (!free(c)) open = undefined;
  }
  const esc = (c: number) => (c < 0x10000 ? `\\u${c.toString(16).toUpperCase().padStart(4, "0")}` : `\\u{${c.toString(16).toUpperCase()}}`);
  return `[${out.map(([a, b]) => (a === b ? esc(a) : b === a + 1 ? esc(a) + esc(b) : `${esc(a)}-${esc(b)}`)).join("")}]`;
}

const checks: { name: string; data: (c: number) => boolean | string; ours: (c: number) => boolean | string; over: (c: number) => boolean; free: (c: number) => boolean }[] = [
  { name: "VIRAMA", data: (c) => combining.map.get(c) === "9", ours: (c) => rx("VIRAMA").test(char(c)), over: allowed, free: (c) => !allowed(c) },
  { name: "T", data: (c) => joining.map.get(c) === "T", ours: (c) => rx("T").test(char(c)), over: allowed, free: (c) => !allowed(c) },
  { name: "JOINS_LEFT", data: (c) => ["L", "D"].includes(joining.map.get(c) ?? "U"), ours: (c) => rx("JOINS_LEFT").test(char(c)), over: (c) => allowed(c) && !mark(c), free: (c) => !allowed(c) || mark(c) },
  { name: "JOINS_RIGHT", data: (c) => ["R", "D"].includes(joining.map.get(c) ?? "U"), ours: (c) => rx("JOINS_RIGHT").test(char(c)), over: (c) => allowed(c) && !mark(c), free: (c) => !allowed(c) || mark(c) },
  { name: "bidiClass", data: (c) => LETTER[bidi.map.get(c) ?? "L"] ?? `none (${bidi.map.get(c)})`, ours: bidiClass, over: allowed, free: () => false },
  { name: "IGNORED", data: (c) => idna.map.get(c) === "ignored", ours: (c) => ignored.test(char(c)), over: (c) => !surrogate(c), free: () => false },
];
let failed = false;
for (const { name, data, ours, over, free } of checks) {
  const differ: number[] = [];
  for (let c = 0; c < 0x110000; c++) if (over(c) && data(c) !== ours(c)) differ.push(c);
  if (!differ.length) {
    console.log(`${name}: as the data has it`);
    continue;
  }
  failed = true;
  console.log(`${name}: ${differ.length} code points differ, the first ${differ.slice(0, 10).map((c) => `U+${c.toString(16).toUpperCase()} (${data(c)}, the file ${ours(c)})`).join(", ")}`);
  if (name !== "bidiClass") console.log(`  from the data: ${table((c) => over(c) && data(c) === true, (c) => free(c) || !over(c))}`);
}

// UTS #46's conformance tests: the source of each line (column 1), and whether toASCII, nontransitional, finds no error (column 5, or 3 when it is empty), but for X4_2, an empty label toUnicode alone reports.
const idna2008 = read("IdnaMappingTable.txt", (fields) => fields[3] ?? "").map;
const unescape = (text: string) => (text === '""' ? "" : text.replace(/\\u([0-9A-F]{4})|\\x\{([0-9A-F]+)\}/gi, (_, a?: string, b?: string) => String.fromCodePoint(parseInt(a ?? b ?? "", 16))));
const idnHostname: (str: string) => boolean = createRequire(import.meta.url)(file);
let run = 0, skipped = 0;
const wrong: string[] = [];
for (const line of readFileSync(join(dir, "IdnaTestV2.txt"), "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [source = "", unicode = "", unicodeStatus = "", , asciiStatus = ""] = fieldsOf(line);
  const input = unescape(source);
  if (Array.from(unicode === "" ? input : unescape(unicode)).some((c) => ["NV8", "XV8"].includes(idna2008.get(c.codePointAt(0) ?? 0) ?? ""))) {
    skipped++;
    continue;
  }
  const status = (asciiStatus || unicodeStatus).replace(/^\[|\]$/g, "").split(",").map((code) => code.trim()).filter((code) => code && code !== "X4_2");
  run++;
  if (idnHostname(input) !== (status.length === 0)) wrong.push(`${JSON.stringify(input)} (${status.join(", ") || "valid"})`);
}
if (wrong.length) failed = true;
console.log(`IdnaTestV2.txt: ${run} lines run, ${wrong.length} with another verdict${wrong.length ? `: ${wrong.slice(0, 20).join(", ")}` : ""}; ${skipped} skipped for an NV8 or XV8 code point`);
console.log(`Unicode ${process.versions.unicode}, ${found.size} regular expressions read from src/formats/idn-hostname.cjs`);
process.exitCode = failed ? 1 : 0;
