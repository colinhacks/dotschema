import type { getHighlighter } from 'fumadocs-core/highlight';

type Highlighter = Awaited<ReturnType<typeof getHighlighter>>;
type Theme = ReturnType<Highlighter['getTheme']>;

/** The colours of a code theme, by role. */
export type CodePalette = {
  /** Identifiers, properties, functions and types: the ink. */
  text: string;
  /** TypeScript's keywords, set a weight heavier by app/global.css. */
  keyword: string;
  /** Strings, in JSON and TypeScript alike, a key aside. */
  string: string;
  /** Numbers, `true`, `false`, `null` and `undefined`. */
  number: string;
  /** A JSON or JSON5 object's key. */
  key: string;
  /** JSON's braces, brackets, colons and commas. */
  punctuation: string;
  comment: string;
  /** A terminal's cyan and red (`ansi` blocks: tsc's file name and "error"). */
  cyan: string;
  red: string;
};

/**
 * Monolith's code, the site's palette: ink on paper with Zod's blue on TypeScript's keywords, and in
 * a schema the key in a deep blue, the string a green and a number or literal an amber, its braces
 * and commas grey. TypeScript shares the string, number and literal colours, so a type's `"admin"`
 * is the schema's. Measured as WCAG contrast on the light code block (#fbfbfa) and on an Inference
 * card's Type band (#efefec), the lighter of the light theme's grounds and the darker; and on the
 * dark code block (#121213), the band (#18181a) and a popup (#1c1c1e); the light theme's ink cards
 * paint the dark colours on #0b0b0c, where each is higher still:
 *
 *   by day     keyword #2b55ee 5.58 / 5.01   key #1f3fae 8.69 / 7.81   string #167046 5.90 / 5.30
 *              number #9c4a0c 5.97 / 5.36    punctuation #6a6a6a 5.22 / 4.69   comment #6a6a6a
 *   by night   keyword #6f95ff 6.61 / 6.26 / 6.01   key #9db6ff 9.48 / 8.98 / 8.61
 *              string #6fcf97 9.85 / 9.33 / 8.95    number #f0a35a 9.00 / 8.52 / 8.18
 *              punctuation #8a8a8a 5.42 / 5.14 / 4.93   comment #8a8a8a
 *   a terminal  cyan #0b6e6e 5.85 and red #cb2431 5.29 by day, #56d4dd 10.57 and #f97583 7.04 by night
 *
 * The keyword's blue was #3060ff by day until 2026-10-27, 4.78:1 on the block and 4.30:1 on the band.
 */
export const monolith: { light: CodePalette; dark: CodePalette } = {
  light: {
    text: '#1a1a1a',
    keyword: '#2b55ee',
    string: '#167046',
    number: '#9c4a0c',
    key: '#1f3fae',
    punctuation: '#6a6a6a',
    comment: '#6a6a6a',
    cyan: '#0b6e6e',
    red: '#cb2431',
  },
  dark: {
    text: '#e9e9e9',
    keyword: '#6f95ff',
    string: '#6fcf97',
    number: '#f0a35a',
    key: '#9db6ff',
    punctuation: '#8a8a8a',
    comment: '#8a8a8a',
    cyan: '#56d4dd',
    red: '#f97583',
  },
};

type Role = 'text' | 'keyword' | 'string' | 'comment';

/**
 * Each colour of Shiki's GitHub themes by the role it plays: GitHub gives a constant, a property, a
 * function, a type, a variable and a tag their own colours, which Monolith paints as ink; its
 * `constant` colour covers a JSON key and a number alike, which the rules of `schemaRules` split.
 */
const roles: Record<'github-light' | 'github-dark', Record<string, Role>> = {
  'github-light': {
    '#d73a49': 'keyword',
    '#24292e': 'text',
    '#032f62': 'string',
    '#005cc5': 'text',
    '#6f42c1': 'text',
    '#6a737d': 'comment',
    '#e36209': 'text',
    '#22863a': 'text',
  },
  'github-dark': {
    '#f97583': 'keyword',
    '#e1e4e8': 'text',
    '#9ecbff': 'string',
    '#dbedff': 'string',
    '#79b8ff': 'text',
    '#b392f0': 'text',
    '#6a737d': 'comment',
    '#ffab70': 'text',
    '#85e89d': 'text',
  },
};

/**
 * The rules added after GitHub's, by TextMate scope, each more specific than the GitHub rule it
 * overrides: a key of JSON and JSONC (`support.type.property-name.json`, `.json.comments`) and of
 * JSON5 (`string.key.json5`); numbers and `true`, `false` and `null` in every language; JSON's
 * punctuation. A quoted JSON5 key is `string.quoted.json5` in Shiki's grammar, a string.
 */
function schemaRules(palette: CodePalette): Theme['settings'] {
  return [
    {
      scope: ['support.type.property-name', 'string.key.json5'],
      settings: { foreground: palette.key },
    },
    {
      scope: ['constant.numeric', 'constant.dec.numeric', 'constant.hex.numeric', 'constant.language'],
      settings: { foreground: palette.number },
    },
    {
      scope: [
        'punctuation.definition.dictionary',
        'punctuation.separator.dictionary',
        'punctuation.definition.array',
        'punctuation.separator.array',
      ],
      settings: { foreground: palette.punctuation },
    },
  ];
}

function recolor(base: Theme, palette: CodePalette, name: string): Theme {
  const byRole = roles[base.name as keyof typeof roles];
  const paint = (color: string | undefined) => {
    const role = color && byRole[color.toLowerCase()];
    return role ? palette[role] : color;
  };
  return {
    ...base,
    name,
    fg: paint(base.fg) ?? base.fg,
    colors: {
      ...base.colors,
      'editor.foreground': paint(base.colors?.['editor.foreground']) ?? base.fg,
      'terminal.ansiRed': palette.red,
      'terminal.ansiBrightRed': palette.red,
      'terminal.ansiYellow': palette.number,
      'terminal.ansiBrightYellow': palette.number,
      'terminal.ansiGreen': palette.string,
      'terminal.ansiBrightGreen': palette.string,
      'terminal.ansiCyan': palette.cyan,
      'terminal.ansiBrightCyan': palette.cyan,
      'terminal.ansiBrightBlack': palette.comment,
    },
    settings: [
      ...base.settings.map((rule) => ({ ...rule, settings: { ...rule.settings, foreground: paint(rule.settings.foreground) } })),
      ...schemaRules(palette),
    ],
  };
}

/**
 * The page's two Shiki themes, Shiki's GitHub themes painted in a palette: each GitHub colour by its
 * role, then the rules that give a schema its keys, numbers and punctuation. A terminal (`ansi`
 * blocks) is painted from the theme's `terminal.ansi*` colours, the ones tsc uses set here: its
 * yellow line and column the number's colour, its grey the comment's, its cyan and red the palette's.
 * GitHub's light cyan, yellow and grey were 3.48, 3.19 and 2.65:1 on the code block.
 */
export async function codeThemes(palette = monolith): Promise<{ light: Theme; dark: Theme }> {
  const { getHighlighter } = await import('fumadocs-core/highlight');
  const highlighter = await getHighlighter('js', { themes: ['github-light', 'github-dark'] });
  return {
    light: recolor(highlighter.getTheme('github-light'), palette.light, 'monolith-light'),
    dark: recolor(highlighter.getTheme('github-dark'), palette.dark, 'monolith-dark'),
  };
}
