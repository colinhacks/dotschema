// assets/icon.svg is the favicon's tile of the site's mark, a file in the repository for a tool that
// looks for a project's icon in its checkout, where the icons the site draws at build time are not
// (`markTileSvg` in site/lib/mark.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markTileSvg } from "../site/lib/mark.ts";
import { ROOT } from "./helpers.ts";

test("assets/icon.svg is the mark's tile, as site/lib/mark.ts draws it", () => {
  assert.equal(readFileSync(`${ROOT}assets/icon.svg`, "utf8"), markTileSvg(), "write markTileSvg()'s text into assets/icon.svg");
});
