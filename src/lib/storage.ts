import { del, get, set } from 'idb-keyval';
import type { SavedSession } from '../types';

const SESSION_KEY = 'qtsmc-session-v1';

export async function saveSession(session: SavedSession): Promise<void> {
  await set(SESSION_KEY, session);
}

export async function loadSession(): Promise<SavedSession | undefined> {
  return get<SavedSession>(SESSION_KEY);
}

export async function clearSession(): Promise<void> {
  await del(SESSION_KEY);
}
