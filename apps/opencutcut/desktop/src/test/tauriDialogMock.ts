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

// Kho dữ liệu giả cho lệnh lưu/mở dự án: đủ để kiểm thử vòng tròn
// "lưu xong mở lại" mà không cần đụng tệp thật.
declare global {
  interface Window {
    __mockFiles?: Record<string, string>;
  }
}

export const docKho = (path: string, data: string) => {
  window.__mockFiles = window.__mockFiles ?? {};
  window.__mockFiles[path] = data;
};

export const docDoc = (path: string): string | undefined => window.__mockFiles?.[path];