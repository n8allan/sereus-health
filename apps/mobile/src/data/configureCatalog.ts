import { getVariant } from '../mock';
import { USE_QUEREUS } from '../db/config';
import { ensureDatabaseInitialized } from '../db/init';
import { getAllCatalogBundles, getAllCatalogItems } from '../db/catalog';

export type CatalogType = 'Activity' | 'Condition' | 'Outcome' | string;

export interface CatalogItem {
  id: string;
  name: string;
  type: CatalogType;
  category: string;
  hasQuantifiers: boolean;
}

export interface CatalogBundle {
  id: string;
  name: string;
  type: CatalogType;
  itemCount: number;
  itemIds: string[];
}

type MockItem = { id: string; name: string; type: string; category: string };
type MockBundle = { id: string; name: string; type: string; itemIds: string[] };
type MockData = { items: MockItem[]; bundles: MockBundle[] };

function loadMock(variant: string): MockData {
  // Require avoids TS json-module config differences.
  switch (variant) {
    case 'empty':
      return require('../../../../mock/data/configure-catalog.empty.json') as MockData;
    case 'error':
      return require('../../../../mock/data/configure-catalog.error.json') as MockData;
    case 'happy':
    default:
      return require('../../../../mock/data/configure-catalog.happy.json') as MockData;
  }
}

export async function getConfigureCatalog(): Promise<{ items: CatalogItem[]; bundles: CatalogBundle[] }> {
  if (!USE_QUEREUS) {
    const variant = getVariant();
    if (variant === 'error') {
      throw new Error('mock:error');
    }

    const raw = loadMock(variant);
    const items: CatalogItem[] = (raw.items ?? []).map((it) => ({
      id: it.id,
      name: it.name,
      type: it.type,
      category: it.category,
      hasQuantifiers: false,
    }));

    const bundles: CatalogBundle[] = (raw.bundles ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      itemIds: b.itemIds ?? [],
      itemCount: (b.itemIds ?? []).length,
    }));

    return { items, bundles };
  }

  await ensureDatabaseInitialized();
  const dbItems = await getAllCatalogItems();
  const dbBundles = await getAllCatalogBundles();

  return {
    items: dbItems.map((it) => ({
      id: it.id,
      name: it.name,
      type: it.type,
      category: it.category,
      hasQuantifiers: false, // TODO: query item_quantifiers
    })),
    bundles: dbBundles.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      itemIds: b.itemIds,
      itemCount: b.itemIds.length,
    })),
  };
}


