import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createProcessor } from '@mdx-js/mdx';
import { diagnosticDirective, type Diagnostic } from 'docs-kit/diagnostics';
import { remarkCodeTab } from 'fumadocs-core/mdx-plugins';
import { pageFiles } from './page-files.ts';

// Every type and every error the page shows is dotschema's own, run at build time on the page's own
// example files by scripts/dotschema.ts, which runs the repository's src/:
//
// - The hovers. Twoslash runs TypeScript's JavaScript API (6.0, from fumadocs-twoslash), which
//   cannot run a content mapper. So each `ts twoslash` block that imports a schema file shown on the
//   page (a code block titled `user.schema.jsonc`, or a code tab of that name) gets, as hidden files,
//   the modules dotschema's mapper returns for those files and for every schema file their modules
//   import in turn, a `$ref` to another file being an import: `user.schema.d.jsonc.ts`, which
//   `./user.schema.jsonc` resolves to under allowArbitraryExtensions. The files are written to a
//   directory of their own first, since a `$ref` is followed on disk. A file a block sees is the
//   block itself or the nearest block above it with that name, across all the page's files, so a
//   section can show a file another section shows, or a file again with a change; failing that, the
//   first one below it, as in a group of tabs whose first tab is main.ts. A schema file with a
//   problem fails the build.
// - The errors. A schema block marked `errors` (```` ```jsonc title="team.schema.jsonc" errors ````)
//   is an error example: the content mapper's own `transform` reads it, beside the page's other files,
//   and each diagnostic it returns is written into the block as docs-kit's `// @diagnostic:` line,
//   which docs-kit draws as a red squiggle under its range and its message, `dotschema(<code>)` after
//   it, in a card pinned under the line. An example without a diagnostic fails the build, and an
//   error example is no file an import resolves to.
// - The formats. Each table headed Format and A value it accepts lists formats, one or more to a
//   row, each as inline code; a row of one format gives, as inline code, a value it accepts. The
//   tables of a page file together must name every format dotschema has, each once, and each value
//   must pass the module dotschema builds for that format, or the build fails.
// - The keywords. A table headed Keyword lists keywords, one or more to a row, each as inline code.
//   The tables of a page file together must name every keyword of the drafts dotschema reads, each
//   once, or the build fails, so the page says what each keyword does however ajv grows.
// - The bundle. A block marked `bundle="main.ts"` holds esbuild's analysis of the page's first block
//   of that name, the opening example's, bundled and minified with dotschema's esbuild plugin beside
//   the schema files it sees. The build measures it again and fails, printing the new analysis,
//   when the block's text differs, so the page, and /llms.txt, which is read from the page's files,
//   say what dotschema's src/ gives now.
// - The Inference cards. An `<Inferred>` element around a schema block is a card of the Inference
//   section (components/inferred.tsx): its children become two labelled rows, the block as the
//   Schema, without its title bar (the block's `title` still names the file it is, and is taken off
//   only once every block has seen it), and as the Type the declarations of the module dotschema
//   gives that file, without the module's imports, its re-export as `Type`, the schema's own text
//   and the values, the root first as its bare type (`string | number`, `{ ... }`), named only
//   where the types refer to it or it has a doc comment, and each definition it uses declared by
//   its name. A schema with a problem, or a type wider than a code line may be, fails the build.

type Node = {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  data?: { tab?: string };
  name?: string | null;
  attributes?: { type: string; name: string; value: string | null }[];
  children?: Node[];
};
type Code = Node & { value: string };
type File = { name: string; text: string };

function codeBlocks(node: Node, out: Code[] = []): Code[] {
  if (node.type === 'code') out.push(node as Code);
  for (const child of node.children ?? []) codeBlocks(child, out);
  return out;
}

/** The `<Inferred>` cards of a tree (components/inferred.tsx). */
function inferredCards(node: Node, out: Node[] = []): Node[] {
  for (const child of node.children ?? []) {
    if (child.type === 'mdxJsxFlowElement' && child.name === 'Inferred') out.push(child);
    else inferredCards(child, out);
  }
  return out;
}

const jsx = (name: string, attributes: [string, string][], children: Node[]): Node => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: attributes.map(([key, value]) => ({ type: 'mdxJsxAttribute', name: key, value })),
  children,
});

/**
 * The declarations a schema's module gives its root and its definitions, as a card's Type row shows
 * them: the text before the schema's own (`type Json`), without the imports, the re-export as
 * `Type`, or `export` before a definition's declaration, and the root as its bare type (`bare`).
 */
