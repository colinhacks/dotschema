// URI references and JSON Pointers, as the engine resolves `$id` and `$ref` with them: RFC 3986's
// reference resolution (section 5.2), which a URN or an opaque base such as `dotschema:0` allows as
// well as a URL, and RFC 6901's pointers in a URI fragment. No dependency and no Node API, so the
// engine runs in a browser or a Worker.

/** A URI reference's parts (RFC 3986 appendix B), each undefined when absent. */
const PARTS = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

/** A path without its `.` and `..` segments (RFC 3986 5.2.4). */
function withoutDots(path: string): string {
  const out: string[] = [];
  let input = path;
  while (input) {
    if (input.startsWith("../")) input = input.slice(3);
    else if (input.startsWith("./")) input = input.slice(2);
    else if (input.startsWith("/./")) input = input.slice(2);
    else if (input === "/.") input = "/";
    else if (input.startsWith("/../") || input === "/..") {
      input = input === "/.." ? "/" : input.slice(3);
      out.pop();
    } else if (input === "." || input === "..") input = "";
    else {
      const end = input.indexOf("/", input.startsWith("/") ? 1 : 0);
      out.push(end === -1 ? input : input.slice(0, end));
      input = end === -1 ? "" : input.slice(end);
    }
  }
  return out.join("");
}

/** `ref` resolved against the absolute URI `base` (RFC 3986 5.2.2), its scheme in lower case. */
export function resolveUri(base: string, ref: string): string {
  const r = PARTS.exec(ref)!;
  const b = PARTS.exec(base)!;
  let [scheme, authority, path, query] = [r[1], r[2], r[3]!, r[4]];
  if (scheme === undefined) {
    scheme = b[1];
    if (authority === undefined) {
      authority = b[2];
      if (path === "") {
        path = b[3]!;
        query ??= b[4];
      } else if (!path.startsWith("/")) {
        const basePath = b[3]!;
        path = b[2] !== undefined && basePath === "" ? `/${path}` : basePath.slice(0, basePath.lastIndexOf("/") + 1) + path;
      }
    }
  }
  return `${scheme === undefined ? "" : `${scheme.toLowerCase()}:`}${authority === undefined ? "" : `//${authority}`}${withoutDots(path)}${query === undefined ? "" : `?${query}`}${r[5] === undefined ? "" : `#${r[5]}`}`;
}

/** A URI without its fragment, and its fragment, `""` when it has none. */
export function splitUri(uri: string): [base: string, fragment: string] {
  const hash = uri.indexOf("#");
  return hash === -1 ? [uri, ""] : [uri.slice(0, hash), uri.slice(hash + 1)];
}

/** A fragment's JSON Pointer segments, each percent-decoded and unescaped as ajv reads one (`unescapeFragment`); undefined for a malformed one. */
export function pointerSegments(fragment: string): string[] | undefined {
  if (fragment === "") return [];
  if (fragment[0] !== "/") return undefined;
  try {
    return fragment
      .slice(1)
      .split("/")
      .map((raw) => decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return undefined;
  }
}

/** A key as a JSON Pointer segment (RFC 6901), the way an error's `instancePath` writes it. */
export const escapePointer = (key: string | number): string => (typeof key === "number" ? String(key) : key.replace(/~/g, "~0").replace(/\//g, "~1"));

/**
 * `encodeURIComponent`, but a lone surrogate, which it refuses with a `URIError` and UTF-8 cannot
 * write, is left as it is. JSON gives a key one (`"\ud800"`), and a `$ref` can name that key only by
 * writing the surrogate itself, which `pointerSegments` reads back, as `decodeURIComponent` passes a
 * character it does not decode; ajv 8.20.0 gives no path of its own to keep for such a key, since it
 * throws that `URIError` compiling one in `properties`, `patternProperties` or `dependentSchemas`
 * and resolves no `$ref` to one (its URI parser makes the surrogate U+FFFD).
 */
export function encodeComponent(text: string): string {
  try {
    return encodeURIComponent(text);
  } catch {
    return text.replace(/[^]/gu, (c) => (c.length === 1 && c >= "\ud800" && c <= "\udfff" ? c : encodeURIComponent(c)));
  }
}

/** A key as a segment of a URI fragment, the way ajv writes an error's `schemaPath` (`escapeFragment`), a lone surrogate left as it is (`encodeComponent`). */
export const escapeFragment = (key: string | number): string => (typeof key === "number" ? String(key) : encodeComponent(escapePointer(key)));
