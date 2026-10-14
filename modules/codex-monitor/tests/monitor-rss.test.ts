// The free path: reading @thsottiaux's feed from the Nitter instances, storing only posts that are new by
// id, and handing them to the same recognition pipeline as the paid scan. Failure cases: an instance that
// answers an HTML queue page (or an empty feed) with status 200, every instance failing, and an item whose
// id or time cannot be read.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, beforeEach, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { stub } from "./setup.ts";
import { codexResetsSnapshot } from "@aihot/codex-monitor/backend/read";
import { monitorFindings } from "@aihot/codex-monitor/backend/ops";
import { collectPostsRss, parseFeed, rssInstances, tweetIdOf, type RssState } from "@aihot/codex-monitor/backend/scan-rss";
import { processPending } from "@aihot/codex-monitor/backend/scan";

config.allowPrivateNetworkFetch = true;
// The paid key decides which source the module polls; this file covers the free path.
delete process.env.SOCIALDATA_API_KEY;

let modelAnswer: unknown = {};
const model = await stub(() => ({ choices: [{ message: { content: JSON.stringify(modelAnswer) }, finish_reason: "stop" }] }));
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
  modelAnswer = {};
  await sql`DELETE FROM monitor_event_posts`;
  await sql`DELETE FROM monitor_events`;
  await sql`DELETE FROM monitor_posts`;
  await sql`DELETE FROM monitor_state`;
  await sql`DELETE FROM receipts WHERE purpose LIKE 'monitor.%'`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service = 'deepseek'`;
});

/** An instance standing in for Nitter: every request answers with what `answer` returns. */
async function instance(answer: () => string | { status: number; body: string }) {
  const server = http.createServer((_req, res) => {
    const out = answer();
    const reply = typeof out === "string" ? { status: 200, body: out } : out;
    res.writeHead(reply.status, { "content-type": "application/xml; charset=utf-8" });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  const entry = { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  servers.push(entry);
  return entry;
}

/** What several instances answer when they are down or queueing readers. */
const QUEUE_PAGE = "<!DOCTYPE html><html><body><p>Nitter Access Queue</p></body></html>";

interface Item {
  id: string;
  title: string;
  at: string;
}

/** A feed as the instances write it (CDATA body, HTML entities in the title, id in guid and link). */
function feed(items: Item[]): string {
  const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Tibo / @thsottiaux</title>
    <link>http://instance.invalid/thsottiaux</link>
    <description>Twitter feed for: @thsottiaux</description>
    <ttl>40</ttl>
${items.map((item) => `    <item>
      <title>${escaped(item.title)}</title>
      <dc:creator>@thsottiaux</dc:creator>
      <description><![CDATA[<p>${escaped(item.title)}</p>]]></description>
      <pubDate>${item.at}</pubDate>
      <guid>${item.id}</guid>
      <link>http://instance.invalid/thsottiaux/status/${item.id}#m</link>
    </item>`).join("\n")}
  </channel>
</rss>`;
}

const RESET_AT = "Tue, 13 Oct 2026 05:06:10 GMT";
const PLAN_AT = "Tue, 13 Oct 2026 06:21:26 GMT";
const NEXT_AT = "Tue, 13 Oct 2026 23:32:43 GMT";
const RESET = { id: "2109812360596865224", title: "R to @thsottiaux: Global reset landing by EOD PST time. Enjoy", at: RESET_AT };
const PLAN = { id: "2109892247580000595", title: "Good plans are simple. I have one that should result in significantly more usage for everyone.", at: PLAN_AT };
const NEXT = { id: "2110151780478927344", title: "Day 9/ We&apos;ve rolled out optimizations &amp; fewer writes to disk.", at: NEXT_AT };

const rssState = async () => (await sql<{ value: RssState }[]>`SELECT value FROM monitor_state WHERE key = 'rss'`)[0]!.value;
const watermarks = async () => (await sql<{ value: Record<string, string> }[]>`SELECT value FROM monitor_state WHERE key = 'watermarks'`)[0]!.value;

