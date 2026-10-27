// The format `iso-time`: a time whose offset may be left out, ajv-formats' own format, and its order
// for formatMinimum and the other limit keywords. ajv-formats' `iso-time` and `compareIsoTime`, unchanged.
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
const TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
function time(str) {
  const matches = TIME.exec(str);
  if (!matches) return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[5] === "-" ? -1 : 1;
  const tzH = +(matches[6] || 0);
  const tzM = +(matches[7] || 0);
  if (tzH > 23 || tzM > 59) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  // leap second
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}
function compareIsoTime(t1, t2) {
  if (!(t1 && t2)) return undefined;
  const a1 = TIME.exec(t1);
  const a2 = TIME.exec(t2);
  if (!(a1 && a2)) return undefined;
  t1 = a1[1] + a1[2] + a1[3];
  t2 = a2[1] + a2[2] + a2[3];
  if (t1 > t2) return 1;
  if (t1 < t2) return -1;
  return 0;
}
module.exports = { validate: time, compare: compareIsoTime };
