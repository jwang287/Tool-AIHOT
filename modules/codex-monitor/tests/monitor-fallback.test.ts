// The twelve-hour fallback: while the feed keeps failing, one deep sweep reads every known instance (its
// feed, then its profile page) and Jina's rendering, stores what is new and runs the same recognition
// pipeline. Failure cases: a healthy feed skips the whole run, a source that answers nothing usable is
// given up, and a sweep that reads nothing at all fails the run.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, beforeEach, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { stub } from "./setup.ts";
import { monitorFindings } from "@aihot/codex-monitor/backend/ops";
import { fallbackInstances, monitorFallback, parseJinaPosts, parseProfilePosts, snowflakeDate } from "@aihot/codex-monitor/backend/scan-fallback";
import type { RssState } from "@aihot/codex-monitor/backend/scan-rss";

config.allowPrivateNetworkFetch = true;
delete process.env.SOCIALDATA_API_KEY;
delete process.env.JINA_API_KEY;

/** The recognition stub answers by the post it is given: only the reset announcement claims anything. */
const model = await stub((_hit, req) => {
  // The prompt opens with the post's own id; the open-event list it also carries must not decide this.
  const announcing = /帖子 (\d+)/.exec(req.body)?.[1] === RESET.id;
  const content = {
    relevant: announcing, translationZh: announcing ? "全球重置今天结束前到账。" : null, contextZh: [], outage: null, needsReview: false,
    propositions: announcing
      ? [{
        kind: "direct_reset", kindExplicit: true, action: "announce", real: true, count: 1, relatesTo: null,
        excerpt: "Global reset landing by EOD PST time", excerptZh: "全球重置今天结束前到账",
        statedTime: null, timeInferred: false, expectedLanding: null,
        scope: { audienceSource: null, plans: null, audienceZh: null, productsZh: null },
      }]
      : [],
  };
  return { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] };
});
process.env.DEEPSEEK_BASE_URL = model.url;
process.env.DEEPSEEK_API_KEY = "test-key";

const servers: Array<{ close: () => Promise<void> }> = [];
after(async () => {
  for (const server of servers) await server.close();
  await model.close();
  await stopBoss();
  await closeDb();
});

