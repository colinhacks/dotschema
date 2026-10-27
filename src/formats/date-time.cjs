// The format `date-time`: a date-time of RFC 3339 (section 5.6), a full-date, `T` and a full-time
// (./date.cjs, ./time.cjs), and its order for formatMinimum and the other limit keywords. After
// ajv-formats' `date-time`, changed by dotschema: its time is dotschema's `time`, and the date and
// the time are separated by `T` or `t`, as RFC 3339's grammar has it (ajv-formats also took any
// white space, a space, a tab or a line break). The order is ajv-formats' `compareDateTime`, unchanged.
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
const date = require("./date.cjs").validate;
const time = require("./time.cjs").validate;
const DATE_TIME_SEPARATOR = /t/i;
function date_time(str) {
  // http://tools.ietf.org/html/rfc3339#section-5.6
  const dateTime = str.split(DATE_TIME_SEPARATOR);
  return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
}
function compareDateTime(dt1, dt2) {
  if (!(dt1 && dt2)) return undefined;
  const d1 = new Date(dt1).valueOf();
  const d2 = new Date(dt2).valueOf();
  if (!(d1 && d2)) return undefined;
  return d1 - d2;
}
module.exports = { validate: date_time, compare: compareDateTime };