function declarations(types: string): string {
  const end = types.search(/^\/\*\* The JSON Schema as written|^type Json = /m);
  const lines = (end < 0 ? types : types.slice(0, end)).split('\n');
  // The module names its root for the file and exports it as `Type` (`export type { Id as Type };`),
  // or names it `Type` itself when the file is named so.
  const root = lines.map((line) => /^export type \{ (\w+) as Type \};$/.exec(line)?.[1]).find(Boolean) ?? 'Type';
  const text = lines
    .filter((line) => !/^import type /.test(line) && !/^export type \{ \w+ as Type \};$/.test(line))
    .join('\n')
    .replace(/^export (?=interface |type )/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return bare(text, root);
}

/**
 * The declarations with the root's written as its bare type, first: `string | number` for
 * `type Id = string | number;`, `{ ... }` for `interface Profile { ... }`. The root keeps its name
 * where the types refer to it, as a recursive schema's do, and where it carries a doc comment, which
 * reads oddly above a bare type.
 */
function bare(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `interface ${name} {` || line.startsWith(`type ${name} = `));
  if (start < 0 || lines[start - 1]?.trimEnd().endsWith('*/')) return text;
  // A declaration ends on the first line at its own indent that closes it.
  const end = /^type .*;$/.test(lines[start]!) ? start : lines.findIndex((line, i) => i > start && /^\S/.test(line) && /[;}]$/.test(line));
  if (end < 0) return text;
  const own = lines.slice(start, end + 1).join('\n');
  const head = own.startsWith('interface ') ? `interface ${name} ` : `type ${name} = `;
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n').trim();
  if (new RegExp(`\\b${name}\\b`).test(`${own.slice(head.length)}\n${rest}`)) return text;
  const type = own.slice(head.length).replace(/;$/, '');
  return rest ? `${type}\n\n${rest}` : type;
}

/** The file TypeScript looks up for `./name.ext` under allowArbitraryExtensions. */
function declarationName(file: string): string {
  const dot = file.lastIndexOf('.');
  return `${file.slice(0, dot)}.d${file.slice(dot)}.ts`;
}

/** A block's file name: its `title`, or its `tab` in a group of code tabs (Fumadocs' remarkCodeTab moves `tab` into `data`). */
const titleOf = (node: Code) => /title="([^"]+)"/.exec(node.meta ?? '')?.[1] ?? node.data?.tab;

const SCHEMA = /\.schema\.(?:jsonc|json5)$/;
const isErrors = (node: Code) => /(?:^|\s)errors(?:\s|$)/.test(node.meta ?? '');
/** The file a bundle block analyses (`bundle="main.ts"`), if the block is one. */
const bundleOf = (node: Code) => /(?:^|\s)bundle="([^"]+)"/.exec(node.meta ?? '')?.[1];

/** A Twoslash block's code as a reader copies it: from its cut, without Twoslash's notes and queries. */
function plainCode(value: string): string {
  const cut = value.lastIndexOf('// ---cut---\n');
  const code = cut < 0 ? value : value.slice(cut + '// ---cut---\n'.length);
  return `${code
    .split('\n')
    .filter((line) => !/^\s*\/\/\s*(?:@\w|\^\?)/.test(line))
    .join('\n')}\n`;
}

/**
 * The widest line a code block may have, in characters: what the narrowest block of the page holds
 * on a desktop screen, the editors' settings files in their tabs, 60 (measured on 2026-10-27 in the
 * headless shell at 1280 pixels wide, Geist Mono at 8.73 pixels a character; most blocks hold 67,
 * and a phone 35). A wider line wraps, in the middle of a JSON object as often as not. Terminal
 * output (`ansi`) is tsc's own text and is left as tsc prints it.
 */
const WIDEST = 60;

/** The lines of a block, as a reader sees them, that are wider than WIDEST. */
function tooWide(node: Code): string[] {
  if (node.lang === 'ansi') return [];
  const shown = node.meta?.includes('twoslash') ? plainCode(node.value) : node.value;
  return shown
    .split('\n')
    .map((line) => line.replace(/\s*\/\/\s*\[!code [^\]]+\]\s*$/, ''))
    .filter((line) => line.length > WIDEST);
}

