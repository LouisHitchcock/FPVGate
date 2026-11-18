// C5 laps reach the gate through the web server's lap drain, not LapTimer, so
// the gate's own lap flash has to be given there. This checks the wiring in
// the production source; the flash itself is verified on hardware.
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../lib/WEBSERVER/webserver.cpp'), 'utf8');

function lapDrain() {
  const start = source.indexOf('while (c5MultiPilot->takeLap(lap))');
  if (start < 0) throw new Error('Missing the C5 lap drain');
  const end = source.indexOf('A reboot asked for over HTTP', start);
  if (end < 0) throw new Error('Missing the end of the C5 lap drain');
  return source.slice(start, end);
}

test('every batch of C5 laps flashes the gate LEDs once', () => {
  const drain = lapDrain();
  const loopEnd = drain.indexOf('lapTaken = true;');
  const flash = drain.indexOf('if (lapTaken)');
  expect(loopEnd).toBeGreaterThan(0);
  expect(flash).toBeGreaterThan(loopEnd);
  const after = drain.slice(flash);
  expect(after).toContain('led->on(200)');
  expect(after).toMatch(/#ifdef HAS_RGB_LED[\s\S]*g_rgbLed->flashLap\(\)[\s\S]*#endif/);
});

test('the C5 lap webhook honours the same settings as an RX5808 lap', () => {
  const after = lapDrain().slice(lapDrain().indexOf('if (lapTaken)'));
  expect(after).toMatch(/conf->getGateLEDsEnabled\(\) && conf->getWebhookLap\(\)\)\s*{\s*webhooks->triggerLap\(\);/);
});

test('the lap flash does not depend on a browser stream being free', () => {
  // The RSSI frame is skipped while the event stream is backed up; laps and
  // their flash must not be.
  const drainStart = source.indexOf('while (c5MultiPilot->takeLap(lap))');
  const busy = source.lastIndexOf('if (!streamBusy(events)) {', drainStart);
  const busyBlockEnd = source.indexOf('events.send(timingPayload, "c5Timing");', busy);
  expect(busy).toBeGreaterThan(0);
  expect(busyBlockEnd).toBeLessThan(drainStart);
});
