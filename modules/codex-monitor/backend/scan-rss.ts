// Tibo post collection from the free Nitter RSS instances (no SocialData key): the same monitor_posts
// rows, the same cursor-by-id rule and the same recognition pipeline as the paid scan. A feed carries the
// newest ~20 posts and no reply/quote context, so a post that references an earlier one is recognized
// from its own words; a stop longer than the feed window loses the posts that fell out of it, which the
// page's history (built from confirmation posts and receipts) is independent of.
//
// Instances are shared and go down or start refusing; every scan tries them in turn and keeps each one's
// result, so the next scan starts with the one that worked and only the failures move down the list.
import { XMLParser } from "fast-xml-parser";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { collapseWhitespace, stripTags, truncate } from "@aihot/backend/lib/text";
import { AUTHOR } from "@aihot/codex-monitor/contracts";
import { getState, idGreater, touchWatermarks } from "./state.ts";

/**
 * Where a feed is read from. Verified 2026-10-14 from a Japan VPS: nitter.kareem.one answered in ~0.3 s
 * with 19 items again and again; nitter.meowing.monster answered earlier that day and stopped answering
 * later; the rest are listed as healthy with RSS by status.d420.de but refused that VPS (403/418/401),
 * which another network may not. The last three are mirrors of the older nitter lineage, kept at the tail
 * as a best effort: their availability changes by the day, and a failed try costs one request.
 * A deployment that knows better instances sets MONITOR_RSS_URLS.
 */
const BUILT_IN_INSTANCES = [
  "nitter.kareem.one",
  "nitter.meowing.monster",
  "nitter.netbub.com",
  "shitter.thepixora.com",
  "nitter.miningtcup.me",
  "nitter.pp.ua",
  // 备选镜像，可用性随时变化（2026-10-14 从同一台 VPS 实测：451 / 无响应 / 403）。
  "xcancel.com",
  "nitter.privacydev.net",
  "nitter.space",
];

const FETCH_TIMEOUT_MS = 12_000;
const FEED_PATH = "rss";
/** A feed this large is not a feed: 20 posts of Tibo's run to ~30 KB. */
const MAX_FEED_BYTES = 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

/** Nitter marks a reply in the title ("R to @user: …"); the text itself is what the recognizer reads. */
const REPLY_PREFIX = /^R to @[A-Za-z0-9_]+:\s*/;
/** A native repost is not his words; the paid scan skips these the same way. */
const RETWEET_PREFIX = /^RT by @[A-Za-z0-9_]+:\s*/;

/** A post read from a free source: the feed, an instance's profile page, or Jina's rendering of x.com. */
export interface ReadPost {
  id: string;
  text: string;
  publishedAt: Date;
  /** The address the item was read at (the instance's own), kept for diagnostics. */
  link: string;
  /** The item's HTML body, where the source has one (a quote or reply may be appended to it). */
  description: string | null;
}

/** What the free scan remembers between runs. */
export interface RssState {
  /** The newest post stored; a later scan stores only what is newer and not yet there. */
  sinceId: string | null;
  /** Instances in the order to try them: the one that worked last first. */
  order: string[];
  /** How each instance answered the last time it was tried. */
  hosts: Record<string, { ok: boolean; at: string; error?: string }>;
  lastOkAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Failures in a row (the module's alerts read this), and when the streak began. */
  consecutiveFailures: number;
  failedSince: string | null;
  /** What the twelve-hour fallback last did, beside this: written while a scan may be running. */
  fallback?: RssFallbackState;
}

/** What the twelve-hour fallback recorded about its last deep sweep. */
export interface RssFallbackState {
  at: string;
  ok: boolean;
  /** The posts it stored, and the events the recognition made of them. */
  stored: number;
  events: number;
  /** Each source it tried, by kind and instance, and what came back. */
  sources: Record<string, { ok: boolean; posts: number; error?: string }>;
  lastOkAt: string | null;
  lastError: string | null;
}

/**
 * A patch inside the free path's state: the ten-minute scan and the twelve-hour fallback both write here,
 * and only the fields they own. One statement merges the patch into whatever the row holds at that moment,
 * so the two cannot overwrite each other's work (a scan's failure count, a fallback's last sweep).
 */
export async function patchRssState(patch: Partial<RssState>): Promise<void> {
  await sql`INSERT INTO monitor_state (key, value) VALUES ('rss', ${sql.json(patch as never)})
    ON CONFLICT (key) DO UPDATE SET value = monitor_state.value || EXCLUDED.value, updated_at = now()`;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** A node's text, through the parser's CDATA and text-node wrappers. */
function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#cdata" in o) return textOf(o["#cdata"]);
    if ("#text" in o) return textOf(o["#text"]);
  }
  return "";
}

