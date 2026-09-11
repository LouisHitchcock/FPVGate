/**
 * @jest-environment jsdom
 *
 * The merged race editor. Marshal became the single Edit screen, so lap times
 * are edited on the graph when a race has an RSSI trace. Races recorded before
 * the marshal feature (or with no SD card) have no trace and no graph, and fall
 * back to typed entry -- without it those races could not be edited at all.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "data", "script.js"), "utf8");

// Pull the pure helpers out of script.js rather than duplicating them here,
// so these tests fail if the real implementation changes. Brace-matching rather
// than a regex, because the bodies contain nested blocks.
function extractBody(name) {
  const head = `function ${name}(`;
  const at = SRC.indexOf(head);
  if (at < 0) throw new Error(`function ${name} not found in script.js`);
  let i = SRC.indexOf("{", at);
  let depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function extract(...names) {
  const sandbox = {
    i18n: { t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k) },
    alert: () => {},
    confirm: () => true,
    console,
  };
  const bodies = names.map(extractBody).join("\n");
  const fn = new Function(...Object.keys(sandbox), `${bodies}\nreturn {${names.join(",")}};`);
  return fn(...Object.values(sandbox));
}

const { segmentsToAbsPasses, absPassesToSegments } = extract("segmentsToAbsPasses", "absPassesToSegments");

describe("lap time round-tripping", () => {
  test("segments -> absolute passes -> segments is lossless", () => {
    const laps = [12500, 9800, 9750, 10200];
    expect(absPassesToSegments(segmentsToAbsPasses(laps))).toEqual(laps);
  });

  test("absolute passes are cumulative from race start", () => {
    expect(segmentsToAbsPasses([1000, 2000, 3000])).toEqual([1000, 3000, 6000]);
  });

  test("out-of-order passes are sorted before becoming segments", () => {
    // Dragging a marker past its neighbour must not produce a negative lap.
    const segs = absPassesToSegments([6000, 1000, 3000]);
    expect(segs).toEqual([1000, 2000, 3000]);
    expect(segs.every((s) => s > 0)).toBe(true);
  });

  test("a single pass yields one segment measured from the start", () => {
    expect(absPassesToSegments([7250])).toEqual([7250]);
  });
});

describe("typed lap entry validation", () => {
  // Mirrors the parse in saveRaceChanges: seconds in, milliseconds out.
  const parse = (v) => {
    const seconds = parseFloat(v);
    return { ms: Math.round(seconds * 1000), valid: !isNaN(seconds) && seconds > 0 };
  };

  test("accepts a normal lap time and converts to ms", () => {
    expect(parse("9.812")).toEqual({ ms: 9812, valid: true });
  });

  test.each([["0"], ["-1"], [""], ["abc"]])("rejects %p", (v) => {
    expect(parse(v).valid) .toBe(false);
  });

  test("rounds to the nearest millisecond", () => {
    expect(parse("9.8125").ms).toBe(9813);
    expect(parse("9.8124").ms).toBe(9812);
  });
});

describe("graph availability gate", () => {
  // Mirrors the hasHistory check in openRaceEditor.
  const hasHistory = (race) => !!(race.hasRssiHistory || (race.rssiHistory && race.rssiHistory.sampleCount));

  test("race with a sidecar uses the graph", () => {
    expect(hasHistory({ hasRssiHistory: true })).toBe(true);
    expect(hasHistory({ rssiHistory: { sampleCount: 36000 } })).toBe(true);
  });

  test("legacy race with no sidecar falls back to typed entry", () => {
    expect(hasHistory({})).toBe(false);
    expect(hasHistory({ hasRssiHistory: false, rssiHistory: { sampleCount: 0 } })).toBe(false);
  });
});
