import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writePrivateJson } from '../src/util/PrivateFile';

describe('private state files', () => {
  let directory: string;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tuya-private-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

  test('replaces an existing permissive file with an owner-only file', async () => {
    const file = path.join(directory, 'profiles.json');
    await fs.writeFile(file, 'old', { mode: 0o644 });
    await writePrivateJson(file, { saved: true });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ saved: true });
    if (process.platform !== 'win32') {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
    expect(await fs.readdir(directory)).toEqual(['profiles.json']);
  });

  test('replaces destination symlink without overwriting its target', async () => {
    if (process.platform === 'win32') { return; }
    const target = path.join(directory, 'unrelated.txt');
    const file = path.join(directory, 'profiles.json');
    await fs.writeFile(target, 'UNRELATED_CANARY');
    await fs.symlink(target, file);
    await writePrivateJson(file, { saved: true });
    expect(await fs.readFile(target, 'utf8')).toBe('UNRELATED_CANARY');
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(false);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ saved: true });
  });

  test('a legacy predictable temporary symlink is never opened', async () => {
    if (process.platform === 'win32') { return; }
    const target = path.join(directory, 'unrelated.txt');
    const file = path.join(directory, 'profiles.json');
    const trap = `${file}.${process.pid}.tmp`;
    await fs.writeFile(target, 'UNRELATED_CANARY');
    await fs.symlink(target, trap);
    await writePrivateJson(file, { saved: true });
    expect(await fs.readFile(target, 'utf8')).toBe('UNRELATED_CANARY');
    expect((await fs.lstat(trap)).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(false);
  });

  test('concurrent saves publish complete JSON and leave no temporary files', async () => {
    const file = path.join(directory, 'profiles.json');
    await Promise.all(Array.from({ length: 6 }, (_, revision) => writePrivateJson(file, { revision, payload: 'x'.repeat(2048) })));
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.revision).toBeGreaterThanOrEqual(0);
    expect(saved.payload).toHaveLength(2048);
    expect(await fs.readdir(directory)).toEqual(['profiles.json']);
  });
});