beforeEach(async () => {
  delete process.env.JINA_API_KEY;
  delete process.env.JINA_BASE_URL;
  await sql`DELETE FROM monitor_event_posts`;
  await sql`DELETE FROM monitor_events`;
  await sql`DELETE FROM monitor_posts`;
  await sql`DELETE FROM monitor_state`;
  await sql`DELETE FROM receipts WHERE purpose LIKE 'monitor.%'`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service IN ('deepseek', 'jina')`;
});

/** A server standing in for an instance or for Jina: every request answers by its path. */
async function instance(answer: (path: string) => string | { status: number; body: string }) {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "/");
    const out = answer(req.url ?? "/");
    const reply = typeof out === "string" ? { status: 200, body: out } : out;
    res.writeHead(reply.status, { "content-type": "text/xml; charset=utf-8" });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  const entry = { url: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  servers.push(entry);
  return entry;
}

const DOWN = "<!DOCTYPE html><html><body><p>upstream error</p></body></html>";
const CHALLENGE = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id=cf-wrapper></div></body></html>";

interface Item {
  id: string;
  title: string;
  /** As a feed writes it (RFC 822) and as a profile page writes it. */
  feedAt: string;
  pageAt: string;
}

/** A feed as the instances write it. */
function feed(items: Item[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Tibo / @thsottiaux</title>
${items.map((item) => `<item><title>${item.title}</title><guid>${item.id}</guid><pubDate>${item.feedAt}</pubDate>
  <link>http://instance.invalid/thsottiaux/status/${item.id}#m</link></item>`).join("\n")}
</channel></rss>`;
}

/** A profile page as nitter writes it: one timeline-item per post, its address and date in the footer. */
function profile(items: Item[], extra = ""): string {
  const blocks = items.map((item) => `  <div class="timeline-item " data-username="thsottiaux">
    <div class="tweet-body">
      <div class="tweet-content media-body" dir="auto">${item.title}</div>
      <div class="tweet-footer"><span class="tweet-date">
        <a href="/thsottiaux/status/${item.id}#m" title="${item.pageAt}">date</a></span></div>
    </div>
  </div>`).join("\n");
  return `<!DOCTYPE html><html><body><div class="timeline">${extra}\n${blocks}\n</div></body></html>`;
}

// The ids are the real ones and the times are the ones those ids carry (checked against the live feed):
// the feed's date, the page's date and the id agree to the second.
const RESET: Item = { id: "2109812360596865224", title: "Global reset landing by EOD PST time. Enjoy", feedAt: "Tue, 13 Oct 2026 01:03:59 GMT", pageAt: "Oct 13, 2026 · 01:03 AM UTC" };
const PLAN: Item = { id: "2109892247580000595", title: "Good plans are simple. I have one for more usage.", feedAt: "Tue, 13 Oct 2026 06:21:26 GMT", pageAt: "Oct 13, 2026 · 06:21 AM UTC" };
const NEXT: Item = { id: "2110151780478927344", title: "Day 9/ We have rolled out optimizations to disk usage.", feedAt: "Tue, 13 Oct 2026 23:32:43 GMT", pageAt: "Oct 13, 2026 · 11:32 PM UTC" };

const rssState = async () => (await sql<{ value: RssState }[]>`SELECT value FROM monitor_state WHERE key = 'rss'`)[0]?.value ?? null;
const watermarks = async () => (await sql<{ value: Record<string, string> }[]>`SELECT value FROM monitor_state WHERE key = 'watermarks'`)[0]?.value ?? {};
/** A failing feed, as the ten-minute scan leaves it. */
const failing = (failures = 3) => sql`INSERT INTO monitor_state (key, value) VALUES ('rss', ${sql.json({
  sinceId: PLAN.id, order: [], hosts: {}, lastOkAt: null, lastAttemptAt: new Date().toISOString(), lastError: "HTTP 503", consecutiveFailures: failures, failedSince: new Date().toISOString(),
} as never)})`;

test("a post's time can be read from its id, and a nitter date is parsed despite its middle dot", () => {
  // The feed's own pubDate for this id is 2026-10-13T23:32:43Z: the id carries the same instant.
  assert.equal(snowflakeDate(NEXT.id)!.toISOString(), "2026-10-13T23:32:43.847Z");
  assert.equal(snowflakeDate("not-an-id"), null);
  assert.equal(snowflakeDate("12345"), null, "a number this small is not a 2026 snowflake");

  const [post] = parseProfilePosts(profile([RESET]), "https://nitter.example.org");
  assert.equal(post!.id, RESET.id);
  assert.equal(post!.publishedAt.toISOString(), "2026-10-13T01:03:00.000Z");
  // Without a usable date the id is used rather than the post being dropped.
  const [undated] = parseProfilePosts(profile([{ ...RESET, pageAt: "not a date" }]), "https://nitter.example.org");
  assert.equal(undated!.publishedAt.toISOString(), "2026-10-13T01:03:59.841Z");
});

test("a profile page yields its posts: reposts and blocks with no post in them are left out", () => {
  const html = profile([NEXT], `<div class="timeline-item "><div class="retweet-header"><span>Someone retweeted</span></div>
    <div class="tweet-content media-body" dir="auto">a reposted post</div>
    <span class="tweet-date"><a href="/someone/status/2110000000000000000#m" title="Oct 13, 2026 · 09:00 PM UTC">date</a></span></div>
  <div class="timeline-item "><div class="tweet-content media-body" dir="auto">no address at all</div></div>`);
  const posts = parseProfilePosts(html, "https://nitter.example.org");
  assert.deepEqual(posts.map((post) => post.id), [NEXT.id]);
  assert.equal(posts[0]!.text, NEXT.title);
  assert.equal(posts[0]!.link, `https://nitter.example.org/thsottiaux/status/${NEXT.id}`);
  assert.deepEqual(parseProfilePosts(CHALLENGE, "https://nitter.example.org"), []);
});

