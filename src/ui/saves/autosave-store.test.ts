import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, createLateGameTestSave, serializeSimWorld } from '../../sim/save-load';
import { createSimWorld } from '../../sim/world';
import { buildAutosaveMeta, type AutosaveMeta } from './autosave-meta';
import { AUTOSAVE_BLOB_KEY, AUTOSAVE_META_KEY, AutosaveStore, type AutosaveBackend } from './autosave-store';

class FakeBackend implements AutosaveBackend {
  readonly data = new Map<string, unknown>();
  fail: 'none' | 'get' | 'set' | 'delete' | 'all' = 'none';
  /** Resolve writes late, to prove operations still apply in call order. */
  slowWrites = false;

  private check(op: 'get' | 'set' | 'delete'): void {
    if (this.fail === op || this.fail === 'all') throw new Error(`blocked: ${op}`);
  }

  async get(key: string): Promise<unknown> {
    this.check('get');
    return this.data.get(key);
  }

  async setAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void> {
    this.check('set');
    if (this.slowWrites) await new Promise((resolve) => setTimeout(resolve, 5));
    for (const [key, value] of entries) this.data.set(key, value);
  }

  async deleteAll(keys: readonly string[]): Promise<void> {
    this.check('delete');
    for (const key of keys) this.data.delete(key);
  }
}

function metaFor(tick: number, saveVersion = SAVE_VERSION): AutosaveMeta {
  return buildAutosaveMeta({
    setup: { mapName: 'Bohemian Riverlands' },
    mission: null,
    difficulty: 'medium',
    tick,
    saveVersion,
    gameSpeed: 1,
    savedAt: 1_700_000_000_000,
    appVersion: '0.0.64',
  });
}

function realBlob(): { blob: string; tick: number } {
  const snapshot = serializeSimWorld(createSimWorld(7), 'Autosave');
  return { blob: JSON.stringify(snapshot), tick: snapshot.tick };
}

describe('ui/saves/autosave-store', () => {
  it('writes and reads back a real save with its metadata', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    const { blob, tick } = realBlob();
    const meta = metaFor(tick);

    expect(await store.readMeta()).toBeNull();
    expect(await store.write(meta, blob)).toBe(true);
    expect(await store.readMeta()).toEqual(meta);

    const record = await store.load();
    expect(record?.meta).toEqual(meta);
    expect(record?.snapshot.version).toBe(SAVE_VERSION);
    expect(record?.snapshot.tick).toBe(tick);
    expect(record?.snapshot.entities.length).toBeGreaterThan(0);
  });

  it('loads the late-game fixture blob', async () => {
    const store = new AutosaveStore(new FakeBackend());
    const snapshot = createLateGameTestSave();
    await store.write(metaFor(snapshot.tick), JSON.stringify(snapshot));
    expect((await store.load())?.snapshot.entities.length).toBe(snapshot.entities.length);
  });

  it('overwrites the single slot and clears it', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    const { blob } = realBlob();
    await store.write(metaFor(100), blob);
    await store.write(metaFor(700), blob);
    expect((await store.readMeta())?.tick).toBe(700);
    expect(backend.data.size).toBe(2);

    await store.clear();
    expect(await store.readMeta()).toBeNull();
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('drops a corrupt blob instead of throwing', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    await store.write(metaFor(100), '{"version":3,"entities":');
    expect(await store.readMeta()).not.toBeNull();
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
    expect(await store.readMeta()).toBeNull();
  });

  it('drops a slot whose blob is missing or not text', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    backend.data.set(AUTOSAVE_META_KEY, metaFor(100));
    expect(await store.load()).toBeNull();
    expect(backend.data.has(AUTOSAVE_META_KEY)).toBe(false);

    backend.data.set(AUTOSAVE_META_KEY, metaFor(100));
    backend.data.set(AUTOSAVE_BLOB_KEY, { not: 'text' });
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('drops a save from a newer build, by metadata and by blob version', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    const { blob } = realBlob();

    await store.write(metaFor(100, SAVE_VERSION + 1), blob);
    expect(await store.readMeta()).toBeNull();
    expect(backend.data.size).toBe(0);

    const newer = JSON.stringify({ ...JSON.parse(blob), version: SAVE_VERSION + 1 });
    await store.write(metaFor(100), newer);
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('drops garbage metadata', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    backend.data.set(AUTOSAVE_META_KEY, { format: 99 });
    backend.data.set(AUTOSAVE_BLOB_KEY, realBlob().blob);
    expect(await store.readMeta()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('never resumes a decided match', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    const finished = { ...JSON.parse(realBlob().blob), outcome: { state: 'victory', winnerPlayerId: 1, mode: 'conquest' } };
    await store.write(metaFor(100), JSON.stringify(finished));
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('survives a parser that throws', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend, {
      parse: () => {
        throw new Error('migration blew up');
      },
    });
    await store.write(metaFor(100), realBlob().blob);
    expect(await store.load()).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('degrades to "no save" when the backend is blocked', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    backend.fail = 'all';
    expect(await store.write(metaFor(100), realBlob().blob)).toBe(false);
    expect(await store.readMeta()).toBeNull();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('keeps working after a failed write (quota) and keeps the previous save', async () => {
    const backend = new FakeBackend();
    const store = new AutosaveStore(backend);
    const { blob } = realBlob();
    await store.write(metaFor(100), blob);
    backend.fail = 'set';
    expect(await store.write(metaFor(700), blob)).toBe(false);
    backend.fail = 'none';
    expect((await store.readMeta())?.tick).toBe(100);
  });

  it('works without any backend', async () => {
    const store = new AutosaveStore(null);
    expect(store.available).toBe(false);
    expect(await store.write(metaFor(100), realBlob().blob)).toBe(false);
    expect(await store.readMeta()).toBeNull();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('applies operations in call order even when a write is slow', async () => {
    const backend = new FakeBackend();
    backend.slowWrites = true;
    const store = new AutosaveStore(backend);
    const { blob } = realBlob();
    const write = store.write(metaFor(100), blob);
    const clear = store.clear();
    const read = store.readMeta();
    expect(await write).toBe(true);
    await clear;
    expect(await read).toBeNull();
    expect(backend.data.size).toBe(0);
  });
});
