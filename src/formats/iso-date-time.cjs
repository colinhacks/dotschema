// The format `iso-date-time`: a date and an `iso-time` (./iso-time.cjs) separated by `T` or white space,
// ajv-formats' own format, and its order for formatMinimum and the other limit keywords, which compares
// the times as `time` does (./time.cjs). ajv-formats' `iso-date-time` and `compareIsoDateTime`, unchanged.
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
const { validate: date, compare: compareDate } = require("./date.cjs");
const time = require("./iso-time.cjs").validate;
const compareTime = require("./time.cjs").compare;
const DATE_TIME_SEPARATOR = /t|\s/i;
function date_time(str) {
  const dateTime = str.split(DATE_TIME_SEPARATOR);
  return dateTime.length === 2 && date(dateTime[0]) && time(dateTime[1]);
}
function compareIsoDateTime(dt1, dt2) {
  if (!(dt1 && dt2)) return undefined;
  const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
  const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
  const res = compareDate(d1, d2);
  if (res === undefined) return undefined;
  return res || compareTime(t1, t2);
}
module.exports = { validate: date_time, compare: compareIsoDateTime };