/** Atom carries its address in an attribute; RSS 2.0 as a text node. */
function linkOf(v: unknown): string {
  const first = arr(v as Record<string, unknown> | Array<Record<string, unknown>>)[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const href = (first as Record<string, unknown>)["@href"];
    if (typeof href === "string") return href;
    return textOf(first);
  }
  return "";
}

/** The post's id: Nitter writes it as the guid (plain digits) or the last segment of a /status/ address. */
export function tweetIdOf(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    const status = /\/status\/(\d{5,25})/.exec(value)?.[1];
    if (status) return status;
    const own = /^(\d{5,25})$/.exec(value)?.[1];
    if (own) return own;
    // Bridges write ids as "tag:twitter.com,2007:status:12345" or end an address with them.
    const trailing = /(\d{5,25})\D*$/.exec(value)?.[1];
    if (trailing) return trailing;
  }
  return null;
}

function dateOf(value: string): Date | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at) : null;
}

/**
 * The posts in a feed, newest first as the instances write them. What is not a post (the channel's own
 * entries, an item without a usable time or text) is dropped; a body that is not a feed at all — several
 * instances answer with an HTML queue page and status 200 — throws.
 */
export function parseFeed(xml: string): ReadPost[] {
  const doc = parser.parse(xml) as Record<string, any> | null;
  const channel = doc?.rss?.channel ?? doc?.channel;
  const entries: Record<string, any>[] = arr(channel ? channel.item : doc?.feed?.entry);
  if (!channel && !doc?.feed) throw new Error("not a feed");
  const out: ReadPost[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const link = linkOf(entry.link);
    const id = tweetIdOf(textOf(entry.guid), textOf(entry.id), link);
    if (!id) continue;
    const title = textOf(entry.title);
    if (!title || RETWEET_PREFIX.test(title)) continue;
    const text = collapseWhitespace(title.replace(REPLY_PREFIX, ""));
    if (!text) continue;
    const publishedAt = dateOf(textOf(entry.pubDate) || textOf(entry.published) || textOf(entry.updated));
    if (!publishedAt) continue;
    const description = textOf(entry.description) || textOf(entry.content) || textOf(entry.summary);
    out.push({
      id,
      text,
      publishedAt,
      link,
      description: description ? truncate(stripTags(description), 1000) : null,
    });
  }
  return out;
}

