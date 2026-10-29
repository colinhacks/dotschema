// A Worker that validates with lab/basic's schemas and its own formats.schema.jsonc, in workerd, which
// refuses `new Function`: the validators are compiled when the module is built, so the Worker runs
// them as plain code, the formats' files with them.
import user, { type output as User } from "../../basic/user.schema.jsonc";
import team from "../../basic/team.schema.jsonc";
import event from "../../basic/event.schema.jsonc";
import formats from "./formats.schema.jsonc";

const ada: User = { name: "Ada", role: "admin" };

// A value each format takes, and one each refuses.
const valid = {
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  data: "SGVsbG8=",
  network: "2001:db8::/32",
  card: "4111 1111 1111 1111",
  at: "2026-10-20T09:00:00Z",
  id: "2eb8aa08-aa98-11ea-b4aa-73b441d16380",
  mood: "👍🏽",
  digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  // A U-label not in NFC, which the mapping normalizes; a ZWJ after a virama.
  host: "cafe\u0301.\u0915\u094D\u200D\u0937",
  mail: "\u03B4\u03BF\u03BA\u03B9\u03BC\u03AE@example.com",
  link: "http://\u0192\u00F8\u00F8.\u00DF\u00E5r/?q=\u{F0000}",
};
const invalid = { token: "a.b.c", data: "SGVsbG8", network: "2001:db8::/129", card: "4111 1111 1111 1112", at: "2026-10-20 09:00:00Z", id: "urn:uuid:2eb8aa08-aa98-11ea-b4aa-73b441d16380", mood: "1", digest: "e3b0", host: "\u0915\u200D\u0937", mail: "\u03B4@example-.com", link: "/\u00E2\u03C0\u03C0" };

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
      formats: [formats.is(valid), formats.validate(invalid).issues?.map((issue) => issue.path.join("."))],
    });
  },
} satisfies ExportedHandler;
