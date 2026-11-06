// Compile the actual replacement/recovery methods against a fault-injected FS.
// This tests ordering/rollback, not the durability of physical SD/LittleFS media.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const source = fs.readFileSync(path.join(__dirname, '../lib/STORAGE/storage.cpp'), 'utf8');
function method(signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing method ${signature}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('production storage replacement preserves the last committed document and recovers interrupted renames', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpvgate-storage-'));
  const exe = path.join(dir, 'storage-test.exe');
  const cpp = `
#include <string>
#include <map>
#include <cassert>
using String = std::string;
#define HAS_SD_CARD_SUPPORT 1
#define pdMS_TO_TICKS(x) (x)
bool allowLock = true; int locks = 0;
bool spiMutexTake(int) { if (!allowLock) return false; ++locks; return true; }
void spiMutexGive() { --locks; }
namespace fs {
struct FS {
  std::map<String, String> files;
  String failFrom, failRemove;
  bool exists(const String& p) { return files.count(p); }
  bool remove(const String& p) { return p != failRemove && files.erase(p); }
  bool rename(const String& a, const String& b) {
    if (a == failFrom || !exists(a) || exists(b)) return false;
    files[b] = files[a]; files.erase(a); return true;
  }
};
}
fs::FS LittleFS, SD;
struct Storage {
  bool sdAvailable = false;
  bool recoverFile(const String&);
  bool replaceFileSafely(const String&, const String&);
};
${method('bool Storage::recoverFile(')}
${method('bool Storage::replaceFileSafely(')}
int main() {
  for (bool sd : {false, true}) {
    Storage s; s.sdAvailable = sd;
    auto& f = sd ? SD : LittleFS;
    f.files = {{"event", "old"}, {"temp", "new"}};
    assert(s.replaceFileSafely("temp", "event"));
    assert(f.files.at("event") == "new" && !f.exists("event.bak") && locks == 0);
    // Failure to install the staged replacement restores the old document.
    f.files = {{"event", "old"}, {"temp", "new"}}; f.failFrom = "temp";
    assert(!s.replaceFileSafely("temp", "event"));
    assert(f.files.at("event") == "old" && f.files.at("temp") == "new" && locks == 0);
    f.failFrom.clear(); assert(s.replaceFileSafely("temp", "event"));
    // Power loss after old -> backup: restore backup, not an uncommitted temp.
    f.files = {{"event.bak", "old"}, {"temp", "new"}};
    assert(s.recoverFile("event") && f.files.at("event") == "old");
    // Power loss after temp -> event: the new committed destination wins.
    f.files = {{"event.bak", "old"}, {"event", "new"}};
    assert(s.recoverFile("event") && f.files.at("event") == "new" && !f.exists("event.bak"));
    f.files = {{"event", "old"}, {"temp", "new"}}; f.failFrom = "event";
    assert(!s.replaceFileSafely("temp", "event") && f.files.at("event") == "old");
    f.failFrom.clear(); f.files["event.bak"] = "stale"; f.failRemove = "event.bak";
    assert(!s.replaceFileSafely("temp", "event") && f.files.at("event") == "old");
    f.failRemove.clear(); assert(locks == 0);
  }
  Storage s; s.sdAvailable = true; allowLock = false;
  const auto before = SD.files;
  assert(!s.recoverFile("event") && !s.replaceFileSafely("temp", "event"));
  assert(SD.files == before && locks == 0);
}
`;
  try {
    const build = spawnSync(process.env.CXX || 'g++', ['-std=c++17', '-x', 'c++', '-o', exe, '-'], { input: cpp, encoding: 'utf8', timeout: 20000 });
    expect({ status: build.status, stderr: build.stderr }).toEqual({ status: 0, stderr: '' });
    const result = spawnSync(exe, [], { encoding: 'utf8', timeout: 5000 });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
