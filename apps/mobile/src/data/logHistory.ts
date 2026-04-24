import { USE_QUEREUS } from '../db/config';
import { ensureDatabaseInitialized } from '../db/init';
import { getAllLogEntries } from '../db/logEntries';
import { getVariant } from '../mock';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'Activity' | 'Condition' | 'Outcome' | string;
  items: string[];
  bundles?: string[];
  comment?: string;
}

type MockItem = { id: string; name: string; category: string };
type MockBundle = { id: string; name: string };
type MockEntry = {
  id: string;
  timestamp: string;
  type: string;
  items: MockItem[];
  bundles: MockBundle[];
  quantifiers: Array<{ itemId: string; name: string; value: number; units: string }>;
  comment: string | null;
};

type MockData = { entries: MockEntry[] };

function loadMock(variant: string): MockData {
  // Require avoids TS json-module config differences.
  switch (variant) {
    case 'empty':
      return require('../../../../mock/data/log-history.empty.json') as MockData;
    case 'error':
      return require('../../../../mock/data/log-history.error.json') as MockData;
    case 'happy':
    default:
      return require('../../../../mock/data/log-history.happy.json') as MockData;
  }
}

export async function getLogHistory(): Promise<LogEntry[]> {
  if (!USE_QUEREUS) {
    const variant = getVariant();
    if (variant === 'error') {
      throw new Error('mock:error');
    }
    const raw = loadMock(variant).entries ?? [];

    return raw.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.type,
      items: (e.items ?? []).map((it) => it.name),
      bundles: (e.bundles ?? []).length ? e.bundles.map((b) => b.name) : undefined,
      comment: e.comment ?? undefined,
    }));
  }

  await ensureDatabaseInitialized();
  const dbEntries = await getAllLogEntries();

  return dbEntries.map((e) => {
    const itemNames = e.items.map((it) => it.name);
    const bundleNames = new Set<string>();
    for (const it of e.items) {
      if (it.sourceBundleName) bundleNames.add(it.sourceBundleName);
    }
    return {
      id: e.id,
      timestamp: e.timestamp,
      type: e.typeName,
      items: itemNames,
      bundles: bundleNames.size ? Array.from(bundleNames) : undefined,
      comment: e.comment ?? undefined,
    };
  });
}


