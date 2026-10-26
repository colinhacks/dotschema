// Starts Vite's dev server (`node serve.mjs dev`) or its preview of the build (`node serve.mjs
// preview`, after `vite build`) on a free port, each running the Worker in workerd, then prints what
// the Worker answers to a GET and to a POST of a user with two issues, and stops.
import { createServer, preview } from "vite";

const mode = process.argv[2];
const server = mode === "preview" ? await preview({ preview: { port: 0 }, logLevel: "error" }) : await (await createServer({ server: { port: 0 }, logLevel: "error" })).listen();
try {
  const url = server.resolvedUrls.local[0];
  const get = await fetch(url);
  const post = await fetch(url, { method: "POST", body: JSON.stringify({ name: "", role: "owner" }) });
  console.log(JSON.stringify({ get: await get.json(), post: [post.status, await post.json()] }));
} finally {
  await server.close();
}
