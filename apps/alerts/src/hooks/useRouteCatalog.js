import { useSyncExternalStore } from 'react';
import { getRouteCatalog, subscribeRouteCatalog } from '../lib/busRoutes.js';

export function useRouteCatalog() {
  return useSyncExternalStore(subscribeRouteCatalog, getRouteCatalog, getRouteCatalog);
}
