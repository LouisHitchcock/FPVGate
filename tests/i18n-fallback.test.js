/**
 * @jest-environment jsdom
 *
 * Per-key fallback in i18n.t().
 *
 * The Visual Marshal strings were added to en.json only. Before this change t()
 * picked a single locale table and, if the key was missing from it, rendered the
 * raw dotted key. A user on de/es/fr/zh-CN would have seen "history.marshal_title"
 * in the UI instead of a label.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "data", "i18n.js");
const EN = path.join(__dirname, "..", "data", "locales", "en.json");

function newI18n(currentLang) {
  const sandbox = {
    localStorage: {
      getItem: (k) => (k === "fpvgate_lang" ? currentLang : null),
      setItem: () => {},
    },
    navigator: { language: "en-GB" },
    document: { documentElement: {}, addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] },
    console,
    fetch: async () => {
      throw new Error("locale fetch is not exercised by these tests");
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8") + "\n;globalThis.__I18n = I18n;", sandbox);
  return new sandbox.__I18n();
}

describe("i18n per-key fallback", () => {
  const en = { history: { marshal_title: "Visual Marshal", close: "Close" } };
  const de = { history: { close: "Schliessen" } };

  test("uses the current language when the key exists there", () => {
    const i18n = newI18n("de");
    i18n.locales = { de, en };
    expect(i18n.t("history.close")).toBe("Schliessen");
  });

  test("falls back to English for a key missing from the current language", () => {
    const i18n = newI18n("de");
    i18n.locales = { de, en };
    expect(i18n.t("history.marshal_title")).toBe("Visual Marshal");
  });

  test("returns the key when neither language has it", () => {
    const i18n = newI18n("de");
    i18n.locales = { de, en };
    expect(i18n.t("history.does_not_exist")).toBe("history.does_not_exist");
  });

  test("interpolates params on a fallback string", () => {
    const i18n = newI18n("de");
    i18n.locales = { de: {}, en: { history: { marshal_at: "at {time}s" } } };
    expect(i18n.t("history.marshal_at", { time: "12.500" })).toBe("at 12.500s");
  });

  test("every marshal key in en.json resolves for a locale that lacks them", () => {
    const enFile = JSON.parse(fs.readFileSync(EN, "utf8"));
    const marshalKeys = Object.keys(enFile.history).filter((k) => k.startsWith("marshal"));
    expect(marshalKeys.length).toBeGreaterThan(0);

    const i18n = newI18n("fr");
    i18n.locales = { fr: { history: {} }, en: enFile };
    for (const k of marshalKeys) {
      const key = `history.${k}`;
      expect(i18n.t(key)).not.toBe(key);
    }
  });
});
