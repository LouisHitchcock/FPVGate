// History filtering runs in the browser; the gate still serves bounded pages.
function historyRaceLaps(race) {
  const pilots = Array.isArray(race.pilots) && race.pilots.length ? race.pilots : [race];
  return pilots.reduce((sum, p) => sum + Math.max(0, (p.lapTimes || []).length - 1), 0);
}
function historyPilotText(race) {
  return [race.pilotName, race.pilotCallsign, ...(race.pilots || []).flatMap(p => [p.name, p.callsign])]
    .filter(Boolean).join(' ').toLowerCase();
}
function historyDateBoundary(value, end) {
  if (!value) return null;
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return null;
  if (end) date.setDate(date.getDate() + 1);
  return date.getTime();
}
function filterHistoryRows(races, filters = {}, now = Date.now()) {
  const pilot = (filters.pilot || '').trim().toLowerCase();
  const search = (filters.search || '').trim().toLowerCase();
  const from = historyDateBoundary(filters.from, false), to = historyDateBoundary(filters.to, true);
  const min = filters.minLaps === '' || filters.minLaps == null ? null : Number(filters.minLaps);
  const max = filters.maxLaps === '' || filters.maxLaps == null ? null : Number(filters.maxLaps);
  const days = {'24h': 1, '7d': 7, '30d': 30}[filters.imported];
  const rows = races.map((race, index) => ({race, index})).filter(({race}) => {
    const names = historyPilotText(race), laps = historyRaceLaps(race), date = race.timestamp * 1000;
    if (pilot && !names.includes(pilot)) return false;
    if (search && ![names, race.name, race.tag, race.trackName, race.notes].filter(Boolean).join(' ').toLowerCase().includes(search)) return false;
    if (from !== null && date < from || to !== null && date >= to) return false;
    if (min !== null && Number.isFinite(min) && laps < min || max !== null && Number.isFinite(max) && laps > max) return false;
    const imported = Number(race.importedAt) || 0;
    if (filters.imported && filters.imported !== 'all' && !imported) return false;
    if (days && imported * 1000 < now - days * 86400000) return false;
    return true;
  });
  const mode = filters.sort || 'race-desc';
  return rows.sort((a, b) => {
    let difference = 0;
    if (mode === 'race-asc') difference = a.race.timestamp - b.race.timestamp;
    else if (mode === 'import-desc') difference = (Number(b.race.importedAt) || 0) - (Number(a.race.importedAt) || 0);
    else if (mode === 'laps-desc') difference = historyRaceLaps(b.race) - historyRaceLaps(a.race);
    else if (mode === 'laps-asc') difference = historyRaceLaps(a.race) - historyRaceLaps(b.race);
    return difference || b.race.timestamp - a.race.timestamp;
  });
}
function readHistoryFilters() {
  const value = id => document.getElementById(id)?.value || '';
  return {pilot: value('historyPilot'), search: value('historySearch'), from: value('historyFrom'), to: value('historyTo'),
    minLaps: value('historyMinLaps'), maxLaps: value('historyMaxLaps'), imported: value('historyImported'), sort: value('historySort')};
}
function applyHistoryFilters() { renderRaceHistory(); }
function clearHistoryFilters() {
  for (const id of ['historyPilot', 'historySearch', 'historyFrom', 'historyTo', 'historyMinLaps', 'historyMaxLaps']) {
    const field = document.getElementById(id); if (field) field.value = '';
  }
  const imported = document.getElementById('historyImported'), sort = document.getElementById('historySort');
  if (imported) imported.value = 'all';
  if (sort) sort.value = 'race-desc';
  renderRaceHistory();
}
