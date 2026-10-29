// lab/basic's schemas, imported by a server component and, in Signup, by a client component, so
// that the loader makes modules for both bundles. The types are dotschema's content mapper's.
import user, { type Type as User } from "../../basic/user.schema.jsonc";
import point from "../../basic/point.schema.jsonc";
import team from "../../basic/team.schema.jsonc";
import event from "../../basic/event.schema.jsonc";
import { Signup } from "./signup";

const ada: User = { name: "Ada", role: "admin" };
// @ts-expect-error a role the schema does not allow
const bob: User = { name: "Bob", role: "owner" };

export default function Page() {
  const failed = user.validate({ name: "", role: "owner", email: "not an email" });
  const server = {
    vendor: user["~standard"].vendor,
    valid: user.is(ada) && !user.is(bob),
    issues: failed.issues?.map((issue) => `${issue.path.join(".")}: ${issue.keyword}`),
    points: [point.is({ x: 1, y: 2 }), point.is({ x: 1.5, y: 2 })],
    team: [team.is({ lead: ada, members: [ada], office: { city: "London" } }), team.is({ lead: ada, members: [], office: { city: "" } })],
    events: [event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }), event.is({ at: "yesterday", kind: "click", x: 1, y: 2 })],
  };
  return (
    <main>
      <pre id="server">{JSON.stringify(server)}</pre>
      <Signup />
    </main>
  );
}
