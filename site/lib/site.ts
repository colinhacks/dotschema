export const githubUrl = 'https://github.com/colinhacks/dotschema';

/**
 * The docs site's address, the one place it is written: every absolute URL the site gives (the
 * canonical link, the Open Graph and X tags, the sitemap, robots.txt, /llms.txt's links, the
 * structured data) is built from it. The maintainer chose no domain for now on 2026-10-27 ("No
 * domain for now — the site deploys to a vercel.app address; a domain can be added later"), so it
 * is the Vercel project's address; a domain is a change to this line.
 */
export const siteUrl = 'https://dotschema.vercel.app';

/**
 * The title search results and link previews show: the name and what it does, in under 60
 * characters so that Google does not cut it, as Motherload's and Reylo's read. The page's h1 stays
 * the name alone.
 */
export const siteTitle = 'dotschema — Import .schema.jsonc files into TypeScript';
