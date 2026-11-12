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


def patch_response_memory(build_env):
    from pathlib import Path
    src = Path(build_env.subst('$PROJECT_LIBDEPS_DIR')) / build_env.subst('$PIOENV') / 'ESPAsyncWebServer' / 'src'
    header = src / 'WebResponseImpl.h'
    source = src / 'WebResponses.cpp'
    support = (Path(build_env.subst('$PROJECT_DIR')) / 'scripts/support/response_buffer.h').as_posix()
    text = header.read_text(encoding='utf-8')
    import re
    text = re.sub(r'#include "[^"]*/scripts/support/response_buffer\.h"', '#include "' + support + '"', text)
    old_size = '#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS * 2'
    new_size = '#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS // FPVGate one-segment response window'
    if old_size in text: text = text.replace(old_size, new_size, 1)
    elif new_size not in text: raise RuntimeError('Web response window changed; review TCP cap agreement')
    before = 'std::unique_ptr<std::array<uint8_t, ASYNC_RESPONCE_BUFF_SIZE> > _send_buffer;'
    after = 'std::unique_ptr<FpvResponseBuffer<ASYNC_RESPONCE_BUFF_SIZE>> _send_buffer;'
    if before in text:
        text = text.replace(before, after, 1)
        text = text.replace('#include <vector>', '#include <vector>\n#include "' + support + '" // FPVGate external response buffers', 1)
    elif after not in text:
        raise RuntimeError('Web response buffer layout changed; review PSRAM patch')
    if text != header.read_text(encoding='utf-8'): header.write_text(text, encoding='utf-8')
    text = source.read_text(encoding='utf-8')
    before = 'new (std::nothrow) std::array<uint8_t, ASYNC_RESPONCE_BUFF_SIZE>'
    after = 'new (std::nothrow) FpvResponseBuffer<ASYNC_RESPONCE_BUFF_SIZE>'
    if before in text: text = text.replace(before, after, 1)
    elif after not in text: raise RuntimeError('Web response allocation changed; review PSRAM patch')
    if text != source.read_text(encoding='utf-8'): source.write_text(text, encoding='utf-8')
    print('patch_async_sse_modern: verified external response buffers')


def patch_json_request_memory(build_env):
    from pathlib import Path
    source = Path(build_env.subst('$PROJECT_LIBDEPS_DIR')) / build_env.subst('$PIOENV') / 'ESPAsyncWebServer' / 'src' / 'AsyncJson.cpp'
    support = (Path(build_env.subst('$PROJECT_DIR')) / 'lib/RACEHISTORY/history_snapshot.h').as_posix()
    text = source.read_text(encoding='utf-8')
    before = '#else\n    JsonDocument doc;\n#endif'
    after = '#else\n    static HistorySnapshotAllocator requestAllocator;\n    JsonDocument doc(&requestAllocator); // FPVGate external request JSON\n#endif'
    if text.count(before) == 1:
        text = text.replace(before, after, 1)
        marker = '#include "AsyncJson.h"'
        if text.count(marker) != 1:
            raise RuntimeError('AsyncJson include layout changed; review request allocator')
        text = text.replace(marker, marker + '\n#include "' + support + '" // FPVGate request allocator', 1)
    elif text.count(after) != 1 or '// FPVGate request allocator' not in text:
        raise RuntimeError('AsyncJson parser layout changed; review request allocator')
    body_before = 'request->_tempObject = calloc(total + 1, sizeof(uint8_t));  // null-terminated string'
    body_after = '''static HistorySnapshotAllocator bodyAllocator;
        request->_tempObject = bodyAllocator.allocate(total + 1); // FPVGate external request body
        if (request->_tempObject) memset(request->_tempObject, 0, total + 1);'''
    if text.count(body_before) == 1:
        text = text.replace(body_before, body_after, 1)
    elif text.count(body_after) != 1:
        raise RuntimeError('AsyncJson body allocation changed; review request allocator')
    if text != source.read_text(encoding='utf-8'):
        source.write_text(text, encoding='utf-8')
    print('patch_async_sse_modern: verified external request JSON')


