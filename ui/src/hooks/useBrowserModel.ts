import { useSyncExternalStore } from 'react';
import { getState, subscribe, type BrowserModelState } from '../lib/browserModel/engine';

/** Load state of the in-browser model (one worker for the page, shared by the settings panel and the agent). */
export const useBrowserModel = (): BrowserModelState => useSyncExternalStore(subscribe, getState);
