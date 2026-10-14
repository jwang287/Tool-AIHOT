// The twelve-hour fallback for a feed that will not answer. While the ten-minute scan keeps failing, this
// sweeps every instance it knows (each one's feed first, then its profile page) and Jina's rendering of the
// profile when its key is set, so a set of broken instances still leaves the monitor with the newest posts.
// What it reads goes through the same table, dedup and recognition pipeline as the scan, and its own state
// sits beside the scan's in monitor_state.rss (patchRssState), so neither overwrites the other's.
import { credential } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { collapseWhitespace, stripTags, truncate } from "@aihot/backend/lib/text";
import { jinaRead } from "@aihot/backend/providers/jina";
import { AUTHOR } from "@aihot/codex-monitor/contracts";
import { bjIso, awaitingReviewCondition } from "./read.ts";
import { flushResetPushes, processPending, withMonitorLock } from "./scan.ts";
import { fetchInstanceFeed, patchRssState, rssInstances, tweetIdOf, type ReadPost, type RssFallbackState, type RssState } from "./scan-rss.ts";
import { getState, idGreater, touchWatermarks } from "./state.ts";

const PROFILE_TIMEOUT_MS = 12_000;
const PROFILE_MAX_BYTES = 2 * 1024 * 1024;
/** Twitter's snowflake epoch: a post's id carries its creation time in its top bits. */
const SNOWFLAKE_EPOCH_MS = 1288834974657;
/** A number misread as a snowflake decodes to the epoch or just after it; the account is not that old. */
const SNOWFLAKE_EARLIEST_MS = Date.parse("2015-01-01");

/** What one fallback run did, as the cron records it in job_runs. */
export type FallbackOutcome =
  | { skipped: string }
  | {
    triggered: string;
    /** Sources tried and sources that answered with posts. */
    sources: { tried: number; answered: number };
    /** Posts read, of them the new ones stored, and the events the recognition made of them. */
    read: number;
    stored: number;
    processed: number;
    failed: number;
    pushed: number;
    events: number;
    verifiedAt: string | null;
  };

/**
 * The creation time a post's id carries (snowflakes shift the milliseconds left by 22). Nitter's profile
 * page and Jina's rendering carry no time we can trust; the id itself does, which keeps a post's place in
 * the timeline right (the feed's own dates are used where a source has them).
 */
export function snowflakeDate(id: string, now = Date.now()): Date | null {
  if (!/^\d{5,25}$/.test(id)) return null;
  const at = new Date(Number(BigInt(id) >> 22n) + SNOWFLAKE_EPOCH_MS);
  return at.getTime() >= SNOWFLAKE_EARLIEST_MS && at.getTime() < now + 24 * 3600_000 ? at : null;
}

/** "Oct 13, 2026 · 11:32 PM UTC" as nitter writes a date; the middle dot alone breaks Date.parse. */
export function nitterDate(value: string): Date | null {
  const at = Date.parse(value.replace(/[·•]/g, " ").replace(/\s+/g, " ").trim());
  return Number.isFinite(at) ? new Date(at) : null;
}

/**
 * The posts on an instance's profile page, as nitter writes them: one timeline-item per post, its address
 * on the status link, its words in tweet-content. A page that is not a timeline (a challenge, an error, a
 * sign-in wall) yields nothing, and the caller gives the instance up; a repost is not his words and is
 * left out, as the feed leaves it out.
 */
export function parseProfilePosts(html: string, instance: string): ReadPost[] {
  const out: ReadPost[] = [];
  for (const block of html.split(/<div class="timeline-item/).slice(1)) {
    if (/class="retweet-header|retweeted by/i.test(block)) continue;
    const id = tweetIdOf(...[...block.matchAll(/href="([^"]*\/status\/\d{5,25}[^"]*)"/g)].map((match) => match[1]));
    if (!id) continue;
    const text = collapseWhitespace(stripTags(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? ""));
    if (text.length < 4) continue;
    const title = /class="tweet-date"[\s\S]{0,600}?title="([^"]+)"/.exec(block)?.[1];
    const publishedAt = (title ? nitterDate(title) : null) ?? snowflakeDate(id);
    if (!publishedAt) continue;
    out.push({ id, text, publishedAt, link: `${instance}/${AUTHOR}/status/${id}`, description: null });
  }
  return out;
}

/** A post's words carried in a link's own text: `[words](https://x.com/thsottiaux/status/123)`. */
const LINKED_POST = /\[([^\]]{8,})\]\(https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^)\s]*?\/status\/(\d{5,25})/g;
/** A post's address on its own; its words are the paragraph right before it. */
const BARE_POST = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s]+\/status\/(\d{5,25})/g;
/** What a rendering writes around posts: dates, counters, chrome — never a post's words. */
const NOT_WORDS = /^(?:just now|\d+[smhd]|·|@[a-z0-9_]+|show more|quote|repost|like|reply|follow|pinned|verified account)[^a-z]*$/i;

