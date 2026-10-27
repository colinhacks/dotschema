// lab/basic's schemas, bundled through dotschema/vite by Vite (for Node and for the browser),
// Rollup and Rolldown, and through dotschema/webpack by webpack and Rspack. JavaScript, so that no
// bundler needs a loader for TypeScript; lab/basic's main.ts checks the types. It prints what
// lab/basic/main.ts prints, and what this lab's own stamp.schema.jsonc decodes with the codecs of
// the dotschema.jsonc beside it.
import user, { address } from "../basic/user.schema.jsonc";
import point from "../basic/point.schema.json5";
import team from "../basic/team.schema.jsonc";
import event from "../basic/event.schema.jsonc";
import stamp from "./stamp.schema.jsonc";

const describe = (e) => (e.kind === "click" ? `${e.x},${e.y}` : e.url);
const checked = user.validate({ name: "Ada", role: "admin", email: "ada@example.com" });
const failed = user.validate({ name: "", role: "owner", email: "not an email" });
const standard = user["~standard"].validate({ name: "Ada" });
const click = { at: "2026-10-20T09:00:00Z", kind: "click", x: 3, y: 4 };
const fifth = event.validate({ at: "2026-10-20T09:00:00Z", kind: "click", x: 5, y: 6 });
const summary = user.pick("name", "role");
const contact = user.omit("role", "tags", "address").pick("name", "email");
const { value: decoded } = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" });

console.log(
  JSON.stringify({
    valid: checked.issues ? checked.issues.length : checked.value.name,
    invalid: failed.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    keywords: failed.issues?.map((issue) => issue.keyword),
    standard: [user.validate === user["~standard"].validate, standard.issues?.[0]?.path],
    vendor: user["~standard"].vendor,
    memberPath: team.validate({ lead: { name: "Ada", role: "admin" }, members: [{ name: "Grace", role: "member" }, { name: "", role: "member" }] }).issues?.[0]?.path,
    points: [point.is({ x: 1, y: 2, label: "origin" }), point.is({ x: 1.5, y: 2 }), point.is({ x: 1, y: 2, label: "seventeen letters" })],
    team: [
      team.is({ lead: { name: "Ada", role: "admin" }, members: [{ name: "Grace", role: "member" }], office: { city: "London", manager: { name: "Ada", role: "admin" } } }),
      team.is({ lead: { name: "Ada", role: "admin" }, members: [{ name: "", role: "member" }] }),
      team.is({ lead: { name: "Ada", role: "admin" }, members: [], office: { city: "" } }),
    ],
    teamJsonSchema: ["draft-2020-12", "draft-07"].map((target) => {
      const json = team["~standard"].jsonSchema.input({ target });
      return [json.$schema, json.properties.lead.$ref, Object.keys(json.$defs ?? json.definitions ?? {}).join()];
    }),
    events: [
      event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "visit", url: "https://example.com/a" }),
      event.is({ at: "yesterday", kind: "click", x: 1, y: 2 }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "visit", url: "not a uri" }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "click", url: "https://example.com/a" }),
    ],
    described: event.is(click) ? describe(click) : "not an event",
    clickX: fifth.issues ? fifth.issues.length : fifth.value.x,
    address: [address.is({ city: "Paris" }), address.validate({ street: "Rue de Rivoli", zip: "75001" }).issues?.map((issue) => `${issue.path.join(".")}: ${issue.keyword}`)],
    picked: [summary.validate({ name: "", email: "ada@example.com" }).issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`), contact.is({ name: "Ada" }), Object.keys(summary["~standard"].jsonSchema.input({ target: "draft-07" }).properties).join()],
    codecs: [decoded.at instanceof Temporal.Instant, String(decoded.at), typeof decoded.id, String(decoded.id), stamp.encode(decoded).value],
  }),
);
