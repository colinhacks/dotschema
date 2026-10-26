// A Worker that validates with lab/basic's schemas, in workerd, which refuses `new Function`: the
// validators are compiled when the module is built, so the Worker runs them as plain code.
import user, { type Type as User } from "../../basic/user.schema.jsonc";
import team from "../../basic/team.schema.jsonc";
import event from "../../basic/event.schema.jsonc";

const ada: User = { name: "Ada", role: "admin" };

export default {
  async fetch(request: Request): Promise<Response> {
    // A POST is a user to check: its issues, or the user.
    if (request.method === "POST") {
      const result = user.validate(await request.json());
      return Response.json(result, { status: result.issues ? 400 : 200 });
    }
    const failed = user.validate({ name: "", role: "owner", email: "not an email" });
    return Response.json({
      vendor: user["~standard"].vendor,
      valid: user.is(ada),
      issues: failed.issues?.map((issue) => `${issue.path.join(".")}: ${issue.keyword}`),
      team: [team.is({ lead: ada, members: [ada] }), team.is({ lead: ada, members: [{ name: "" }] })],
      events: [event.is({ at: "2026-10-20T09:00:00Z", kind: "visit", url: "https://example.com/a" }), event.is({ at: "yesterday", kind: "visit", url: "https://example.com/a" })],
    });
  },
} satisfies ExportedHandler;
