"""Network fixes for the pinned AsyncTCP 3.5.0 / web server 3.12.1 pair."""
import glob
import os

OLD_DISCONNECT = '''void AsyncEventSourceClient::_onDisconnect() {
  if (!_client) {
    return;
  }
  _client = nullptr;
  _server->_handleDisconnect(this);
}'''
NEW_DISCONNECT = '''void AsyncEventSourceClient::_onDisconnect() {
  {
    // FPVGate SSE lock: finish an in-progress send before clearing its client.
    asyncsrv::lock_guard_type lock(_lockmq);
    if (!_client) return;
    _client = nullptr;
  }
  // This can destroy this object, so the guard must already be released.
  _server->_handleDisconnect(this);
}'''
OLD_DESTRUCTOR = '''AsyncEventSourceClient::~AsyncEventSourceClient() {
  // Protect message queue access (size checks and modifications) which is not thread-safe.
  asyncsrv::lock_guard_type lock(_lockmq);
  _messageQueue.clear();
  close();
}'''
NEW_DESTRUCTOR = '''AsyncEventSourceClient::~AsyncEventSourceClient() {
  {
    // FPVGate SSE lock: close can synchronously call disconnect callbacks.
    asyncsrv::lock_guard_type lock(_lockmq);
    _messageQueue.clear();
  }
  close();
}'''

OLD_WRITE = '''size_t AsyncClient::write(const char *data, size_t size, uint8_t apiflags) {
  size_t will_send = add(data, size, apiflags);
  if (!will_send || !send()) {
    return 0;
  }
  return will_send;
}'''
NEW_WRITE = '''size_t AsyncClient::write(const char *data, size_t size, uint8_t apiflags) {
  size_t will_send = add(data, size, apiflags);
  // FPVGate accepted bytes: add() already queued these bytes in lwIP.
  // A transient output failure must not make the response enqueue them twice.
  if (will_send) send();
  return will_send;
}'''


def patch_write(source):
    if source.count(NEW_WRITE) == 1:
        return source
    if source.count(OLD_WRITE) != 1:
        raise ValueError('AsyncTCP 3.5.0 write source changed; review accepted-byte accounting')
    return source.replace(OLD_WRITE, NEW_WRITE, 1)


def patch_text(source):
    for old, new in [(OLD_DISCONNECT, NEW_DISCONNECT), (OLD_DESTRUCTOR, NEW_DESTRUCTOR)]:
        if source.count(new) == 1:
            continue
        if source.count(old) != 1:
            raise ValueError('ESPAsyncWebServer 3.12.1 SSE source changed; review the lock patch')
        source = source.replace(old, new, 1)
    return source


def patch_dependency(build_env):
    directory = os.path.join(build_env.subst('$PROJECT_LIBDEPS_DIR'), build_env.subst('$PIOENV'))
    matched = 0
    for path in glob.glob(os.path.join(directory, 'ESPAsyncWebServer*', 'src', 'AsyncEventSource.cpp')):
        with open(path, encoding='utf-8') as stream:
            source = stream.read()
        if 'asyncsrv::lock_guard_type' not in source:
            continue
        updated = patch_text(source)
        if updated != source:
            with open(path, 'w', encoding='utf-8', newline='\n') as stream:
                stream.write(updated)
        matched += 1
        print('patch_async_sse_modern: verified ' + os.path.relpath(path, directory))
    if not matched:
        raise RuntimeError('No matching modern SSE dependency; refusing an unpatched build')
    path = os.path.join(directory, 'AsyncTCP', 'src', 'AsyncTCP.cpp')
    with open(path, encoding='utf-8') as stream:
        source = stream.read()
    updated = patch_write(source)
    if updated != source:
        with open(path, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(updated)
    print('patch_async_sse_modern: verified AsyncTCP accepted-byte accounting')


try:
    Import('env')  # noqa: F821
except NameError:
    env = None

if env is not None:
    _configure_before_sse_patch = env.ConfigureProjectLibBuilder

    def configure_with_sse_patch(build_env):
        builder = _configure_before_sse_patch()
        patch_dependency(build_env)
        return builder

    env.AddMethod(configure_with_sse_patch, 'ConfigureProjectLibBuilder')