/** A text's lines without the blank lines around them or the spaces after each. */
const trimmedLines = (text: string) => text.split('\n').map((line) => line.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
/** A schema file the page shows: an import resolves to it. */
const isSchema = (node: Code) => SCHEMA.test(titleOf(node) ?? '') && !isErrors(node);

// `import user from "./user.schema.jsonc"`, `import { address } from "./shared/place.schema.jsonc"`.
const IMPORT = /\bfrom\s+["']\.\/([^"']+\.schema\.(?:jsonc|json5))["']/g;

/** A file of the page as Fumadocs has it when this plugin runs: MDX parsed, then code tabs grouped. */
function parse(file: string): Node {
  // fumadocs-mdx takes the frontmatter off before it parses.
  const text = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, (m) => '\n'.repeat(m.split('\n').length - 1));
  const processor = createProcessor();
  const tree = processor.parse(text) as unknown as Node;
  (remarkCodeTab as unknown as (this: unknown) => (tree: Node) => void).call(processor)(tree);
  return tree;
}

const parsed = new Map<string, { stamp: string; blocks: Code[] }>();

/** The code blocks of one of the page's other files, parsed again only when the file changes. */
function blocksOf(file: string): Code[] {
  const stat = statSync(file);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  const hit = parsed.get(file);
  if (hit?.stamp === stamp) return hit.blocks;
  const blocks = codeBlocks(parse(file));
  parsed.set(file, { stamp, blocks });
  return blocks;
}

/** The text of a node and its children. */
const textOf = (node: Node): string => node.value ?? (node.children ?? []).map(textOf).join('');
/** The inline code in a node, in order. */
const inlineCode = (node: Node): string[] => (node.type === 'inlineCode' ? [node.value ?? ''] : (node.children ?? []).flatMap(inlineCode));

function tables(node: Node, out: Node[] = []): Node[] {
  if (node.type === 'table') out.push(node);
  for (const child of node.children ?? []) tables(child, out);
  return out;
}

/** The UTF-16 index of a UTF-8 byte offset into a text. */
function indexOfByte(text: string, byte: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    if (bytes >= byte) return i;
    const code = text.codePointAt(i)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (code >= 0x10000) i++;
  }
  return text.length;
}

/** A position, from 1, as an editor counts it. */
function positionAt(text: string, index: number): Diagnostic['start'] {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - (before.lastIndexOf('\n') + 1) + 1 };
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

type Answer = {
  projects: Record<string, { types: string; problems: string[] }>[];
  diagnostics: { messageText: string; code: number; start: number; length: number }[][];
  formats?: { all: string[]; verdicts: { format: string; ok: boolean; why: string }[] };
  keywords?: string[];
  bundles: string[];
};

/** What dotschema answered for a request, kept for as long as the dev server runs. */
const answers = new Map<string, Answer>();