test("Jina's rendering yields the posts it carries words for, and nothing from a sign-in wall", () => {
  const markdown = [
    "Title: Tibo (@thsottiaux) / X",
    "",
    "Markdown Content:",
    `[${NEXT.title}](https://x.com/thsottiaux/status/${NEXT.id})`,
    "",
    "· 2h",
    "",
    RESET.title,
    `https://x.com/thsottiaux/status/${RESET.id}`,
    "",
    "@thsottiaux",
    "1.2K",
  ].join("\n");
  const posts = parseJinaPosts(markdown);
  assert.deepEqual(posts.map((post) => post.id).sort(), [RESET.id, NEXT.id].sort());
  assert.equal(posts.find((post) => post.id === NEXT.id)!.text, NEXT.title);
  assert.equal(posts.find((post) => post.id === RESET.id)!.text, RESET.title);
  assert.equal(posts.find((post) => post.id === NEXT.id)!.publishedAt.toISOString(), "2026-10-13T23:32:43.847Z");
  // A rendering with no post of his is nothing to read, not an empty post.
  assert.deepEqual(parseJinaPosts("Markdown Content:\nNobody to see here. Sign in to X."), []);
});

test("the sweep covers the scan's own order, the configured instances and hosts it recorded before", () => {
  const health = { order: ["https://old.example.org"], hosts: { "https://gone.example.org": { ok: false, at: "now" } }, consecutiveFailures: 3 } as unknown as RssState;
  process.env.MONITOR_RSS_URLS = "nitter.example.org";
  const instances = fallbackInstances(health);
  assert.equal(instances[0], "https://old.example.org");
  assert.ok(instances.includes("https://nitter.example.org"));
  assert.ok(instances.includes("https://gone.example.org"));
});