def patch_event_memory(build_env):
    from pathlib import Path
    src = Path(build_env.subst('$PROJECT_LIBDEPS_DIR')) / build_env.subst('$PIOENV') / 'ESPAsyncWebServer' / 'src'
    header, source = src / 'AsyncEventSource.h', src / 'AsyncEventSource.cpp'
    support = (Path(build_env.subst('$PROJECT_DIR')) / 'scripts/support/event_data.h').as_posix()
    text = header.read_text(encoding='utf-8')
    before = 'using AsyncEvent_SharedData_t = std::shared_ptr<String>;'
    after = 'using AsyncEvent_SharedData_t = std::shared_ptr<FpvEventData>;'
    if text.count(before) == 1:
        text = text.replace(before, '#include "' + support + '" // FPVGate external event bytes\n' + after, 1)
        text = text.replace('std::make_shared<String>', 'std::make_shared<FpvEventData>')
    elif text.count(after) != 1 or '// FPVGate external event bytes' not in text:
        raise RuntimeError('SSE shared-data layout changed; review external event bytes')
    if text != header.read_text(encoding='utf-8'): header.write_text(text, encoding='utf-8')
    text = source.read_text(encoding='utf-8')
    before, after = 'std::make_shared<String>(generateEventMessage(', 'std::make_shared<FpvEventData>(generateEventMessage('
    if text.count(before) == 2: text = text.replace(before, after)
    elif text.count(after) != 2: raise RuntimeError('SSE message construction changed; review external event bytes')
    if text != source.read_text(encoding='utf-8'): source.write_text(text, encoding='utf-8')
    print('patch_async_sse_modern: verified external event bytes')


def patch_file_admission(build_env):
    from pathlib import Path
    src = Path(build_env.subst('$PROJECT_LIBDEPS_DIR')) / build_env.subst('$PIOENV') / 'ESPAsyncWebServer' / 'src'
    header = src / 'WebResponseImpl.h'
    source = src / 'WebResponses.cpp'
    support = (Path(build_env.subst('$PROJECT_DIR')) / 'scripts/support/file_transfer_slots.h').as_posix()
    text = header.read_text(encoding='utf-8')
    before = 'class AsyncFileResponse : public AsyncAbstractResponse {'
    if 'FpvFileTransferSlot _fpvTransferSlot;' not in text:
        if text.count(before) != 1 or '  File _content;' not in text:
            raise RuntimeError('File response layout changed; review admission ownership')
        text = text.replace(before, '#include "' + support + '"\n' + before, 1)
        text = text.replace('  File _content;', '  FpvFileTransferSlot _fpvTransferSlot;\n  File _content;', 1)
    if text != header.read_text(encoding='utf-8'): header.write_text(text, encoding='utf-8')
    text = source.read_text(encoding='utf-8')
    before = 'size_t AsyncFileResponse::_fillBuffer(uint8_t *data, size_t len) {\n  return _content.read(data, len);'
    after = 'size_t AsyncFileResponse::_fillBuffer(uint8_t *data, size_t len) {\n  if (!_fpvTransferSlot.acquire()) return RESPONSE_TRY_AGAIN;\n  return _content.read(data, len);'
    if before in text: text = text.replace(before, after, 1)
    elif after not in text: raise RuntimeError('File fill callback changed; review deferred reads')
    before = '    _in_flight += payloadlen;\n    --_in_flight_credit;  // take a credit'
    after = '    if (payloadlen) { // A deferred read sends no bytes and consumes no credit.\n      _in_flight += payloadlen;\n      --_in_flight_credit;\n    }'
    if before in text: text = text.replace(before, after, 1)
    elif after not in text: raise RuntimeError('Response credit layout changed; review deferred polls')
    if text != source.read_text(encoding='utf-8'): source.write_text(text, encoding='utf-8')
    print('patch_async_sse_modern: verified two active file transfers and deferred-poll credit accounting')


try:
    Import('env')  # noqa: F821
except NameError:
    env = None

if env is not None:
    _configure_before_sse_patch = env.ConfigureProjectLibBuilder

    def configure_with_sse_patch(build_env):
        builder = _configure_before_sse_patch()
        patch_dependency(build_env)
        patch_response_memory(build_env)
        patch_file_admission(build_env)
        patch_json_request_memory(build_env)
        patch_event_memory(build_env)
        return builder

    env.AddMethod(configure_with_sse_patch, 'ConfigureProjectLibBuilder')
