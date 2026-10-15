// 读者可选的主题。id 一旦有人存下就不再改：localStorage、首屏脚本和版本 1 备份都认它们。
// light / dark 是最早的两套，老读者的存量照样有效；新主题只加 id，不改旧的。

export type ThemeMode = "light" | "dark";

export type ThemeId = "light" | "celadon" | "sepia" | "dark" | "ink" | "moss";

export interface ThemeSwatch {
  /** 页底色、卡片底色、强调色：切换器里三个小圆点就用它们。 */
  bg: string;
  surface: string;
  accent: string;
}

export interface ThemeDef {
  id: ThemeId;
  /** 短名，切换器里显示。 */
  name: string;
  mode: ThemeMode;
  /** 一句话，切换器里介绍它。 */
  blurb: string;
  swatch: ThemeSwatch;
  /** 浏览器外框（theme-color）跟页底走。 */
  themeColor: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "light", name: "雾白", mode: "light", blurb: "经典浅色，纸白底配科技蓝", swatch: { bg: "#f7f8fa", surface: "#ffffff", accent: "#2563eb" }, themeColor: "#f7f8fa" },
  { id: "celadon", name: "瓷青", mode: "light", blurb: "淡青底配墨绿字，久看不累", swatch: { bg: "#f1f4f2", surface: "#fdfffd", accent: "#0f766e" }, themeColor: "#f1f4f2" },
  { id: "sepia", name: "旧报", mode: "light", blurb: "暖纸底配赭石，像在读旧报纸", swatch: { bg: "#f5efe3", surface: "#fdfaf3", accent: "#9a4d0a" }, themeColor: "#f5efe3" },
  { id: "dark", name: "夜蓝", mode: "dark", blurb: "经典深色，深夜蓝底配荧光蓝", swatch: { bg: "#0d141d", surface: "#141d28", accent: "#4f8cff" }, themeColor: "#0d141d" },
  { id: "ink", name: "墨黑", mode: "dark", blurb: "近黑底，对比最高，夜里最省眼", swatch: { bg: "#0b0b0d", surface: "#141417", accent: "#6ea8ff" }, themeColor: "#0b0b0d" },
  { id: "moss", name: "苔绿", mode: "dark", blurb: "深苔绿底配新绿，夜里柔和", swatch: { bg: "#0c1411", surface: "#121c17", accent: "#4ade80" }, themeColor: "#0c1411" },
];

export const DEFAULT_LIGHT_THEME: ThemeId = "light";
export const DEFAULT_DARK_THEME: ThemeId = "dark";

/** 跟随系统时在两套经典主题之间选：系统深色用夜蓝，浅色用雾白。 */
export function systemTheme(dark: boolean): ThemeId {
  return dark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME;
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

export function themeOf(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export function themeMode(id: ThemeId): ThemeMode {
  return themeOf(id).mode;
}