test("a feed parses into posts: the reply prefix goes, reposts and unusable items are dropped", () => {
  const items = parseFeed(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Tibo / @thsottiaux</title>
  <item><title>Day 9/ We&apos;ve rolled out optimizations &amp; fewer writes.</title><guid>2110151780478927344</guid>
    <pubDate>Tue, 13 Oct 2026 23:32:43 GMT</pubDate><link>http://i.invalid/thsottiaux/status/2110151780478927344#m</link>
    <description><![CDATA[<p>Day 9/<br><br>We&apos;ve rolled out optimizations.</p>]]></description></item>
  <item><title>R to @thsottiaux: Global reset landing by EOD PST time. Enjoy</title><guid>2109812360596865224</guid>
    <pubDate>Tue, 13 Oct 2026 05:06:10 GMT</pubDate><link>http://i.invalid/thsottiaux/status/2109812360596865224#m</link></item>
  <item><title>RT by @someone: a post of theirs</title><guid>2109000000000000000</guid><pubDate>Tue, 13 Oct 2026 05:00:00 GMT</pubDate></item>
  <item><title>a post without a usable time</title><guid>2108000000000000000</guid><pubDate>not a date</pubDate></item>
  <item><title>the channel's own entry, no post id</title><guid>tag:instance.invalid,2026:channel</guid><pubDate>Tue, 13 Oct 2026 05:00:00 GMT</pubDate></item>
</channel></rss>`);
  assert.deepEqual(items.map((item) => item.id), ["2110151780478927344", "2109812360596865224"]);
  assert.equal(items[0]!.text, "Day 9/ We've rolled out optimizations & fewer writes.");
  assert.equal(items[0]!.publishedAt.toISOString(), "2026-10-13T23:32:43.000Z");
  assert.match(items[0]!.description ?? "", /^Day 9\/ We've rolled out optimizations\.$/);
  assert.equal(items[1]!.text, "Global reset landing by EOD PST time. Enjoy");
  assert.equal(items[1]!.link, "http://i.invalid/thsottiaux/status/2109812360596865224#m");
});

test("what is not a feed, and a feed with no posts, are refused rather than read as an empty day", () => {
  assert.throws(() => parseFeed(QUEUE_PAGE), /not a feed/);
  assert.deepEqual(parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>`), []);
  assert.equal(tweetIdOf("2110151780478927344"), "2110151780478927344");
  assert.equal(tweetIdOf(undefined, "https://nitter.kareem.one/thsottiaux/status/2110151780478927344#m"), "2110151780478927344");
  assert.equal(tweetIdOf("tag:twitter.com,2007:status:2110151780478927344"), "2110151780478927344");
  assert.equal(tweetIdOf("thsottiaux", "http://instance.invalid/thsottiaux"), null);
});

test("MONITOR_RSS_URLS replaces the built-in instances, as hosts or as full addresses", () => {
  delete process.env.MONITOR_RSS_URLS;
  assert.ok(rssInstances().includes("https://nitter.kareem.one"));
  process.env.MONITOR_RSS_URLS = " nitter.example.org , https://nitter.example.com/ , http://127.0.0.1:8080 ";
  assert.deepEqual(rssInstances(), ["https://nitter.example.org", "https://nitter.example.com", "http://127.0.0.1:8080"]);
});

test("instances are tried in turn: a queue page from the first, the feed from the second", async () => {
  const queueing = await instance(() => QUEUE_PAGE);
  const live = await instance(() => feed([RESET, PLAN]));
  process.env.MONITOR_RSS_URLS = `${queueing.url},${live.url}`;

  const collected = await collectPostsRss();
  assert.equal(collected.instance, live.url);
  assert.equal(collected.stored, 2);
  assert.equal(collected.tried, 2);

  const state = await rssState();
  assert.equal(state.hosts[queueing.url]!.ok, false);
  assert.match(state.hosts[queueing.url]!.error!, /not a feed/);
  assert.equal(state.hosts[live.url]!.ok, true);
  // Next scan starts with the one that worked, so a dead instance is only paid for once.
  assert.deepEqual(state.order, [live.url, queueing.url]);
  assert.equal(state.sinceId, PLAN.id);
  assert.equal(state.consecutiveFailures, 0);

  const posts = await sql<{ id: string; author: string; text: string; url: string; context: unknown; raw: { rss: { instance: string } }; origin: string }[]>`
    SELECT id, author, text, url, context, raw, origin FROM monitor_posts ORDER BY published_at`;
  assert.deepEqual(posts.map((p) => p.id), [RESET.id, PLAN.id]);
  assert.equal(posts[0]!.author, "thsottiaux");
  assert.equal(posts[0]!.text, "Global reset landing by EOD PST time. Enjoy");
  // A reply arrives without the post it answers, and the paid path's x.com address is kept.
  assert.deepEqual(posts[0]!.context, []);
  assert.equal(posts[0]!.url, `https://x.com/thsottiaux/status/${RESET.id}`);
  assert.equal(posts[0]!.raw.rss.instance, live.url);
  assert.equal(posts[0]!.origin, "live");
});