/** The paragraph before an address: what a rendering puts a post's words in when they are not its link. */
function paragraphBefore(markdown: string, index: number): string {
  const before = markdown.slice(0, index).trimEnd();
  const blocks = before.split(/\n\s*\n/);
  const block = (blocks.at(-1) ?? "").replace(/^\s*(?:[-*+>]|\d+\.)\s*/, "").trim();
  // A rendering's own chrome travels with the address: it is not the post's words.
  return /\]\(|^Markdown Content:|^\w[\w ]{0,20}:$/.test(block) ? "" : block;
}

/**
 * The posts in Jina's rendering of the profile. A rendering without a post's words is not read as one:
 * the words are the link's own text where it has any, else the paragraph before the bare address.
 */
export function parseJinaPosts(markdown: string): ReadPost[] {
  const candidates = new Map<string, { text: string; link: string }>();
  const keep = (id: string, text: string, link: string) => {
    const clean = collapseWhitespace(stripTags(text));
    if (clean.length < 8 || NOT_WORDS.test(clean) || !/\p{L}/u.test(clean)) return;
    // The link's text is the post's own; a paragraph beside it is at best a second-hand copy of it.
    if (!candidates.has(id)) candidates.set(id, { text: clean, link });
  };
  for (const match of markdown.matchAll(LINKED_POST)) keep(match[2]!, match[1]!, `https://x.com/${AUTHOR}/status/${match[2]}`);
  for (const match of markdown.matchAll(BARE_POST)) keep(match[1]!, paragraphBefore(markdown, match.index!), match[0]);

  const out: ReadPost[] = [];
  for (const [id, found] of candidates) {
    const publishedAt = snowflakeDate(id);
    if (publishedAt) out.push({ id, text: found.text, publishedAt, link: found.link, description: null });
  }
  return out;
}

/**
 * Every instance worth sweeping: the scan's own order first (what answered last at its head), then the
 * configured list, then any host an earlier failure recorded that is no longer configured.
 */
export function fallbackInstances(health: RssState | null): string[] {
  const configured = rssInstances();
  return [...new Set([...(health?.order ?? []), ...configured, ...Object.keys(health?.hosts ?? {})])];
}

async function fetchProfilePosts(instance: string): Promise<ReadPost[]> {
  const res = await guardedFetch(`${instance}/${AUTHOR}`, {
    timeoutMs: PROFILE_TIMEOUT_MS,
    maxBytes: PROFILE_MAX_BYTES,
    headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const posts = parseProfilePosts(res.text(), instance);
  // Nothing on the page is a post: a challenge, a sign-in wall or an instance that does not serve HTML.
  if (!posts.length) throw new Error("no posts on the profile page");
  return posts;
}

async function readJina(): Promise<ReadPost[]> {
  const { markdown } = await jinaRead(`https://x.com/${AUTHOR}`, { purpose: "monitor.fallback", subject: `x:${AUTHOR}`, perRead: true });
  const posts = parseJinaPosts(markdown);
  if (!posts.length) throw new Error("no posts in the rendering");
  return posts;
}

async function storeFallbackPost(post: ReadPost, source: string, readAt: string) {
  await sql`
    INSERT INTO monitor_posts (id, author, published_at, text, url, context, raw, origin)
    VALUES (${post.id}, ${AUTHOR}, ${post.publishedAt}, ${post.text}, ${`https://x.com/${AUTHOR}/status/${post.id}`},
            ${sql.json([] as never)},
            ${sql.json({ fallback: { source, id: post.id, link: post.link, readAt, description: post.description } } as never)}, 'live')
    ON CONFLICT (id) DO NOTHING`;
}

const eventCount = async () => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM monitor_events`)[0]?.n ?? 0);

/**
 * One fallback run. It does nothing while the feed is answering (the scan's own failure count is the
 * trigger), and otherwise reads every source it has, stores what is new, recognizes it and pushes what is
 * owed — the same pipeline the ten-minute scan runs, serialized with it by the monitor lock. A run that
 * reads nothing at all throws, so job_runs shows it as failed; the counts it did read are logged either way.
 */
