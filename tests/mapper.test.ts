// The content mapper process, spoken to over its JSON-RPC framing as tsc speaks to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { ROOT } from "./helpers.ts";

function client(cwd = ROOT) {
  const child = spawn(process.execPath, ["src/mapper.ts"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
  let buffer = Buffer.alloc(0);
  const waiting = new Map<number, (value: any) => void>();
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())![1]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      waiting.get(message.id)?.(message);
    }
  });
  let id = 0;
  return {
    call(method: string, params: unknown): Promise<any> {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }));
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
      return new Promise((resolve) => waiting.set(id, resolve));
    },
    close: () => child.kill(),
  };
}

test("the mapper answers the protocol as dotschema, reports options, places errors in UTF-8 bytes and names its suffix for any other file", async () => {
  const mapper = client();
  try {
    const init = await mapper.call("initialize", { protocolVersion: 1 });
    assert.deepEqual(init.result, { protocolVersion: 1, positionEncoding: "utf-8", diagnosticSource: "dotschema" });
    const open = await mapper.call("openProject", { configFileName: `${ROOT}tsconfig.json`, projectHandle: "p", compilerOptions: {}, options: { strict: true } });
    assert.deepEqual(open.result.optionDiagnostics, [{ path: ["strict"], messageText: 'dotschema takes no options; remove "strict".', code: 5 }]);
    const ok = await mapper.call("transform", { fileName: `${ROOT}tests/fixtures/x.schema.jsonc`, content: '{ "type": "string" }', projectHandle: "p" });
    assert.equal(ok.result.extension, ".mts");
    assert.match(ok.result.text, /^import type \{ Schema as __DotschemaSchema \} from "dotschema";\n/);
    assert.match(ok.result.text, /\ntype X = string;\nexport type \{ X as output \};\nexport type input = X;/);
    // "é" is two bytes in UTF-8: the error after it starts one byte later than its UTF-16 offset.
    const content = '{ "description": "é", "type": }';
    const bad = await mapper.call("transform", { fileName: `${ROOT}tests/fixtures/x.schema.jsonc`, content, projectHandle: "p" });
    assert.equal(bad.result.diagnostics[0].code, 1);
    assert.equal(bad.result.diagnostics[0].start, Buffer.byteLength(content.slice(0, content.indexOf("}"))));
    // A syntax error at the end of the text, truncated or empty, stays within it: TypeScript refuses a
    // response whose diagnostic runs past the end (TS18069), so one at the end is empty.
    for (const text of ['{ "type": "é",\n', ""]) {
      const cut = await mapper.call("transform", { fileName: `${ROOT}tests/fixtures/x.schema.jsonc`, content: text, projectHandle: "p" });
      assert.ok(cut.result.diagnostics.length > 0, JSON.stringify(text));
      for (const diagnostic of cut.result.diagnostics) {
        assert.equal(diagnostic.code, 1);
        assert.deepEqual([diagnostic.start, diagnostic.length], [Buffer.byteLength(text), 0], `${JSON.stringify(text)}: ${diagnostic.messageText}`);
      }
    }
    const other = await mapper.call("transform", { fileName: `${ROOT}x.jsonc`, content: "{}", projectHandle: "p" });
    assert.equal(other.result.diagnostics[0].messageText, `dotschema reads .schema.jsonc files; ${ROOT}x.jsonc is not one. Remove its extension from dotschema's contentMappers entry.`);
    assert.equal(other.result.diagnostics[0].code, 3);
  } finally {
    mapper.close();
  }
});
