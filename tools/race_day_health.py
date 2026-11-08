"""Qualification health contracts shared by the overnight controller and tests."""


def gate_failure(label, sample, baseline, receiver_version):
    system, storage, receiver = sample['system'], sample['storage'], sample['receiver']['c5']
    if label == 'aio' and system['heapLow'] < 40000:
        return f'AIO internal heap below 40000 bytes: {system["heapLow"]}'
    if not storage['sdAvailable']:
        return f'{label}: SD unavailable; refusing LittleFS fallback'
    if storage['boot'] != baseline['storage']['boot']:
        return f'{label}: unexpected restart ({baseline["storage"]["boot"]} -> {storage["boot"]})'
    if storage['writeFailures'] > baseline['storage']['writeFailures']:
        return f'{label}: SD log write failure'
    if storage.get('lost', 0) > baseline['storage'].get('lost', 0):
        return f'{label}: retained log bytes lost'
    if not receiver['online'] or receiver['version'] != receiver_version:
        return f'{label}: receiver offline or version changed'
    current_eth = system.get('ethernet', {}).get('w5500', {})
    previous_eth = baseline['system'].get('ethernet', {}).get('w5500', {})
    for key in ('rxErrors', 'rxNoMem', 'txTimeout', 'txErrors'):
        if current_eth.get(key, 0) > previous_eth.get(key, 0):
            return f'{label}: W5500 {key} increased'
    return None


def phase_failure(counts, returncode=None, stop_requested=False):
    return bool(stop_requested or counts.get('FAIL', 0) or counts.get('ERROR', 0)
                or (returncode is not None and returncode != 0))


def phase_schedule(rehearsal_seconds, duration_seconds):
    if rehearsal_seconds < 0 or duration_seconds <= 0:
        raise ValueError('Nonnegative rehearsal and positive duration required')
    return ([('rehearsal', rehearsal_seconds)] if rehearsal_seconds else []) + [
        ('overnight' if rehearsal_seconds else 'soak', duration_seconds)]
