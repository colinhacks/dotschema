// The format `regex`: a regular expression the JavaScript engine reads, without `\Z`. ajv-formats' `regex`,
// unchanged. It builds the expression with `new RegExp`, which is not code generation from strings, so it
// runs where `new Function` and `eval` are refused (workerd, a Content Security Policy without unsafe-eval).
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
const Z_ANCHOR = /[^\\]\\Z/;
function regex(str) {
  if (Z_ANCHOR.test(str)) return false;
  try {
    new RegExp(str);
    return true;
  } catch (e) {
    return false;
  }
}
module.exports = regex;