test("a second scan stores only what is newer than the newest post, whatever the feed repeats", async () => {
  let items = [RESET, PLAN];
  const live = await instance(() => feed(items));
  process.env.MONITOR_RSS_URLS = live.url;

  assert.equal((await collectPostsRss()).stored, 2);
  const first = await watermarks();
  assert.equal((await collectPostsRss()).stored, 0);

  items = [NEXT, PLAN, RESET];
  assert.equal((await collectPostsRss()).stored, 1);
  const state = await rssState();
  assert.equal(state.sinceId, NEXT.id);
  assert.deepEqual((await sql<{ id: string }[]>`SELECT id FROM monitor_posts ORDER BY published_at`).map((p) => p.id), [RESET.id, PLAN.id, NEXT.id]);
  assert.ok(Date.parse((await watermarks()).lastCollectedAt!) >= Date.parse(first.lastCollectedAt!), "the collected watermark only moves forward");
});

test("posts read from the feed go through the same recognition pipeline", async () => {
  const live = await instance(() => feed([RESET]));
  process.env.MONITOR_RSS_URLS = live.url;
  modelAnswer = {
    relevant: true, translationZh: "全球重置今天结束前到账。", contextZh: [], outage: null, needsReview: false,
    propositions: [{
      kind: "direct_reset", kindExplicit: true, action: "announce", real: true, count: 1, relatesTo: null,
      excerpt: "Global reset landing by EOD PST time", excerptZh: "全球重置今天结束前到账",
      statedTime: null, timeInferred: false, expectedLanding: null,
      scope: { audienceSource: null, plans: null, audienceZh: null, productsZh: null },
    }],
  };

  assert.equal((await collectPostsRss()).stored, 1);
  assert.deepEqual(await processPending(), { processed: 1, failed: 0 });
  const snapshot = await codexResetsSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0]!.type, "direct_reset");
  assert.equal(snapshot.events[0]!.status, "announced");
});

test("every instance failing fails the run, keeps what each said, and alerts after three in a row", async () => {
  const down = await instance(() => ({ status: 503, body: "upstream error" }));
  const empty = await instance(() => feed([]));
  process.env.MONITOR_RSS_URLS = `${down.url},${empty.url}`;

  await assert.rejects(collectPostsRss(), new RegExp(`no nitter instance answered \\(2\\).*HTTP 503.*feed has no posts`));
  const state = await rssState();
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.hosts[down.url]!.ok, false);
  assert.match(state.hosts[down.url]!.error!, /HTTP 503/);
  assert.match(state.hosts[empty.url]!.error!, /feed has no posts/);
  assert.ok(state.failedSince);
  assert.ok(!(await monitorFindings(Date.now())).some((finding) => finding.key === "monitor.rss"), "half an hour of failures is when the owner hears of it");

  await assert.rejects(collectPostsRss());
  await assert.rejects(collectPostsRss());
  const [finding] = (await monitorFindings(Date.now())).filter((f) => f.key === "monitor.rss");
  assert.ok(finding, "three failures in a row are reported");
  assert.equal(finding!.level, "today");
  assert.match(finding!.detail!, /3 次连续失败/);
  assert.match(finding!.detail!, /HTTP 503/);
  assert.ok(finding!.since);

  // A working instance clears the streak and the report.
  const live = await instance(() => feed([RESET]));
  process.env.MONITOR_RSS_URLS = `${live.url},${down.url}`;
  assert.equal((await collectPostsRss()).stored, 1);
  assert.equal((await rssState()).consecutiveFailures, 0);
  assert.ok(!(await monitorFindings(Date.now())).some((f) => f.key === "monitor.rss"));
});
