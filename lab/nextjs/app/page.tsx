// lab/basic's schemas, imported by a server component and, in Signup, by a client component, so
// that the loader makes modules for both bundles, and this lab's own stamp.schema.jsonc, which the
// dotschema.jsonc beside this lab's package.json gives its codecs. The types are dotschema's content
// mapper's.
import user, { type Type as User } from "../../basic/user.schema.jsonc";
import point from "../../basic/point.schema.json5";
import team from "../../basic/team.schema.jsonc";
import event from "../../basic/event.schema.jsonc";
import stamp, { type Type as Stamp } from "../stamp.schema.jsonc";
import { Signup } from "./signup";

const ada: User = { name: "Ada", role: "admin" };
// @ts-expect-error a role the schema does not allow
const bob: User = { name: "Bob", role: "owner" };

// The type is the decoded value's, and a string is the value as given.
const stamped: Stamp = { at: Temporal.Instant.from("2026-10-20T06:00:00Z"), id: BigInt("9007199254740993") };
// @ts-expect-error a date-time string where the codec gives a Temporal.Instant
const unstamped: Stamp = { at: "2026-10-20T06:00:00Z", id: BigInt(1) };

export default function Page() {
  const { value } = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" });
  const failed = user.validate({ name: "", role: "owner", email: "not an email" });
  const server = {
    vendor: user["~standard"].vendor,
    valid: user.is(ada) && !user.is(bob),
    issues: failed.issues?.map((issue) => `${issue.path.join(".")}: ${issue.keyword}`),
    points: [point.is({ x: 1, y: 2 }), point.is({ x: 1.5, y: 2 })],
    team: [team.is({ lead: ada, members: [ada], office: { city: "London" } }), team.is({ lead: ada, members: [], office: { city: "" } })],
    events: [event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }), event.is({ at: "yesterday", kind: "click", x: 1, y: 2 })],
    codecs: value && [value.at instanceof Temporal.Instant, String(value.at), typeof value.id, String(value.id), stamp.encode(value).value],
  };
  return (
    <main>
      <pre id="server">{JSON.stringify(server)}</pre>
      <Signup />
    </main>
  );
}
