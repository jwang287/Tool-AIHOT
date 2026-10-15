// The theme catalogue: ids stay valid once readers have them stored, every theme resolves to a
// light or dark mode, and the previews carry real colours.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, isThemeId, systemTheme, THEMES, themeMode, themeOf } from "../app/lib/themes.ts";

const HEX = /^#[0-9a-f]{6}$/;

test("the catalogue keeps the two classic ids and resolves every theme to a mode", () => {
  assert.equal(THEMES.length, 6);
  const ids = THEMES.map((t) => t.id);
  assert.deepEqual([...ids].sort(), [...new Set(ids)].sort(), "theme ids must be unique");
  assert.ok(ids.includes("light") && ids.includes("dark"), "stored light/dark choices stay valid");
  assert.equal(DEFAULT_LIGHT_THEME, "light");
  assert.equal(DEFAULT_DARK_THEME, "dark");
  for (const t of THEMES) {
    assert.ok(t.name && t.blurb, `${t.id} needs a name and a blurb`);
    assert.ok(t.mode === "light" || t.mode === "dark");
    assert.equal(themeMode(t.id), t.mode);
    assert.ok(HEX.test(t.themeColor), `${t.id} theme-color must be a hex colour`);
    for (const c of [t.swatch.bg, t.swatch.surface, t.swatch.accent]) assert.ok(HEX.test(c), `${t.id} swatch must be hex colours`);
  }
  assert.deepEqual(THEMES.filter((t) => t.mode === "light").length, 3);
  assert.deepEqual(THEMES.filter((t) => t.mode === "dark").length, 3);
});

test("following the system picks between the two classic themes", () => {
  assert.equal(systemTheme(true), "dark");
  assert.equal(systemTheme(false), "light");
});

test("unknown stored values never resolve to a theme", () => {
  assert.equal(isThemeId("light"), true);
  assert.equal(isThemeId("moss"), true);
  for (const v of ["auto", "system", "", null, undefined, 42, "Light", "night"]) assert.equal(isThemeId(v), false);
  assert.equal(themeOf("light").id, "light");
});