function baseUrlOf(entry: string): string {
  const withScheme = /^https?:\/\//i.test(entry) ? entry : `https://${entry}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * The instances to read from: MONITOR_RSS_URLS (comma-separated hosts or addresses) when the deployment
 * sets it, else the built-in list. The address is used as given, so a local feed server works in tests.
 */
export function rssInstances(): string[] {
  const configured = (process.env.MONITOR_RSS_URLS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).map(baseUrlOf);
  const list = configured.length ? configured : BUILT_IN_INSTANCES.map(baseUrlOf);
  return [...new Set(list)];
}

/** The order to try them in: what worked last first, then what is configured, then what was tried before. */
function instanceOrder(previous: string[], configured: string[]): string[] {
  const known = [...previous.filter((host) => configured.includes(host)), ...configured.filter((host) => !previous.includes(host))];
  return known.length ? known : [...configured];
}

export async function fetchInstanceFeed(instance: string): Promise<ReadPost[]> {
  const url = `${instance}/${AUTHOR}/${FEED_PATH}`;
  const res = await guardedFetch(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_FEED_BYTES,
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(res.text());
  // An empty feed is not a quiet account: the instance's copy is broken or truncated.
  if (!items.length) throw new Error("feed has no posts");
  return items;
}

async function storePost(item: ReadPost, instance: string) {
  await sql`
    INSERT INTO monitor_posts (id, author, published_at, text, url, context, raw, origin)
    VALUES (${item.id}, ${AUTHOR}, ${item.publishedAt}, ${item.text}, ${`https://x.com/${AUTHOR}/status/${item.id}`},
            ${sql.json([] as never)},
            ${sql.json({ rss: { instance, id: item.id, link: item.link, pubDate: item.publishedAt.toISOString(), description: item.description } } as never)}, 'live')
    ON CONFLICT (id) DO NOTHING`;
}

/**
 * One scan of the feed: an instance that answers is remembered and tried first next time; the others stay
 * in the list in the order they were configured. Posts are stored before the cursor moves, and a scan
 * that loses every instance throws after recording what each one said, so the run is not mistaken for a
 * complete one.
 */
export async function collectPostsRss(): Promise<{ stored: number; instance: string; tried: number }> {
  const started = new Date();
  await touchWatermarks({ lastAttemptAt: started.toISOString() });
  const previous = (await getState<RssState>("rss")) ?? {
    sinceId: null, order: [], hosts: {}, lastOkAt: null, lastAttemptAt: null, lastError: null, consecutiveFailures: 0, failedSince: null,
  };
  const instances = instanceOrder(previous.order, rssInstances());
  const hosts = { ...previous.hosts };
  let answered: { instance: string; items: ReadPost[] } | null = null;
  const failures: string[] = [];
  let tried = 0;
  for (const instance of instances) {
    tried++;
    try {
      const items = await fetchInstanceFeed(instance);
      hosts[instance] = { ok: true, at: started.toISOString() };
      answered = { instance, items };
      break;
    } catch (error) {
      const message = truncate(String((error as Error)?.message ?? error), 200);
      failures.push(`${instance}: ${message}`);
      hosts[instance] = { ok: false, at: started.toISOString(), error: message };
      console.error(JSON.stringify({ level: "warn", msg: "nitter instance failed", instance, error: message }));
    }
  }
  if (!answered) {
    const at = started.toISOString();
    await patchRssState({
      order: instances,
      hosts,
      lastAttemptAt: at,
      lastError: truncate(failures.join("；"), 1000),
      consecutiveFailures: previous.consecutiveFailures + 1,
      failedSince: previous.failedSince ?? at,
    });
    throw new Error(`no nitter instance answered (${tried}): ${failures.join("；")}`);
  }

  // Only what is newer than the newest post stored, and never the same post twice: an instance may repeat
  // an old item, and the feed's newest 20 overlap a ten-minute cadence many times over.
  const fresh = new Map(answered.items.filter((item) => !previous.sinceId || idGreater(item.id, previous.sinceId!)).map((item) => [item.id, item]));
  const existing = new Set((await sql<{ id: string }[]>`SELECT id FROM monitor_posts WHERE id = ANY(${[...fresh.keys()]}::text[])`).map((row) => row.id));
  let stored = 0;
  for (const item of [...fresh.values()].sort((a, b) => (idGreater(a.id, b.id) ? 1 : -1))) {
    if (existing.has(item.id)) continue;
    await storePost(item, answered.instance);
    stored++;
  }
  const newest = [...fresh.keys()].reduce<string | null>((newest, id) => (!newest || idGreater(id, newest) ? id : newest), previous.sinceId);
  await patchRssState({
    sinceId: newest,
    order: [answered.instance, ...instances.filter((instance) => instance !== answered.instance)],
    hosts,
    lastOkAt: started.toISOString(),
    lastAttemptAt: started.toISOString(),
    lastError: null,
    consecutiveFailures: 0,
    failedSince: null,
  });
  await touchWatermarks({ lastCollectedAt: started.toISOString() });
  return { stored, instance: answered.instance, tried };
}
