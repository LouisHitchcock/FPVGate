/**
 * Typed lap editing: delete drops a lap's time, merge keeps it.
 *
 * Requested on Discord: a false or double pass splits one real lap in two, and
 * deleting either half loses its time. Merge adds it to the neighbouring lap
 * so the race total is unchanged. Runs the real functions from script.js.
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

function editor(laps, { confirmed = true } = {}) {
  const state = { editLaps: [...laps], pilots: [] };
  const asked = [];
  let renders = 0;
  const stubs = {
    marshalState: state,
    syncLapEditState: () => {},
    renderLapEditList: () => { renders++; },
    confirm: (text) => { asked.push(text); return confirmed; },
    alert: () => {},
    i18n: { t: (k) => k },
  };
  const api = new Function(...Object.keys(stubs),
    `${["mergeLapInEditor", "deleteLapFromEditor"].map(extractBody).join("\n")}
     return { mergeLapInEditor, deleteLapFromEditor };`)(...Object.values(stubs));
  return { ...api, state, asked, renders: () => renders };
}

const total = (laps) => laps.reduce((a, b) => a + b, 0);

test("merge adds the lap to the next one and keeps the race total", () => {
  const e = editor([1500, 4000, 6000, 10000]);
  e.mergeLapInEditor(1);
  expect(e.state.editLaps).toEqual([1500, 10000, 10000]);
  expect(total(e.state.editLaps)).toBe(21500);
  expect(e.asked).toEqual(["history.edit_lap_merge_confirm"]);
  expect(e.renders()).toBe(1);
});

test("the last lap merges into the previous one", () => {
  const e = editor([1500, 10000, 6000, 4000]);
  e.mergeLapInEditor(3);
  expect(e.state.editLaps).toEqual([1500, 10000, 10000]);
});

test("a false Gate 1 merges into the first lap, which becomes Gate 1", () => {
  const e = editor([300, 1400, 10000]);
  e.mergeLapInEditor(0);
  expect(e.state.editLaps).toEqual([1700, 10000]);
});

test("nothing changes if the merge is cancelled or there is only one lap", () => {
  const cancelled = editor([1500, 4000, 6000], { confirmed: false });
  cancelled.mergeLapInEditor(1);
  expect(cancelled.state.editLaps).toEqual([1500, 4000, 6000]);
  const single = editor([1500]);
  single.mergeLapInEditor(0);
  expect(single.state.editLaps).toEqual([1500]);
  expect(single.asked).toEqual([]);
});

test("delete still drops the lap and its time", () => {
  const e = editor([1500, 4000, 6000, 10000]);
  e.deleteLapFromEditor(1);
  expect(e.state.editLaps).toEqual([1500, 6000, 10000]);
  expect(total(e.state.editLaps)).toBe(17500);
});
