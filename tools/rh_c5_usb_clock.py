"""Experimental C5-only RH serial snapshot clock adapter.

Opt-in laboratory helper, not installed in RH or release firmware. C5MK
1.2.4 freezes both halves on READ_LAP_PASS_STATS, so their ages refer to
that first read, not the later READ_LAP_EXTREMUMS reply. The wire protocol
still has integer-ms ages; this does not promise sub-ms RF accuracy.
"""
from functools import wraps

PASS_STATS = 0x0d
EXTREMUMS = 0x0e
C5_BOARDS = frozenset(('c5zero', 'xiaoc5'))


def install(serial_node, *, anchor_first=False, on_pair=None):
    """Instrument real read pairs; optionally anchor only C5MK 1.2.4 snapshots.

Returns a function restoring the original method. Other node firmware is
untouched. Logging receives completed data after the serial I/O finishes.
"""
    original = serial_node.SerialNode.read_block

    @wraps(original)
    def read(node, interface, command, size, *args, **kwargs):
        board = getattr(node, 'firmware_proctype_str', '')
        version = getattr(node, 'firmware_version_str', '')
        port = getattr(node, 'serial', None)
        # RH 4.4 only populates proctype on the first node of a serial
        # multi-node device. Its other seats share the SAME Serial object.
        # Propagate verified identity only through that object, never a port
        # name or another receiver, and never override an explicit other type.
        if board in C5_BOARDS and version.startswith('1.2.4') and port is not None:
            port._c5_snapshot_board = board
        if not board and port is not None:
            board = getattr(port, '_c5_snapshot_board', '')
        c5 = board in C5_BOARDS and version.startswith('1.2.4')
        if not c5:
            return original(node, interface, command, size, *args, **kwargs)
        data = original(node, interface, command, size, *args, **kwargs)
        if command == PASS_STATS:
            node._c5_snapshot_clock = ((node.io_request, node.io_response, list(data))
                                       if data is not None else None)
        elif command == EXTREMUMS:
            first = getattr(node, '_c5_snapshot_clock', None)
            node._c5_snapshot_clock = None
            if data is not None and first is not None:
                second = (node.io_request, node.io_response)
                if anchor_first:
                    node.io_request, node.io_response = first[:2]
                if on_pair is not None:
                    on_pair({'node': node.index, 'pass_request': first[0], 'pass_response': first[1],
                             'ext_request': second[0], 'ext_response': second[1],
                             'pass_stats': first[2], 'extremums': list(data),
                             'anchor_first': anchor_first})
        return data

    serial_node.SerialNode.read_block = read

    def undo():
        if serial_node.SerialNode.read_block is read:
            serial_node.SerialNode.read_block = original

    return undo
