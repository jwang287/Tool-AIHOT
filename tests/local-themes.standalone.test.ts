// Theme choices across versions: new ids apply before paint, unknown stored values fall back to
// the system theme, denied storage falls back to the classic light theme, and version-1 backups
// carry the new ids without touching a reader's existing choice.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { APPEARANCE_BOOT_SCRIPT, applyTheme, exportBundle, getThemePreference, importBundle, KEYS, resolvedTheme, setThemePreference } from "../apps/web/app/lib/local-state.ts";
import { themeOf } from "../apps/web/app/lib/themes.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const store = new MemoryStorage();
const systemDark = { matches: false };
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: store,
    matchMedia: () => ({ matches: systemDark.matches, addEventListener: () => {}, removeEventListener: () => {} }),
  },
});
const attributes: Record<string, string> = {};
const metas = [{ media: "(prefers-color-scheme: light)", content: "" }, { media: "(prefers-color-scheme: dark)", content: "" }];
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    documentElement: { setAttribute: (key: string, value: string) => { attributes[key] = value; }, style: {} as Record<string, string> },
    querySelectorAll: () => metas,
  },
});

function boot({ stored, dark, blocked }: { stored: string | null; dark: boolean; blocked?: boolean }) {
  const seen: Record<string, string> = {};
  runInNewContext(APPEARANCE_BOOT_SCRIPT, {
    localStorage: { getItem: (key: string) => { if (blocked) throw new Error("blocked"); return key === KEYS.theme ? stored : null; } },
    window: { matchMedia: () => ({ matches: dark }) },
    document: { documentElement: { setAttribute: (key: string, value: string) => { seen[key] = value; } }, querySelectorAll: () => [] },
  });
  return seen;
}

test("startup applies a saved theme id with its mode before rendering", () => {
  for (const id of ["light", "celadon", "sepia", "dark", "ink", "moss"] as const) {
    const seen = boot({ stored: id, dark: false });
    assert.equal(seen["data-theme"], id);
    assert.equal(seen["data-mode"], themeOf(id).mode);
  }
});

test("startup falls back to the system theme, and to light when storage is blocked", () => {
  assert.equal(boot({ stored: null, dark: true })["data-theme"], "dark");
  assert.equal(boot({ stored: null, dark: false })["data-theme"], "light");
  assert.equal(boot({ stored: "removed-theme", dark: true })["data-theme"], "dark");
  const blocked = boot({ stored: "dark", dark: true, blocked: true });
  assert.equal(blocked["data-theme"], "light");
  assert.equal(blocked["data-mode"], "light");
});

test("stored choices resolve, apply and back up across the new ids", () => {
  store.values.clear();
  assert.equal(getThemePreference(), null);
  systemDark.matches = true;
  assert.equal(resolvedTheme(null), "dark");
  systemDark.matches = false;
  assert.equal(resolvedTheme(null), "light");

  setThemePreference("moss");
  assert.equal(getThemePreference(), "moss");
  assert.equal(resolvedTheme(), "moss");
  applyTheme("moss", false);
  assert.equal(attributes["data-theme"], "moss");
  assert.equal(attributes["data-mode"], "dark");
  assert.deepEqual(metas.map((m) => m.content), [themeOf("moss").themeColor, themeOf("moss").themeColor]);
  applyTheme(resolvedTheme(null), true);
  assert.equal(attributes["data-theme"], "light");
  assert.deepEqual(metas.map((m) => m.content), [themeOf("light").themeColor, themeOf("dark").themeColor]);

  store.values.set(KEYS.theme, "removed-theme");
  assert.equal(getThemePreference(), null, "unknown stored values read as never chosen");

  setThemePreference("sepia");
  assert.equal(exportBundle().theme, "sepia");
  setThemePreference(null);
  importBundle(JSON.stringify({ version: 1, starred: [], read: [], theme: "ink" }));
  assert.equal(getThemePreference(), "ink", "backups carry the new ids");
  importBundle(JSON.stringify({ version: 1, starred: [], read: [], theme: "auto" }));
  assert.equal(getThemePreference(), "ink", "merging does not overwrite the reader's choice");
  setThemePreference(null);
  importBundle(JSON.stringify({ version: 1, starred: [], read: [], theme: "dark" }));
  assert.equal(getThemePreference(), "dark", "old backups with light/dark remain valid");
  setThemePreference(null);
});
