const fs = require('fs');
const path = require('path');
const vm = require('vm');
const en = require('../data/locales/en.json');
const zh = require('../data/locales/zh-CN.json');

function flatten(value, prefix = '') {
  return Object.fromEntries(Object.entries(value).flatMap(([key, text]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return text && typeof text === 'object' ? Object.entries(flatten(text, name)) : [[name, text]];
  }));
}

test('Chinese translations preserve interpolation parameters and resolve new UI labels', () => {
  const english = flatten(en), chinese = flatten(zh);
  const parameters = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const [key, text] of Object.entries(chinese)) {
    expect(english).toHaveProperty([key]);
    expect(parameters(text)).toEqual(parameters(english[key]));
  }
  for (const key of ['history.marshal_title', 'analysis.race_title', 'rssi_debug.pilot']) {
    expect(chinese[key]).toBeTruthy();
    expect(chinese[key]).not.toBe(english[key]);
  }
});

test('translated attributes preserve nested live readouts and RC controls', () => {
  document.body.innerHTML = '<button data-i18n-title="history.marshal_title" data-i18n-aria-label="history.marshal_title"><b id="live">123</b></button><select><optgroup data-i18n-label="history.marshal_title"></optgroup></select>';
  const sandbox = { document, navigator: { language: 'zh-CN' }, localStorage: {getItem: () => 'zh-CN'}, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../data/i18n.js'), 'utf8') + '\nglobalThis.instance = i18n;', sandbox);
  sandbox.instance.locales = { en, 'zh-CN': zh };
  sandbox.instance.translatePage();
  expect(document.querySelector('button').title).toBe(zh.history.marshal_title);
  expect(document.querySelector('button').getAttribute('aria-label')).toBe(zh.history.marshal_title);
  expect(document.querySelector('optgroup').label).toBe(zh.history.marshal_title);
  expect(document.getElementById('live').textContent).toBe('123');

  document.body.innerHTML = fs.readFileSync(path.join(__dirname, '../data/index.html'), 'utf8');
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  expect(ids.length).toBe(new Set(ids).size);
  expect(document.getElementById('multiPilotRaceSummary')).not.toBeNull();
  expect(document.getElementById('raceAlwaysFastest')).not.toBeNull();
  expect(document.getElementById('rhConfigPanel')).toBeNull();
});
