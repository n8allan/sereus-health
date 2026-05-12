import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../util/logger';
import { clearPeerIdentity } from '../services/peerIdentity';
import { USE_OPTIMYSTIC } from './config';
import { closeDatabase } from './index';
import { resetInitializationState } from './init';

const logger = createLogger('DB Reset');

/**
 * Dev-only: reset the database.
 *
 * Optimystic: stops CadreService, clears persisted identifiers.
 * LevelDB:    closes DB, destroys LevelDB store files.
 *
 * On next launch the app re-bootstraps with empty data.
 */
export async function resetDatabaseForDev(): Promise<void> {
  if (!__DEV__) {
    throw new Error('resetDatabaseForDev is dev-only');
  }

  logger.info('Resetting database (dev-only)...');

  await closeDatabase();
  resetInitializationState();

  if (USE_OPTIMYSTIC) {
    // Read the current strand ID before clearing, so we can destroy its
    // LevelDB store and per-strand lifecycle mode.
    const strandId = await AsyncStorage.getItem('@sereus/healthStrandId');
    const keysToRemove = ['@sereus/partyId', '@sereus/healthStrandId'];
    if (strandId) keysToRemove.push(`@sereus/strand/${strandId}/mode`);
    // Clear persisted cadre identifiers so a fresh cadre bootstraps on restart.
    await AsyncStorage.multiRemove(keysToRemove);
    // Destroy the LevelDB store for the strand. destroyDB requires the DB to
    // be closed; closeDatabase()/CadreNode.stop() above releases the handle.
    if (strandId) {
      try {
        const { LevelDB } = require('rn-leveldb');
        LevelDB.destroyDB(`optimystic-${strandId}`, true);
        logger.info(`Destroyed optimystic store: optimystic-${strandId}`);
      } catch (e) {
        logger.debug('LevelDB destroy failed:', e);
      }
    }
    // Clear the persisted peer identity so a fresh key is generated on restart.
    try {
      clearPeerIdentity();
      logger.info('Cleared peer identity store');
    } catch (e) {
      logger.debug('Peer identity clear failed:', e);
    }
  } else {
    // LevelDB: destroy all store files.
    const { LevelDB } = require('rn-leveldb');
    const DATABASE_NAME = 'quereus';
    const MAIN_TABLES = [
      'types', 'categories', 'items', 'item_quantifiers',
      'bundles', 'bundle_members',
      'log_entries', 'log_entry_items', 'log_entry_quantifier_values',
    ];

    const dbNames = [
      `${DATABASE_NAME}.__catalog__`.toLowerCase(),
      ...MAIN_TABLES.map(t => `${DATABASE_NAME}.main.${t}`.toLowerCase()),
    ];

    for (const name of dbNames) {
      try {
        LevelDB.destroyDB(name, true);
        logger.info(`Destroyed store: ${name}`);
      } catch (e) {
        logger.debug(`Destroy store skipped/failed for ${name}:`, e);
      }
    }
  }

  logger.info('Reset complete — restart the app to re-bootstrap.');
}
