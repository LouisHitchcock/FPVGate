/**
 * @jest-environment jsdom
 *
 * The size guard in the firmware update panel.
 *
 * This is what stops a device still holding the old 1MB filesystem partition
 * being handed a 3.875MB image. Without it the write fails part way through,
 * and for the firmware slot that means a device that will not boot. It is the
 * single check protecting existing users during the 1.8.0 rollout, so it is
 * worth proving it fires rather than trusting that it would.
 */
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "data", "script.js"), "utf8");

// Pull the real implementation out of script.js rather than restating it, so
// this test breaks if the guard changes.
function extract(name) {
  const head = `function ${name}(`;
  const at = SRC.indexOf(head);
  if (at < 0) throw new Error(`${name} not found in script.js`);
  let depth = 0;
  for (let j = SRC.indexOf("{", at); j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function build(deviceInfo) {
  const sandbox = {
    i18n: { t: (k, p) => `${k}|${JSON.stringify(p || {})}` },
    otaDeviceInfo: deviceInfo,
    console,
  };
  const body = extract("formatBytes") + "\n" + extract("checkOtaSizes");
  const fn = new Function(
    ...Object.keys(sandbox),
    `${body}\nreturn checkOtaSizes;`
  );
  return fn(...Object.values(sandbox));
}

// A device on the 1.8.0 partition table.
const NEW_TABLE = { app: { updateSize: 2097152 }, filesystem: { size: 4063232 } };
// A device still on the pre-1.8.0 table: 1MB filesystem.
const OLD_TABLE = { app: { updateSize: 2097152 }, filesystem: { size: 1048576 } };

const file = (size) => ({ size });

describe("firmware update size guard", () => {
  test("accepts images that fit", () => {
    const check = build(NEW_TABLE);
    expect(check(file(1329616), file(4063232))).toEqual([]);
  });

  test("REFUSES a 3.875MB filesystem on a device with a 1MB partition", () => {
    // The rollout case. This must fail, and must mention needing a wire flash.
    const problems = build(OLD_TABLE)(null, file(4063232));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("err_too_big_fs");
  });

  test("refuses a firmware image larger than the update slot", () => {
    const problems = build(NEW_TABLE)(file(2097153), null);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("err_too_big_app");
  });

  test("reports both when both are too big", () => {
    expect(build(OLD_TABLE)(file(9999999), file(4063232))).toHaveLength(2);
  });

  test("accepts an image exactly the size of its partition", () => {
    // littlefs images are always exactly the partition size, so an
    // off-by-one here would reject every legitimate filesystem update.
    expect(build(NEW_TABLE)(null, file(4063232))).toEqual([]);
    expect(build(NEW_TABLE)(file(2097152), null)).toEqual([]);
  });

  test("passes when the device reported no sizes, rather than blocking", () => {
    // The panel disables itself when device info is missing, so this path
    // should not also invent failures.
    expect(build(null)(file(9999999), file(9999999))).toEqual([]);
  });
});