test("an answering feed skips the whole fallback without touching an instance", async () => {
  const live = await instance(() => feed([RESET]));
  process.env.MONITOR_RSS_URLS = live.url;
  await sql`INSERT INTO monitor_state (key, value) VALUES ('rss', ${sql.json({
    sinceId: null, order: [], hosts: {}, lastOkAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastError: null, consecutiveFailures: 0, failedSince: null,
  } as never)})`;

  assert.deepEqual(await monitorFallback(), { skipped: "the feed is answering" });
  assert.equal(live.hits().length, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM monitor_posts`)[0]!.n, 0);
});

test("every instance is read feed-first, page-second, and only what is new is stored", async () => {
  const good = await instance((path) => (path.endsWith("/rss") ? feed([RESET, PLAN]) : DOWN));
  const pageOnly = await instance((path) => (path.endsWith("/rss") ? { status: 503, body: DOWN } : profile([NEXT])));
  const broken = await instance((path) => (path.endsWith("/rss") ? { status: 403, body: DOWN } : CHALLENGE));
  process.env.MONITOR_RSS_URLS = `${good.url},${pageOnly.url},${broken.url}`;
  await failing(3);

  const outcome = await monitorFallback();
  assert.ok(!("skipped" in outcome) && outcome.triggered.startsWith("rss failing 3x"));
  assert.deepEqual(outcome.sources, { tried: 3, answered: 2 });
  assert.equal(outcome.read, 3);
  assert.equal(outcome.stored, 3);
  assert.equal(outcome.processed, 3);
  assert.equal(outcome.events, 1, "the recognition made the announcement an event");
  assert.ok(outcome.verifiedAt, "nothing was left waiting");

  const state = await rssState();
  assert.equal(state.fallback!.ok, true);
  assert.equal(state.fallback!.stored, 3);
  assert.equal(state.fallback!.events, 1);
  assert.equal(state.fallback!.sources[`rss:${good.url}`]!.ok, true);
  assert.equal(state.fallback!.sources[`html:${good.url}`], undefined, "a feed that answered needs no page read");
  assert.equal(state.fallback!.sources[`rss:${pageOnly.url}`]!.ok, false);
  assert.equal(state.fallback!.sources[`html:${pageOnly.url}`]!.posts, 1);
  assert.match(state.fallback!.sources[`html:${broken.url}`]!.error!, /no posts on the profile page/);
  // The twelve-hour run leaves the ten-minute scan's own fields alone (its failure count, its cursor).
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.sinceId, PLAN.id);

  const posts = await sql<{ id: string; author: string; text: string; url: string; context: unknown; raw: { fallback: { source: string } }; processed_at: Date | null }[]>`
    SELECT id, author, text, url, context, raw, processed_at FROM monitor_posts ORDER BY published_at`;
  assert.deepEqual(posts.map((post) => post.id), [RESET.id, PLAN.id, NEXT.id]);
  assert.equal(posts[0]!.author, "thsottiaux");
  assert.equal(posts[0]!.text, RESET.title);
  assert.deepEqual(posts[0]!.context, []);
  assert.equal(posts[0]!.url, `https://x.com/thsottiaux/status/${RESET.id}`);
  assert.equal(posts[0]!.raw.fallback.source, `rss:${good.url}`);
  assert.equal(posts[2]!.raw.fallback.source, `html:${pageOnly.url}`);
  assert.ok(posts.every((post) => post.processed_at), "every post went through the recognition pipeline");
  assert.ok(Date.parse((await watermarks()).lastCollectedAt!) > 0);
});

test("Jina is read only where its key is set, and its refusal does not fail the sweep", async () => {
  const live = await instance(() => feed([RESET]));
  process.env.MONITOR_RSS_URLS = live.url;
  const jina = await instance(() => "Markdown Content:\n\nSign in to X to see more.");
  process.env.JINA_BASE_URL = jina.url;
  await failing();

  // No key: nothing is asked of it, and the sweep still succeeds.
  const withoutKey = await monitorFallback();
  assert.ok(!("skipped" in withoutKey));
  assert.equal(jina.hits().length, 0);
  assert.equal((await rssState()).fallback!.sources["jina"], undefined);

  // With the key: it is tried, and a rendering without posts is recorded without failing the run.
  process.env.JINA_API_KEY = "test-key";
  const refusing = await monitorFallback();
  assert.ok(!("skipped" in refusing));
  assert.equal(jina.hits().length, 1);
  const refusal = (await rssState()).fallback!.sources["jina"]!;
  assert.equal(refusal.ok, false);
  assert.match(refusal.error!, /no posts in the rendering/);

  // A rendering that does carry a post: it is stored beside the feed's own.
  await sql`UPDATE monitor_posts SET processed_at = NULL`;
  const working = await instance(() => `Markdown Content:\n\n[${NEXT.title}](https://x.com/thsottiaux/status/${NEXT.id})\n`);
  process.env.JINA_BASE_URL = working.url;
  const withPost = await monitorFallback();
  assert.ok(!("skipped" in withPost));
  assert.equal(withPost.stored, 1);
  assert.equal((await rssState()).fallback!.sources["jina"]!.posts, 1);
  assert.deepEqual((await sql<{ id: string }[]>`SELECT id FROM monitor_posts ORDER BY published_at`).map((post) => post.id), [RESET.id, NEXT.id]);
});

test("a sweep that reads nothing at all fails the run and says what each source answered", async () => {
  const down = await instance((path) => (path.endsWith("/rss") ? { status: 503, body: DOWN } : CHALLENGE));
  const refusing = await instance(() => CHALLENGE);
  process.env.MONITOR_RSS_URLS = `${down.url},${refusing.url}`;
  await failing(5);

  await assert.rejects(monitorFallback(), /no source answered \(2\).*503.*no posts on the profile page/);
  const state = await rssState();
  assert.equal(state.fallback!.ok, false);
  assert.equal(state.fallback!.stored, 0);
  assert.equal(state.fallback!.lastOkAt, null);
  assert.match(state.fallback!.lastError!, /no source answered/);
  assert.equal(state.consecutiveFailures, 5, "the scan's own count is still there");
});

test("the alert says when the fallback is still covering a broken feed", async () => {
  const live = await instance(() => feed([RESET]));
  process.env.MONITOR_RSS_URLS = live.url;
  await failing(4);
  await monitorFallback();

  const [finding] = (await monitorFindings(Date.now())).filter((f) => f.key === "monitor.rss");
  assert.ok(finding, "the feed's own alert still stands");
  assert.match(finding!.detail!, /4 次连续失败/);
  assert.match(finding!.detail!, /12 小时兜底任务最近一次成功/);
});
