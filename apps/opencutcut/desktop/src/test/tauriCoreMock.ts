/**
 * Bản giả lập các API của Tauri để chạy giao diện trong trình duyệt.
 * Chỉ dùng cho kiểm thử tự động, thông qua `vite.config.test.ts`.
 */

type InvokeHandler = (args: Record<string, any>) => unknown;

// Kho tệp giả cho kiểm thử lưu/mở dự án.
declare global {
  interface Window {
    __mockFiles?: Record<string, string>;
  }
}

const handlers: Record<string, InvokeHandler> = {
  probe_media: (args) => (String(args.path).match(/\.(png|jpe?g|webp)$/i) ? 0 : 8),
  audio_waveform: (args) => {
    const buckets = Number(args.buckets ?? 40);
    return Array.from({ length: buckets }, (_, i) =>
      Math.abs(Math.sin(i / 3)) * (0.4 + (i % 5) * 0.1)
    );
  },
  detect_beats: () => [0, 0.5, 1, 1.5, 2, 2.5],
  // Dải thumbnail thật do ffmpeg tạo; ở trình duyệt chỉ cần một tệp tồn tại.
  clip_thumbnails: (args) =>
    `/private/var/folders/n0/wwsf8585587_32mzjfhsmv2w0000gn/T/opencode/occmedia/${
      String(args.path).endsWith(".png") ? "photo1.png" : "strip.png"
    }`,
  save_overlay_image: (args) => `/tmp/opencutcut_${args.name}.png`,
  save_project: (args) => {
    window.__mockFiles = window.__mockFiles ?? {};
    window.__mockFiles[args.path] = args.data;
    return args.path;
  },
  load_project: (args) => {
    const data = window.__mockFiles?.[args.path];
    if (data === undefined) throw new Error("Không đọc được tệp dự án: không có tệp");
    return data;
  },
  export_video: (args) => `Xuất thành công: ${args.req.output}`,
};

export const invoke = async <T>(cmd: string, args: Record<string, any> = {}): Promise<T> => {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`Lệnh chưa giả lập: ${cmd}`);
  return handler(args) as T;
};

/**
 * Trong app thật `convertFileSrc` đổi đường dẫn thành URL giao thức asset của
 * Tauri. Ở đây dùng `/@fs/` của Vite để trình duyệt tải được tệp thật.
 */
export const convertFileSrc = (path: string) => `/@fs${path}`;