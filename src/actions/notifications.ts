'use server';

// 알림 읽음 처리 Server Action — 드롭다운 열거나 사용자가 항목 클릭 시 호출.

import { revalidatePath } from 'next/cache';
import { markAllNotificationsRead, markNotificationsRead } from '@/lib/notifications';

export type MarkReadActionState =
  | { kind: 'idle' }
  | { kind: 'updated'; count: number }
  | { kind: 'error'; message: string };

export async function markNotificationsReadAction(
  ids: ReadonlyArray<number>,
): Promise<MarkReadActionState> {
  try {
    const result = markNotificationsRead(ids);
    revalidatePath('/');
    return { kind: 'updated', count: result.updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}

export async function markAllNotificationsReadAction(): Promise<MarkReadActionState> {
  try {
    const result = markAllNotificationsRead();
    revalidatePath('/');
    return { kind: 'updated', count: result.updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message };
  }
}
