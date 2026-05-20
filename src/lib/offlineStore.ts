import { get, set, del } from "idb-keyval";

const PENDING_KEY = "pendingCheckins";

export interface CheckinDraft {
  habit_id: string;
  date: string;
  completed: boolean;
  mood?: 1 | 2 | 3;
  notes?: string;
}

export async function savePendingCheckins(checkins: CheckinDraft[]) {
  await set(PENDING_KEY, checkins);
}

export async function getPendingCheckins(): Promise<CheckinDraft[]> {
  return (await get(PENDING_KEY)) ?? [];
}

export async function clearPendingCheckins() {
  await del(PENDING_KEY);
}
