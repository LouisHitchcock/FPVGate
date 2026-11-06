/**
 * Diagnostics: the browser-side C5 receiver checks and the downloadable log.
 * Runs the real functions from script.js.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "data", "script.js"), "utf8");

function extractBody(name) {
  const head = `function ${name}(`;
  const at = SRC.indexOf(head);
  if (at < 0) throw new Error(`function ${name} not found in script.js`);
  let depth = 0;
  for (let j = SRC.indexOf("{", at); j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const pairedVersion = SRC.match(/const C5_PAIRED_VERSION = "([^"]+)"/)[1];
const { evaluateC5Checks, buildLogText, describeLogStatus } = new Function("i18n",
  `const C5_PAIRED_VERSION = ${JSON.stringify(pairedVersion)};
   ${["evaluateC5Checks", "buildLogText", "describeLogStatus"].map(extractBody).join("\n")}
   return { evaluateC5Checks, buildLogText, describeLogStatus };`)({
  t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k),
});

const frame = (over = {}) => ({ on: true, started: true, ready: true, race: false, samples: 1000, seqGaps: 0,
  queueDrops: 0, badRecords: 0, ...over });
const update = { c5: { online: true, version: pairedVersion, board: "xiaoc5" } };
const pilots = [{ frequency: 5658, race: 1 }, { frequency: 5695, race: 1 }, { frequency: 0, race: 0 }];
const statusOf = (results) => Object.fromEntries(results.map((r) => [r.key, r.status]));

describe("C5 receiver checks", () => {
  test("a healthy receiver passes every check", () => {
    const r = evaluateC5Checks([frame(), frame({ samples: 1600 })], update, pilots, 6);
    expect(statusOf(r)).toEqual({ connected: "pass", version: "pass", tuning: "pass", slots: "pass", samples: "pass", link: "pass" });
    expect(r.find((x) => x.key === "slots").detail).toContain("5658, 5695 MHz");
  });

  test("no telemetry fails without inventing other results", () => {
    expect(evaluateC5Checks([], update, pilots, 6)).toEqual([
      { key: "connected", status: "fail", detail: "No receiver telemetry arrived from the gate" }]);
  });

  test("checks are skipped while a race runs", () => {
    expect(statusOf(evaluateC5Checks([frame({ race: true })], update, pilots, 6))).toEqual({ race: "skip" });
  });

  test("an offline, untuned receiver with no new samples fails", () => {
    const r = statusOf(evaluateC5Checks([frame({ on: false, ready: false }), frame({ on: false, ready: false })],
      { c5: { version: "" } }, pilots, 6));
    expect(r).toMatchObject({ connected: "fail", version: "fail", tuning: "fail", samples: "fail" });
  });

  test("another receiver version, no racing slots and new link errors are warnings", () => {
    const r = evaluateC5Checks([frame(), frame({ samples: 1500, seqGaps: 2, badRecords: 1 })],
      { c5: { version: "1.2.4", board: "c5zero" } }, [{ frequency: 0, race: 1 }], 6);
    expect(statusOf(r)).toMatchObject({ version: "warn", slots: "warn", link: "warn" });
    expect(r.find((x) => x.key === "version").detail).toContain(`paired with ${pairedVersion}`);
    expect(r.find((x) => x.key === "link").detail).toBe("2 sequence gaps, 0 dropped samples, 1 bad records during the check");
  });
});

describe("downloadable log", () => {
  const base = { now: "2026-11-06T13:00:00Z", page: "http://192.168.0.65/", browser: "jest",
    info: { version: "1.9.0", board: "WaveshareS3ETH" }, c5: update, core: { present: false, resetReason: 3 },
    status: { sdEnabled: false } };

  test("without SD saving it includes status and the recent lines in order", () => {
    const text = buildLogText({ ...base, recent: { logs: [{ timestamp: 10, message: "first" }, { timestamp: 20, message: "second" }] } });
    expect(text).toContain('"board": "WaveshareS3ETH"');
    expect(text).toContain("No crash dump stored (reset reason 3)");
    expect(text).toContain("== System self-test ==\nNot run on this page");
    expect(text.indexOf("[10] first")).toBeLessThan(text.indexOf("[20] second"));
    expect(text).not.toContain("SD card log");
  });

  test("with SD saving it uses the card's files, older file first", () => {
    const text = buildLogText({ ...base, sdOld: "old line\n", sdNow: "new line\n",
      recent: { logs: [{ timestamp: 1, message: "memory only" }] },
      selfTest: [{ name: "SD Card", status: "pass", details: "32 GB" }],
      c5Checks: [{ key: "link", status: "warn", detail: "2 sequence gaps" }] });
    expect(text.indexOf("old line")).toBeLessThan(text.indexOf("new line"));
    expect(text).not.toContain("memory only");
    expect(text).toContain("PASS  SD Card: 32 GB");
    expect(text).toContain("WARN  link: 2 sequence gaps");
  });

  test("a stored crash dump is written out in full", () => {
    const text = buildLogText({ ...base, core: { present: true, pc: "0x42001234", backtrace: ["0x1"] }, recent: { logs: [] } });
    expect(text).toContain('"pc": "0x42001234"');
  });

  test("the switch status explains each state", () => {
    expect(describeLogStatus({ sdAvailable: false })).toBe("settings.diagnostics.log_status_no_sd");
    expect(describeLogStatus({ sdAvailable: true, sdEnabled: false, recoveredPrevious: true }))
      .toBe("settings.diagnostics.log_status_off settings.diagnostics.log_status_recovered");
    expect(describeLogStatus({ sdAvailable: true, sdEnabled: true, fileBytes: 2048, oldFileBytes: 1024, lost: 5 }))
      .toBe('settings.diagnostics.log_status_on:{"size":"3 KB"} 5 bytes were lost before they could be saved.');
  });
});
