import {
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

/**
 * Local fallback signal for the "Invite a creator" getting-started item.
 * Task 5 (Discover) calls `markBrandInvitedCreator` when a booking/invite is submitted.
 * Until then this always loads `false`, which is the correct default per the brief.
 */

function getFilePath(userId: string) {
  return `${documentDirectory}brand-invited-creator-${userId}.json`;
}

export async function loadBrandHasInvitedCreator(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const raw = await readAsStringAsync(getFilePath(userId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { invited?: boolean };
    return Boolean(parsed.invited);
  } catch {
    return false;
  }
}

export async function markBrandInvitedCreator(userId: string): Promise<void> {
  if (!userId) return;

  try {
    await writeAsStringAsync(getFilePath(userId), JSON.stringify({ invited: true }));
  } catch {
    // Best-effort — checklist may just fall back to the pitch-based signal.
  }
}
