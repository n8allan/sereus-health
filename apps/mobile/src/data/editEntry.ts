import { getVariant } from '../mock';
import { USE_QUEREUS } from '../db/config';
import { ensureDatabaseInitialized } from '../db/init';
import * as dbStats from '../db/stats';
import * as dbLogEntries from '../db/logEntries';

export type EditEntryMode = 'new' | 'edit' | 'clone';

export type QuantifierValue = {
  label: string;
  value: number;
  units: string;
};

export type EditEntryModel = {
  id: string;
  mode: EditEntryMode;
  type: string;
  title: string;
  timestamp: string;
  comment: string;
  quantifiers: QuantifierValue[];
  // Optional hydration for edit/clone modes
  categoryId?: string;
  itemIds?: string[];
};

export type StatRow = { id: string; name: string; usageCount: number };
export type ItemStatRow = StatRow & { isBundle: boolean };

export type EditEntryStats = {
  typeStats: StatRow[];
  categoryStats: Record<string, StatRow[]>;
  itemStats: Record<string, ItemStatRow[]>;
};

function loadEntryMock(variant: string): EditEntryModel {
  // Require avoids TS json-module config differences.
  switch (variant) {
    case 'error':
      return require('../../../../mock/data/edit-entry.error.json') as EditEntryModel;
    case 'happy':
    default:
      return require('../../../../mock/data/edit-entry.happy.json') as EditEntryModel;
  }
}

function loadStatsMock(variant: string): EditEntryStats {
  switch (variant) {
    case 'empty':
      return require('../../../../mock/data/edit-entry-stats.empty.json') as EditEntryStats;
    case 'happy':
    default:
      return require('../../../../mock/data/edit-entry-stats.happy.json') as EditEntryStats;
  }
}

export async function getEditEntry(mode: EditEntryMode, entryId?: string): Promise<EditEntryModel> {
  if (!USE_QUEREUS) {
    const variant = getVariant();
    if (variant === 'error') {
      throw new Error('mock:error');
    }

    if (mode === 'new') {
      return {
        id: entryId ?? 'new',
        mode,
        type: '',
        title: '',
        timestamp: new Date().toISOString(),
        comment: '',
        quantifiers: [],
      };
    }

    const base = loadEntryMock(variant);
    return {
      ...base,
      id: entryId ?? base.id,
      mode,
      timestamp: mode === 'clone' ? new Date().toISOString() : base.timestamp,
    };
  }

  if (mode === 'new') {
    return {
      id: entryId ?? 'new',
      mode,
      type: '',
      title: '',
      timestamp: new Date().toISOString(),
      comment: '',
      quantifiers: [],
    };
  }

  if (!entryId) {
    throw new Error('missing entryId');
  }

  await ensureDatabaseInitialized();
  const e = await dbLogEntries.getLogEntryById(entryId);
  if (!e) throw new Error('not found');

  const categoryId = e.items[0]?.categoryId;
  const itemIds = e.items.map((it) => it.id);

  return {
    id: e.id,
    mode,
    type: e.typeName,
    title: '',
    timestamp: mode === 'clone' ? new Date().toISOString() : e.timestamp,
    comment: e.comment ?? '',
    quantifiers: [], // TODO: map per-item quantifiers if/when the UI supports them
    categoryId,
    itemIds,
  };
}

export async function getEditEntryStats(): Promise<EditEntryStats> {
  if (USE_QUEREUS) {
    await ensureDatabaseInitialized();
    // Not used by the current screen implementation (it calls getTypeStats/getCategoryStats/getItemStats directly).
    // Provide a minimal shape for any future callers.
    const typeStats = await dbStats.getTypeStats();
    return { typeStats, categoryStats: {}, itemStats: {} };
  }

  const variant = getVariant();
  // Treat "error" as a data failure for stats too (keeps behavior consistent).
  if (variant === 'error') {
    throw new Error('mock:error');
  }
  return loadStatsMock(variant);
}

export async function getTypeStats(): Promise<StatRow[]> {
  if (USE_QUEREUS) {
    await ensureDatabaseInitialized();
    return dbStats.getTypeStats();
  }
  return (await getEditEntryStats()).typeStats ?? [];
}

export async function getCategoryStats(typeId: string): Promise<StatRow[]> {
  if (USE_QUEREUS) {
    await ensureDatabaseInitialized();
    return dbStats.getCategoryStats(typeId);
  }
  const stats = await getEditEntryStats();
  return stats.categoryStats?.[typeId] ?? [];
}

export async function getItemStats(categoryId: string): Promise<ItemStatRow[]> {
  if (USE_QUEREUS) {
    await ensureDatabaseInitialized();
    return dbStats.getItemStats(categoryId);
  }
  const stats = await getEditEntryStats();
  return stats.itemStats?.[categoryId] ?? [];
}

export async function createLogEntry(_data: unknown): Promise<{ success: true; entryId: string }> {
  if (!USE_QUEREUS) {
    // Mock mode: accept and pretend success (UI development/scenarios).
    return { success: true, entryId: `mock-${Date.now()}` };
  }

  await ensureDatabaseInitialized();
  const payload = _data as any;
  const entryId = await dbLogEntries.createLogEntry({
    timestamp: payload.timestamp,
    typeId: payload.typeId,
    comment: payload.comment ?? null,
    items: (payload.itemIds ?? []).map((itemId: string) => ({ itemId, sourceBundleId: null, quantifiers: [] })),
  });
  return { success: true, entryId };
}

export async function updateLogEntry(_entryId: string, _data: unknown): Promise<{ success: true }> {
  if (!USE_QUEREUS) {
    return { success: true };
  }

  await ensureDatabaseInitialized();
  const payload = _data as any;
  await dbLogEntries.updateLogEntry(_entryId, {
    timestamp: payload.timestamp,
    typeId: payload.typeId,
    comment: payload.comment ?? null,
    items: (payload.itemIds ?? []).map((itemId: string) => ({ itemId, sourceBundleId: null, quantifiers: [] })),
  });
  return { success: true };
}

export async function deleteLogEntry(_entryId: string): Promise<{ success: true }> {
  if (!USE_QUEREUS) {
    return { success: true };
  }
  await ensureDatabaseInitialized();
  await dbLogEntries.deleteLogEntry(_entryId);
  return { success: true };
}


