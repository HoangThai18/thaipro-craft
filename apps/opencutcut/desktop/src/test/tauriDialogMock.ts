/** Giả lập plugin hộp thoại của Tauri cho kiểm thử tự động. */

// Danh sách tệp mà test sẽ "chọn", đọc từ biến toàn cục do test đặt trước.
declare global {
  interface Window {
    __mockOpenPaths?: string[];
    __mockSavePath?: string | null;
  }
}

export const open = async (_opts?: unknown): Promise<string | string[] | null> => {
  const paths = window.__mockOpenPaths ?? [];
  if (paths.length === 1) return paths[0];
  return paths.length ? paths : null;
};

export const save = async (_opts?: unknown): Promise<string | null> =>
  window.__mockSavePath ?? null;

// Kho tệp giả do `tauriCoreMock.ts` quản lý qua `localStorage`, nên tồn tại
// qua nhiều lần tải lại trang.