export async function monitorFallback(now = Date.now()): Promise<FallbackOutcome> {
  const health = await getState<RssState>("rss");
  if (!health || health.consecutiveFailures <= 0) {
    console.log(JSON.stringify({ level: "info", msg: "monitor fallback skipped", reason: "the feed is answering", consecutiveFailures: health?.consecutiveFailures ?? 0 }));
    return { skipped: "the feed is answering" };
  }
  const triggered = `rss failing ${health.consecutiveFailures}x`;
  return withMonitorLock(async () => {
    const started = new Date();
    const readAt = started.toISOString();
    const sources: RssFallbackState["sources"] = {};
    const found = new Map<string, { post: ReadPost; source: string }>();
    const keep = (post: ReadPost, source: string) => {
      if (!found.has(post.id)) found.set(post.id, { post, source });
    };
    let tried = 0;
    let answered = 0;

    for (const instance of fallbackInstances(health)) {
      tried++;
      try {
        const items = await fetchInstanceFeed(instance);
        for (const item of items) keep(item, `rss:${instance}`);
        sources[`rss:${instance}`] = { ok: true, posts: items.length };
        answered++;
        continue;
      } catch (error) {
        const message = truncate(String((error as Error)?.message ?? error), 200);
        sources[`rss:${instance}`] = { ok: false, posts: 0, error: message };
        console.error(JSON.stringify({ level: "warn", msg: "fallback instance feed failed", instance, error: message }));
      }
      // The feed failed here; the instance's own profile page is the second try.
      try {
        const posts = await fetchProfilePosts(instance);
        for (const post of posts) keep(post, `html:${instance}`);
        sources[`html:${instance}`] = { ok: true, posts: posts.length };
        answered++;
      } catch (error) {
        const message = truncate(String((error as Error)?.message ?? error), 200);
        sources[`html:${instance}`] = { ok: false, posts: 0, error: message };
      }
    }

    // Jina renders the profile from outside; it is tried only where its key is set, and a deployment
    // without it loses nothing (it is not a failure, just one source less).
    const jinaConfigured = !!credential("collectors", "JINA_API_KEY");
    if (jinaConfigured) {
      tried++;
      try {
        const posts = await readJina();
        for (const post of posts) keep(post, "jina");
        sources["jina"] = { ok: true, posts: posts.length };
        answered++;
      } catch (error) {
        const message = truncate(String((error as Error)?.message ?? error), 200);
        sources["jina"] = { ok: false, posts: 0, error: message };
        console.error(JSON.stringify({ level: "warn", msg: "fallback jina read failed", error: message }));
      }
    }

    if (!answered) {
      const failure = `no source answered (${tried}): ${Object.entries(sources).map(([key, value]) => `${key}: ${value.error ?? "no posts"}`).join("；")}`;
      await patchRssState({
        fallback: { at: readAt, ok: false, stored: 0, events: 0, sources, lastOkAt: health.fallback?.lastOkAt ?? null, lastError: truncate(failure, 1000) } satisfies RssFallbackState,
      });
      console.error(JSON.stringify({ level: "error", msg: "monitor fallback found nothing", tried, jina: jinaConfigured ? "tried" : "skipped (no key)", error: truncate(failure, 1000) }));
      throw new Error(failure);
    }

    // Only what is not stored yet: the sources overlap each other, and the ten-minute scan may have stored
    // a post while this sweep was reading it.
    const ids = [...found.keys()];
    const existing = new Set((await sql<{ id: string }[]>`SELECT id FROM monitor_posts WHERE id = ANY(${ids}::text[])`).map((row) => row.id));
    let stored = 0;
    for (const [id, entry] of [...found].sort(([a], [b]) => (idGreater(a, b) ? 1 : -1))) {
      if (existing.has(id)) continue;
      await storeFallbackPost(entry.post, entry.source, readAt);
      stored++;
    }
    await touchWatermarks({ lastCollectedAt: readAt });

    const before = await eventCount();
    const processed = await processPending();
    const pushed = await flushResetPushes();
    const events = (await eventCount()) - before;
    const [pending] = await sql<{ n: number; review: number }[]>`
      SELECT count(*) FILTER (WHERE processed_at IS NULL)::int AS n, count(*) FILTER (WHERE ${awaitingReviewCondition()})::int AS review
      FROM monitor_posts WHERE author = ${AUTHOR}`;
    // Verified in full only with nothing waiting, exactly as the ten-minute scan decides it.
    const complete = !pending?.n && !pending?.review;
    if (complete) await touchWatermarks({ lastVerifiedAt: started.toISOString() });

    const state: RssFallbackState = { at: readAt, ok: true, stored, events, sources, lastOkAt: readAt, lastError: null };
    await patchRssState({ fallback: state });
    console.log(JSON.stringify({
      level: "info", msg: "monitor fallback", triggered, read: found.size, stored,
      sources: `${answered}/${tried}`, jina: jinaConfigured ? "tried" : "skipped (no key)",
      processed: processed.processed, failed: processed.failed, pushed, events,
      verifiedAt: complete ? bjIso(started) : null, elapsedMs: Date.now() - started.getTime(),
    }));
    return {
      triggered,
      sources: { tried, answered },
      read: found.size,
      stored,
      processed: processed.processed,
      failed: processed.failed,
      pushed,
      events,
      verifiedAt: complete ? bjIso(started) : null,
    };
  });
}