function ask(site: string, request: object): Answer {
  const key = hash(request);
  const hit = answers.get(key);
  if (hit) return hit;
  const output = execFileSync(process.execPath, [path.join(site, 'scripts/dotschema.ts')], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const answer = JSON.parse(output) as Answer;
  answers.set(key, answer);
  return answer;
}

export function remarkSchemas() {
  // The build runs in site/.
  const site = process.cwd();
  const cache = path.join(site, 'node_modules/.cache/dotschema-site');
  return (tree: Node, file: { path?: string; data?: Record<string, unknown> }) => {
    // The page is several files, shown in order (lib/page-files.ts): its opening, then a file per
    // section, which are one page here.
    const own = codeBlocks(tree);
    const wide = own.flatMap((node) => tooWide(node).map((line) => `${titleOf(node) ?? node.lang}: ${line.trim()}`));
    if (wide.length) throw new Error(`dotschema: code lines wider than ${WIDEST} characters wrap on the page (${file.path}):\n${wide.join('\n')}`);
    const page = pageFiles(site);
    const at = file.path ? page.indexOf(path.resolve(file.path)) : -1;
    const around = (list: string[]) => list.flatMap((f) => blocksOf(f).map((node) => ({ node, file: f as string | undefined })));
    const before = at < 0 ? [] : around(page.slice(0, at));
    const blocks = [...before, ...own.map((node) => ({ node, file: undefined as string | undefined })), ...(at < 0 ? [] : around(page.slice(at + 1)))];
    const compiler = file.data?._compiler as { addDependency(file: string): void } | undefined;

    /** Every schema file of the page as a block at `index` sees it, and the other page files it came from. */
    const filesAt = (index: number): File[] => {
      const names = [...new Set(blocks.filter((b) => isSchema(b.node)).map((b) => titleOf(b.node)!))];
      return names.map((name) => {
        const isFile = (block: (typeof blocks)[number]) => isSchema(block.node) && titleOf(block.node) === name;
        const shown = blocks.slice(0, index + 1).findLast(isFile) ?? blocks.slice(index + 1).find(isFile)!;
        // A file another section shows is a dependency, so an edit to it types this section again.
        if (shown.file) compiler?.addDependency(shown.file);
        return { name, text: `${shown.node.value}\n` };
      });
    };

    const typed: { node: Code; project: number }[] = [];
    const cards: { card: Node; node: Code; name: string; project: number }[] = [];
    const errors: { node: Code; item: number; text: string }[] = [];
    const bundles: { node: Code; item: number }[] = [];
    const request: { projects: object[]; diagnostics: object[]; bundles: object[]; formats?: { format: string; example: string }[]; keywords?: boolean } = { projects: [], diagnostics: [], bundles: [] };
    own.forEach((node, i) => {
      const index = before.length + i;
      if (node.lang === 'ts' && node.meta?.includes('twoslash')) {
        const entries = [...new Set([...node.value.matchAll(IMPORT)].map((m) => path.posix.normalize(m[1]!)))];
        if (!entries.length) return;
        const files = filesAt(index);
        typed.push({ node, project: request.projects.push({ dir: path.join(cache, 'projects', hash(files)), files, entries }) - 1 });
      } else if (isErrors(node)) {
        const name = titleOf(node);
        if (!name || !SCHEMA.test(name)) throw new Error(`dotschema: an error example needs a schema file's name as its title (${file.path})`);
        const files = filesAt(index).filter((f) => f.name !== name);
        const text = `${node.value}\n`;
        errors.push({ node, text, item: request.diagnostics.push({ dir: path.join(cache, 'errors', hash([files, name, text])), files, file: { name, text } }) - 1 });
      } else if (bundleOf(node)) {
        const name = bundleOf(node)!;
        const at = blocks.findIndex((b) => titleOf(b.node) === name);
        if (at < 0) throw new Error(`dotschema: the bundle block names ${name}, which no block of the page is (${file.path})`);
        const entry = blocks[at]!;
        if (entry.file) compiler?.addDependency(entry.file);
        const files = filesAt(at);
        const text = plainCode(entry.node.value);
        bundles.push({ node, item: request.bundles.push({ dir: path.join(cache, 'bundles', hash([files, name, text])), files, entry: { name, text } }) - 1 });
      }
    });

    for (const card of inferredCards(tree)) {
      const node = (card.children ?? []).find((child) => child.type === 'code' && isSchema(child as Code)) as Code | undefined;
      if (!node) throw new Error(`dotschema: an <Inferred> card needs a schema block, a \`jsonc\` block titled \`<name>.schema.jsonc\` (${file.path})`);
      const name = titleOf(node)!;
      const files = filesAt(before.length + own.indexOf(node));
      cards.push({ card, node, name, project: request.projects.push({ dir: path.join(cache, 'projects', hash(files)), files, entries: [name] }) - 1 });
    }

    // The format tables (above): each row's formats, and the value a row of one format gives.
    const header = (table: Node) => (table.children?.[0]?.children ?? []).map((cell) => textOf(cell).trim());
    const formatRows = tables(tree)
      .filter((table) => /^Formats?$/.test(header(table)[0] ?? '') && header(table)[1] === 'A value it accepts')
      .flatMap((table) => (table.children ?? []).slice(1))
      .map((row) => ({ formats: inlineCode(row.children?.[0] ?? { type: 'text' }), examples: inlineCode(row.children?.[1] ?? { type: 'text' }) }));
    if (formatRows.length) {
      request.formats = formatRows.flatMap((row) => (row.formats.length === 1 && row.examples.length === 1 ? [{ format: row.formats[0]!, example: row.examples[0]! }] : []));
    }

    // The keyword tables (above): each row's keywords.
    const keywordRows = tables(tree)
      .filter((table) => /^Keywords?$/.test(header(table)[0] ?? ''))
      .flatMap((table) => (table.children ?? []).slice(1))
      .map((row) => inlineCode(row.children?.[0] ?? { type: 'text' }));
    if (keywordRows.length) request.keywords = true;

    if (!typed.length && !cards.length && !errors.length && !bundles.length && !formatRows.length && !keywordRows.length) return;
    const answer = ask(site, request);

    for (const { node, project } of typed) {
      const modules = answer.projects[project]!;
      for (const [name, module] of Object.entries(modules)) {
        if (module.problems.length) throw new Error(`dotschema: ${name}: ${module.problems.join('; ')} (${file.path})`);
      }
      const hidden = Object.entries(modules)
        .map(([name, module]) => `// @filename: ${declarationName(name)}\n${module.types}`)
        .join('');
      // The block's own code follows the hidden files as a file of its own, cut above its first line
      // unless the block places the cut itself.
      const code = node.value.includes('---cut---') ? node.value : `// ---cut---\n${node.value}`;
      node.value = `${hidden}// @filename: ${titleOf(node) ?? 'main.ts'}\n${code}`;
    }

    for (const { card, node, name, project } of cards) {
      const module = answer.projects[project]![name]!;
      if (module.problems.length) throw new Error(`dotschema: ${name}: ${module.problems.join('; ')} (${file.path})`);
      const type = declarations(module.types);
      const wider = type.split('\n').filter((line) => line.length > WIDEST);
      if (wider.length) throw new Error(`dotschema: the type of ${name}'s card has lines wider than ${WIDEST} characters (${file.path}):\n${wider.join('\n')}`);
      // The card's Schema label stands in for the block's title bar, so the file name, which placed
      // the file for every block of the page above, is taken off the block here.
      node.meta = (node.meta ?? '').replace(/(?:^|\s+)title="[^"]*"/, '').trim() || null;
      card.children = [
        jsx('InferredRow', [['label', 'Schema']], [node]),
        jsx('InferredTypes', [], [jsx('InferredRow', [['label', 'Type']], [{ type: 'code', lang: 'ts', meta: null, value: type }])]),
      ];
    }

    for (const { node, item, text } of errors) {
      const diagnostics = answer.diagnostics[item]!;
      if (!diagnostics.length) throw new Error(`dotschema: the error example ${titleOf(node)} has no error (${file.path})`);
      const lines = diagnostics.map((d) => {
        const start = indexOfByte(text, d.start);
        return diagnosticDirective({ start: positionAt(text, start), end: positionAt(text, indexOfByte(text, d.start + d.length)), source: `dotschema(${d.code})`, message: d.messageText });
      });
      // Before the block's text, so that taking the lines out leaves the text as it was.
      node.value = `${lines.join('\n')}\n${node.value}`;
    }

    for (const { node, item } of bundles) {
      const analysis = trimmedLines(answer.bundles[item]!);
      if (trimmedLines(node.value) !== analysis) throw new Error(`dotschema: the bundle block of ${file.path} is not what esbuild gives now, which is:\n${analysis}`);
    }

    if (answer.formats) {
      const listed = formatRows.flatMap((row) => row.formats);
      const twice = listed.filter((name, i) => listed.indexOf(name) !== i);
      const missing = answer.formats.all.filter((name) => !listed.includes(name));
      const unknown = listed.filter((name) => !answer.formats!.all.includes(name));
      const refused = answer.formats.verdicts.filter((v) => !v.ok).map((v) => `${v.format}: ${v.why}`);
      const faults = [
        ...(missing.length ? [`not listed: ${missing.join(', ')}`] : []),
        ...(unknown.length ? [`not formats of dotschema's: ${unknown.join(', ')}`] : []),
        ...(twice.length ? [`listed twice: ${twice.join(', ')}`] : []),
        ...refused,
      ];
      if (faults.length) throw new Error(`dotschema: the format tables of ${file.path}: ${faults.join('; ')}`);
    }

    if (answer.keywords) {
      const listed = keywordRows.flat();
      const twice = listed.filter((name, i) => listed.indexOf(name) !== i);
      const missing = answer.keywords.filter((name) => !listed.includes(name));
      const unknown = listed.filter((name) => !answer.keywords!.includes(name));
      const faults = [
        ...(missing.length ? [`not listed: ${missing.join(', ')}`] : []),
        ...(unknown.length ? [`not keywords of a draft dotschema reads: ${unknown.join(', ')}`] : []),
        ...(twice.length ? [`listed twice: ${twice.join(', ')}`] : []),
      ];
      if (faults.length) throw new Error(`dotschema: the keyword tables of ${file.path}: ${faults.join('; ')}`);
    }
  };
}
