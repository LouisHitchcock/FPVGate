/** @jest-environment node */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('ELRS backpack switch core passes native assertions', () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpvgate-elrs-'));
  const executable = path.join(temp, process.platform === 'win32' ? 'test.exe' : 'test');
  const compiler = process.env.CXX || (process.platform === 'win32' && fs.existsSync('C:/Strawberry/c/bin/g++.exe')
    ? 'C:/Strawberry/c/bin/g++.exe' : 'g++');
  try {
    execFileSync(compiler, ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-Ilib/ELRSBACKPACK',
      'tests/native/elrs_backpack_core_test.cpp', '-o', executable], { cwd: root });
    expect(execFileSync(executable, { encoding: 'utf8' })).toContain('all assertions passed');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}, 30000);
