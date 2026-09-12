/** @jest-environment jsdom */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Pull the pre-paint theme block straight out of index.html so this test breaks
// if the real implementation changes.
const html = fs.readFileSync(path.join(__dirname, "..", "data", "index.html"), "utf8");
const m = html.match(/<script>\s*\/\/ Runs before first paint[\s\S]*?<\/script>/);
const SRC = m ? m[0].replace(/^<script>/, "").replace(/<\/script>$/, "") : null;

function run(store) {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.cssText = "";
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: () => {},
    removeItem: () => {},
  };
  vm.runInNewContext(SRC, { localStorage: ls, document, JSON, Object });
  return document.documentElement;
}

describe("pre-paint theme restore", () => {
  test("the inline block was found in index.html", () => {
    expect(SRC).toBeTruthy();
  });

  test("applies a saved theme before paint", () => {
    expect(run({ theme: "palenight" }).getAttribute("data-theme")).toBe("palenight");
  });

  test("leaves 'lighter' unset, matching changeTheme()", () => {
    // changeTheme() removes the attribute for lighter, so setting it here would
    // diverge from what the app does a moment later.
    expect(run({ theme: "lighter" }).getAttribute("data-theme")).toBeNull();
  });

  test("first visit with empty storage does nothing", () => {
    expect(run({}).getAttribute("data-theme")).toBeNull();
  });

  test("restores custom theme variables", () => {
    const root = run({
      theme: "custom",
      themeCustomColors: JSON.stringify({ "--custom-primary": "#ff0000", "--custom-background": "#101010" }),
    });
    expect(root.getAttribute("data-theme")).toBe("custom");
    expect(root.style.getPropertyValue("--custom-primary")).toBe("#ff0000");
    expect(root.style.getPropertyValue("--custom-background")).toBe("#101010");
  });

  test("tints the skeleton to the theme surfaces", () => {
    const root = run({
      theme: "forest",
      themeSurfaces: JSON.stringify({ bg: "#0b1f12", panel: "#14301f", border: "#1e4530" }),
    });
    expect(root.style.getPropertyValue("--sk-bg")).toBe("#0b1f12");
    expect(root.style.getPropertyValue("--sk-panel")).toBe("#14301f");
  });

  test("corrupt storage does not throw", () => {
    expect(() => run({ theme: "custom", themeCustomColors: "{not json" })).not.toThrow();
  });
});

describe("custom theme without cached colours", () => {
  // Regression: setting data-theme="custom" with no colours paints the CSS
  // var() fallbacks, which are teal green, until /config arrives.
  const fs2 = require("fs");
  const path2 = require("path");
  const vm2 = require("vm");
  const html2 = fs2.readFileSync(path2.join(__dirname, "..", "data", "index.html"), "utf8");
  const SRC2 = html2.match(/<script>\s*\/\/ Runs before first paint[\s\S]*?<\/script>/)[0]
    .replace(/^<script>/, "").replace(/<\/script>$/, "");

  function run2(store) {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
    vm2.runInNewContext(SRC2, {
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {} },
      document, JSON, Object,
    });
    return document.documentElement;
  }

  test("does NOT set data-theme=custom when no colours are cached", () => {
    expect(run2({ theme: "custom" }).getAttribute("data-theme")).toBeNull();
  });

  test("does NOT set it when the cached colours are an empty object", () => {
    expect(run2({ theme: "custom", themeCustomColors: "{}" }).getAttribute("data-theme")).toBeNull();
  });

  test("does set it once colours are available", () => {
    const root = run2({ theme: "custom", themeCustomColors: JSON.stringify({ "--custom-primary": "#7c4dff" }) });
    expect(root.getAttribute("data-theme")).toBe("custom");
    expect(root.style.getPropertyValue("--custom-primary")).toBe("#7c4dff");
  });
});
