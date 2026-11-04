// The comparisons the keywords make, as ajv 8.20.0 makes them, so a value gets the verdict it got.

/**
 * Deep equality for `const`, `enum` and `uniqueItems`: fast-deep-equal 3.1.3's algorithm, which ajv
 * runs (`ajv/dist/runtime/equal`), rewritten here with its behavior kept, a throw included where an
 * object's `valueOf` is not a function (ajv-validator/ajv#2624). fast-deep-equal is MIT, Copyright
 * (c) 2017 Evgeny Poberezkin.
 */
export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (a && b && typeof a == "object" && typeof b == "object") {
    if (a.constructor !== b.constructor) return false;
    let length: number;
    let i: number;
    if (Array.isArray(a)) {
      length = a.length;
      if (length != b.length) return false;
      for (i = length; i-- !== 0; ) if (!equal(a[i], b[i])) return false;
      return true;
    }
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
    const keys = Object.keys(a);
    length = keys.length;
    if (length !== Object.keys(b).length) return false;
    for (i = length; i-- !== 0; ) if (!Object.prototype.hasOwnProperty.call(b, keys[i]!)) return false;
    for (i = length; i-- !== 0; ) {
      const key = keys[i]!;
      if (!equal(a[key], b[key])) return false;
    }
    return true;
  }
  // true if both NaN, false otherwise
  return a !== a && b !== b;
}

/** A string's length in Unicode code points, as `minLength` and `maxLength` count it (ajv's `ucs2length`, after punycode.js's `ucs2.decode`). */
export function ucs2length(str: string): number {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value: number;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}
