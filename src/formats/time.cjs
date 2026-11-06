// The format `time`: a full-time of RFC 3339 (section 5.6), with its offset, and its order for
// formatMinimum and the other limit keywords. After ajv-formats' `time`, changed by dotschema where
// the JSON Schema Test Suite refuses what it accepted or accepts what it refused: an offset is
// `Z` or `+hh:mm` (ajv-formats took `+01` and `+0130`), a leap second is a second of 60 at
// 23:59 UTC alone (ajv-formats took any time it read as 23:59 UTC with its offset, so `24:59:00+01:00`
// and `23:60:00+00:01`), and the fraction of a second is not read (ajv-formats read the seconds as a
// number, so 59.999999999999999 was 60). The order is ajv-formats' `compareTime`, unchanged.
//
// Copied from ajv-formats 3.0.1 (dist/formats.js), under its license:
//
// MIT License
//
// Copyright (c) 2020 Evgeny Poberezkin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
"use strict";
const TIME = /^(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:z|([+-])(\d\d):(\d\d))$/i;
function time(str) {
  const matches = TIME.exec(str);
  if (!matches) return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[4] === "-" ? -1 : 1;
  const tzH = +(matches[5] || 0);
  const tzM = +(matches[6] || 0);
  if (tzH > 23 || tzM > 59 || hr > 23 || min > 59 || sec > 60) return false;
  if (sec < 60) return true;
  // leap second: 23:59:60 in UTC
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1);
}
function compareTime(s1, s2) {
  if (!(s1 && s2)) return undefined;
  const t1 = new Date("2020-01-01T" + s1).valueOf();
  const t2 = new Date("2020-01-01T" + s2).valueOf();
  if (!(t1 && t2)) return undefined;
  return t1 - t2;
}
module.exports = { validate: time, compare: compareTime };
