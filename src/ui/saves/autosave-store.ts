/**
 * The single autosave slot: metadata + the save blob (JSON text) behind a
 * tiny async key-value backend (IndexedDB in the browser, a fake in tests).
 * Every failure, from a blocked store to a corrupt or too-new record, comes
 * back as "no save": nothing here throws, and a record that cannot be
 * resumed is deleted so "Continue" never offers it again.
 */

import { SAVE_VERSION, parseSavedGame, type SavedGame } from '../../sim/save-load';
import { parseAutosaveMeta, type AutosaveMeta } from './autosave-meta';

export const AUTOSAVE_META_KEY = 'autosave.meta';
export const AUTOSAVE_BLOB_KEY = 'autosave.blob';

/** Minimal async key-value store. Methods may reject; the store catches. */
export interface AutosaveBackend {
  get(key: string): Promise<unknown>;
  /** Write every entry atomically. */
  setAll(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
  deleteAll(keys: readonly string[]): Promise<void>;
}

export interface AutosaveRecord {
  meta: AutosaveMeta;
  snapshot: SavedGame;
}

export interface AutosaveStoreOptions {
  /** Highest save blob version this build loads (default: SAVE_VERSION). */
  maxSaveVersion?: number;
  /** Save blob parser + migrator (default: the sim's parseSavedGame). */
  parse?: (text: string) => SavedGame | null;
}

export class AutosaveStore {
  private readonly maxSaveVersion: number;
  private readonly parse: (text: string) => SavedGame | null;
  /** Operations run strictly in call order, so a clear never loses to an older write. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly backend: AutosaveBackend | null,
    options: AutosaveStoreOptions = {}
  ) {
    this.maxSaveVersion = options.maxSaveVersion ?? SAVE_VERSION;
    this.parse = options.parse ?? parseSavedGame;
  }

  get available(): boolean {
    return this.backend !== null;
  }

  /** Metadata of a resumable save, or null. An invalid record is dropped. */
  readMeta(): Promise<AutosaveMeta | null> {
    return this.enqueue(null, async (backend) => {
      const raw = await backend.get(AUTOSAVE_META_KEY);
      if (raw === undefined || raw === null) return null;
      const meta = parseAutosaveMeta(raw, this.maxSaveVersion);
      if (!meta) await this.drop(backend);
      return meta;
    });
  }

  /** The full save, parsed and migrated, or null. An unloadable save is dropped. */
  load(): Promise<AutosaveRecord | null> {
    return this.enqueue(null, async (backend) => {
      const rawMeta = await backend.get(AUTOSAVE_META_KEY);
      if (rawMeta === undefined || rawMeta === null) return null;
      const meta = parseAutosaveMeta(rawMeta, this.maxSaveVersion);
      const blob = meta ? await backend.get(AUTOSAVE_BLOB_KEY) : null;
      const snapshot = typeof blob === 'string' ? this.safeParse(blob) : null;
      // A decided match is never resumed, whatever the metadata says.
      if (!meta || !snapshot || snapshot.outcome?.state !== 'playing') {
        await this.drop(backend);
        return null;
      }
      return { meta, snapshot };
    });
  }

  /** Replace the slot. Resolves false when the store is unavailable or full. */
  write(meta: AutosaveMeta, blob: string): Promise<boolean> {
    return this.enqueue(false, async (backend) => {
      await backend.setAll([
        [AUTOSAVE_META_KEY, meta],
        [AUTOSAVE_BLOB_KEY, blob],
      ]);
      return true;
    });
  }

  clear(): Promise<void> {
    return this.enqueue(undefined, (backend) => this.drop(backend));
  }

  private safeParse(blob: string): SavedGame | null {
    try {
      return this.parse(blob);
    } catch {
      return null;
    }
  }

  private async drop(backend: AutosaveBackend): Promise<void> {
    try {
      await backend.deleteAll([AUTOSAVE_META_KEY, AUTOSAVE_BLOB_KEY]);
    } catch {
      // Could not delete; the next read fails validation the same way.
    }
  }

  private enqueue<T>(fallback: T, op: (backend: AutosaveBackend) => Promise<T>): Promise<T> {
    const backend = this.backend;
    if (!backend) return Promise.resolve(fallback);
    const run = async (): Promise<T> => {
      try {
        return await op(backend);
      } catch {
        return fallback;
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result;
    return result;
  }
}
