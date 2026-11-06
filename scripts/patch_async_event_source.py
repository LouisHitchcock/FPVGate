"""Fix a crash in ESPAsyncWebServer's event streams (AsyncEventSource.cpp).

The gate sends events (live RSSI, laps, RotorHazard passes) from its own tasks,
while AsyncTCP's task handles a stream's disconnect. The library's
AsyncEventSourceClient::_onDisconnect() set _client to null without taking the
client's message lock, so a send already inside that lock (_queueMessage ->
_runQueue -> _client->send()) could go on to use a null _client: a
LoadProhibited at 0xac in AsyncClient::send(), and a reboot. It happened on a
XIAO on 1.9.0-Multi-Alpha-3 after about a day; with AsyncTCP on core 0 beside
parallelTask, which it preempts, the window is easier to hit.

The patch:
- _onDisconnect() clears _client under the lock, so it waits for a send in
  progress to finish;
- both _queueMessage()s check _client, as a send can reach a client after its
  disconnect, before the server has removed it;
- the destructor calls close() outside the lock: close() calls _onDisconnect()
  directly, which now takes the lock, and std::mutex isn't recursive.

The library is fetched at a pinned commit (lib_deps), so this patches the
installed copy. PlatformIO installs lib_deps in ConfigureProjectLibBuilder,
after pre: scripts run but before anything is compiled, so the patch runs
straight after it. The build fails if the library no longer matches, rather
than going out without the fix.

Wired up as `extra_scripts = pre:scripts/patch_async_event_source.py`.
"""

import glob
import os

Import("env")  # noqa: F821  - injected by PlatformIO

MARK = "FPVGate patch"

REPLACEMENTS = [
    (
        """AsyncEventSourceClient::~AsyncEventSourceClient() {
#ifdef ESP32
  std::lock_guard<std::mutex> lock(_lockmq);
#endif
  _messageQueue.clear();
  close();
}""",
        """AsyncEventSourceClient::~AsyncEventSourceClient() {
  {
#ifdef ESP32
    std::lock_guard<std::mutex> lock(_lockmq);
#endif
    _messageQueue.clear();
  }
  // FPVGate patch: outside the lock, as close() calls _onDisconnect(), which takes it.
  close();
}""",
        1,
    ),
    (
        "  if (_messageQueue.size() < SSE_MAX_QUEUED_MESSAGES >> 2 && _client->canSend()) {",
        "  // FPVGate patch: _client is null once disconnected, before the server removes this client.\n"
        "  if (_client && _messageQueue.size() < SSE_MAX_QUEUED_MESSAGES >> 2 && _client->canSend()) {",
        2,
    ),
    (
        """void AsyncEventSourceClient::_onDisconnect() {
  if (!_client)
    return;
  _client = nullptr;
  _server->_handleDisconnect(this);
}""",
        """void AsyncEventSourceClient::_onDisconnect() {
  if (!_client)
    return;
  {
    // FPVGate patch: under the lock, so a send in progress finishes with
    // _client before it is cleared.
#ifdef ESP32
    std::lock_guard<std::mutex> lock(_lockmq);
#endif
    _client = nullptr;
  }
  _server->_handleDisconnect(this);
}""",
        1,
    ),
]


def patch_event_source(env):
    libdeps = os.path.join(env.subst("$PROJECT_LIBDEPS_DIR"), env.subst("$PIOENV"))
    patched = 0
    for path in glob.glob(os.path.join(libdeps, "ESPAsyncWebServer*", "src", "AsyncEventSource.cpp")):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if MARK in text:
            patched += 1
            continue
        counts = [text.count(old) for old, _, _ in REPLACEMENTS]
        if not any(counts):
            # Another version left in libdeps by an older pin; not the one built.
            continue
        if counts != [n for _, _, n in REPLACEMENTS]:
            print(f"*** patch_async_event_source: {path} has changed (matches {counts}); "
                  "update scripts/patch_async_event_source.py")
            env.Exit(1)
        for old, new, _ in REPLACEMENTS:
            text = text.replace(old, new)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"patch_async_event_source: patched {os.path.relpath(path, libdeps)}")
        patched += 1
    if not patched:
        print("*** patch_async_event_source: no ESPAsyncWebServer AsyncEventSource.cpp to patch in " + libdeps)
        env.Exit(1)


_configure = env.ConfigureProjectLibBuilder


def ConfigureProjectLibBuilder(env):
    builder = _configure()
    patch_event_source(env)
    return builder


env.AddMethod(ConfigureProjectLibBuilder)
