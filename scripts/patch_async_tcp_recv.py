"""Guard detached-client receive callbacks in the pinned AsyncTCP dependency.

The overnight core has _tcp_recv(arg=null, pb=null) calling _lwip_fin on a
null AsyncClient. Close detaches tcp_arg before removing the callbacks, so
lwIP can still invoke this callback without a client. Never dispatch it.
"""
import glob
import os

MARK = '// FPVGate: receive callback may outlive its detached client.'
OLD = '''static int8_t _tcp_recv(void* arg, struct tcp_pcb* pcb, struct pbuf* pb, int8_t err) {
  lwip_event_packet_t* e = (lwip_event_packet_t*)malloc(sizeof(lwip_event_packet_t));
  e->arg = arg;'''
NEW = '''static int8_t _tcp_recv(void* arg, struct tcp_pcb* pcb, struct pbuf* pb, int8_t err) {
  // FPVGate: receive callback may outlive its detached client.
  if (!arg) {
    if (pb) {
      tcp_recved(pcb, pb->tot_len);
      pbuf_free(pb);
    }
    return ERR_OK;
  }
  lwip_event_packet_t* e = (lwip_event_packet_t*)malloc(sizeof(lwip_event_packet_t));
  if (!e) return ERR_MEM; // lwIP retains the pbuf for a retry.
  e->arg = arg;'''


def patch_text(source):
    if MARK in source:
        if source.count(NEW) != 1:
            raise ValueError('AsyncTCP receive patch has changed')
        return source
    if source.count(OLD) != 1:
        raise ValueError('Pinned AsyncTCP receive callback does not match')
    return source.replace(OLD, NEW, 1)


def patch_dependency(build_env):
    directory = os.path.join(build_env.subst('$PROJECT_LIBDEPS_DIR'), build_env.subst('$PIOENV'))
    matched = 0
    for path in glob.glob(os.path.join(directory, 'AsyncTCP*', 'src', 'AsyncTCP.cpp')):
        with open(path, encoding='utf-8') as stream:
            source = stream.read()
        if OLD not in source and MARK not in source:
            continue  # An unused dependency from a different pin may remain.
        updated = patch_text(source)
        if updated != source:
            with open(path, 'w', encoding='utf-8', newline='\n') as stream:
                stream.write(updated)
        matched += 1
        print('patch_async_tcp_recv: verified ' + os.path.relpath(path, directory))
    if not matched:
        raise RuntimeError('No matching pinned AsyncTCP receive callback; refusing an unpatched build')


try:
    Import('env')  # noqa: F821 - PlatformIO, absent during offline tests
except NameError:
    env = None

if env is not None:
    _configure_before_recv_patch = env.ConfigureProjectLibBuilder

    def configure_with_recv_patch(build_env):
        builder = _configure_before_recv_patch()
        patch_dependency(build_env)
        return builder

    env.AddMethod(configure_with_recv_patch, 'ConfigureProjectLibBuilder')
