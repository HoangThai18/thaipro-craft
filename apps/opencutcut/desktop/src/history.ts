/**
 * Lịch sử chỉnh sửa (undo/redo) cho project. Giữ tối đa `limit` bước, mỗi bước
 * là một bản chụp của trạng thái project.
 */

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const createHistory = <T,>(initial: T): History<T> => ({
  past: [],
  present: initial,
  future: [],
});

/** Ghi một trạng thái mới. Không ghi nếu trạng thái không đổi (so sánh tham chiếu). */
export function commit<T>(history: History<T>, next: T, limit = 50): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

/** Thay trạng thái hiện tại mà không tạo bước mới (dùng cho thay đổi tức thời). */
export function replace<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

/**
 * Bước undo trước có cùng nhãn với thay đổi đang làm không.
 *
 * Gõ chữ hay kéo thanh trượt sinh hàng chục thay đổi liên tiếp; nếu mỗi cái
 * một bước undo thì người dùng phải bấm rất nhiều lần mới quay lại được. Hàm
 * này trả về `true` để bỏ bước undo cũ và viết đè lên bước đang có, giữ cho cả
 * chuỗi thành một bước.
 *
 * - `key` khác `previousKey` (hoặc chưa có) -> thay đổi loại khác, phải tách.
 * - Số thay đổi đã gộp đạt `max` -> tách để bước gộp không phình vô hạn.
 */
export function coalesce(
  previousKey: string | null,
  key: string,
  max = 20
): boolean {
  if (previousKey !== key) {
    coalesce.count = 0;
    return false;
  }
  if (coalesce.count >= max) return false;
  coalesce.count += 1;
  return true;
}

/** Số lần đã gộp vào bước hiện tại. */
coalesce.count = 0;

/** Bắt đầu lại bộ đếm gộp, ví dụ khi người dùng bắt đầu thao tác khác. */
coalesce.reset = () => {
  coalesce.count = 0;
};

/**
 * Ghi một bước với giá trị trước khi bắt đầu kéo. Dùng để một lần kéo chuột
 * tạo đúng một bước undo, thay vì mỗi pixel một bước.
 */
export function commitFrom<T>(history: History<T>, previous: T, next: T, limit = 50): History<T> {
  if (Object.is(next, previous)) return history;
  const past = [...history.past, previous];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

/**
 * Ghi đè lên bước undo đang có thay vì thêm một bước mới.
 *
 * Dùng khi nhiều thay đổi liên tiếp thuộc cùng một thao tác (gõ chữ, kéo thanh
 * trượt): chỉ giữ lại mốc trạng thái *trước khi* thao tác bắt đầu, còn các
 * trạng thái xen kẽ bị bỏ. Nhờ vậy người dùng bấm hoàn tác một lần là quay về
 * đầu thao tác, thay vì phải bấm nhiều lần.
 */
export function commitMerge<T>(history: History<T>, next: T, limit = 50): History<T> {
  if (Object.is(next, history.present)) return history;
  // `past` giữ nguyên: bước cuối đã trỏ về trạng thái trước khi thao tác bắt đầu,
  // nên chỉ cần thay `present` là cả chuỗi gộp thành đúng một bước hoàn tác.
  let past = history.past;
  if (past.length >= limit) past = past.slice(1);
  return { past, present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export const canUndo = <T,>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T,>(history: History<T>): boolean => history.future.length > 0;