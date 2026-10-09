/**
 * Dựng ảnh PNG cho lớp chữ và lớp nhãn dán.
 *
 * Tách riêng khỏi `App.tsx` vì phần tính kích thước cần kiểm thử được bằng số
 * thuần, còn phần vẽ chỉ cần một đối tượng `canvas` là xong.
 */

/** Họ chữ và độ đậm dùng cho mọi lớp chữ. */
export const CHU_Y_CHU = "-apple-system, 'Helvetica Neue', sans-serif";

/** Phần của canvas mà phần vẽ dùng tới. */
export type VeChu = {
  scale(x: number, y: number): void;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineJoin: string;
  lineWidth: number;
  strokeStyle: unknown;
  fillStyle: unknown;
  shadowColor: unknown;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  measureText(s: string): { width: number };
  beginPath(): void;
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number | { x: number; y: number }
  ): void;
  fill(): void;
  strokeText(s: string, x: number, y: number): void;
  fillText(s: string, x: number, y: number): void;
};

/** Thuộc tính vẽ của một lớp chữ, đã rút gọn còn đúng những gì cần dùng. */
export type LopChuVe = {
  text: string;
  size: number;
  bold: boolean;
  align: "left" | "center";
  color: string;
  /** Màu viền, rỗng = không viền. */
  stroke: string;
  strokeWidth: number;
  /** Màu bóng, rỗng = không bóng. */
  shadow: string;
  shadowBlur: number;
  shadowOffset: number;
  /** Màu nền, rỗng = không nền. */
  background: string;
  backgroundPad: number;
  backgroundRadius: number;
};

/** Kích thước và vị trí vẽ của một lớp chữ. */
export type KichChu = {
  /** Bề rộng ảnh. */
  width: number;
  /** Chiều cao ảnh. */
  height: number;
  /** Cỡ chữ thật dùng để vẽ. */
  fontSize: number;
  /** Toạ độ bắt đầu vẽ chữ. */
  x: number;
  y: number;
  /** Chuỗi `font` đầy đủ cho canvas. */
  font: string;
  /** Bề dày viền, 0 = không viền. */
  lineWidth: number;
  /** Bán kính bo của nền, 0 = không bo. */
  radius: number;
  /** Nửa bán kính bo, dùng khi vẽ đường tròn chỗ tròn. */
  banKinh: number;
  /** Khoảng đệm quanh chữ. */
  pad: number;
};

/**
 * Tính kích thước ảnh của lớp chữ từ bề rộng văn bản đã đo.
 *
 * `doRong` là bề rộng mà canvas đo ra ở đúng cỡ chữ `fontSize`, nên hàm này
 * không cần canvas. Mọi khoảng chừa đều tính theo cỡ chữ: chữ lớn thì viền,
 * bóng và nền lớn theo, không bị hụt.
 */
export function doKichChu(lop: LopChuVe, doRong: number): KichChu {
  // Cỡ chữ gấp rưỡi cỡ hiển thị: chữ nhỏ trên canvas xem trước thì lớn hơn
  // trong ảnh xuất, nhân thêm cho dễ đọc.
  const fontSize = Math.max(12, Math.round(lop.size * 1.6));
  const lineWidth = lop.stroke ? Math.round(lop.strokeWidth * fontSize) : 0;
  const blur = Math.round(lop.shadowBlur * fontSize);
  const lech = Math.round(lop.shadowOffset * fontSize);
  // Chỉ chừa chỗ cho lớp nào thật sự có: chỗ trống trong suốt thừa ra sẽ bị mất
  // khi dán vào khung, mà chừa cả khi không dùng thì chữ lệch khỏi tâm.
  const choVien = lop.stroke ? Math.ceil(lineWidth / 2) : 0;
  const choBong = lop.shadow ? blur + lech : 0;
  const pad = lop.background ? Math.round(lop.backgroundPad * fontSize) : 0;
  const doc = Math.ceil(doRong);
  const cao = Math.ceil(fontSize * 1.4);
  return {
    width: Math.max(1, doc + (pad + choVien) * 2 + choBong * 2),
    height: Math.max(1, cao + (pad + choVien) * 2 + choBong * 2),
    fontSize,
    x: lop.align === "center" ? 0 : pad + choVien + choBong,
    y: cao / 2 + pad + choVien + choBong,
    font: `${lop.bold ? "700" : "400"} ${fontSize}px ${CHU_Y_CHU}`,
    lineWidth,
    radius: Math.round(lop.backgroundRadius * fontSize),
    banKinh: Math.ceil(pad + choVien + choBong),
    pad,
  };
}

/**
 * Vẽ lớp chữ lên canvas đã đặt đúng kích thước.
 *
 * Thứ tự là nền, rồi bóng, rồi viền, cuối cùng màu chữ: bóng đổ ra sau nên
 * không được vẽ trước nền, còn viền phải nằm giữa bóng và chữ để mép chữ thấy.
 */
export function veChuLen(ctx: VeChu, lop: LopChuVe, kich: KichChu): void {
  const coVien = lop.stroke !== "" && kich.lineWidth > 0;
  const coNen = lop.background !== "" && kich.pad > 0;
  const coBong = lop.shadow !== "";

  // Căn giữa: `textAlign` của canvas không dịch toạ độ nên phải trừ nửa bề
  // rộng đo được, và dùng nửa chiều rộng ảnh làm mốc.
  const x =
    lop.align === "center"
      ? (kich.width - (kich.width - kich.pad * 2)) / 2
      : kich.x;

  if (coNen) {
    ctx.beginPath();
    ctx.roundRect(
      kich.banKinh - kich.pad / 2,
      kich.banKinh - kich.pad / 2,
      kich.width - (kich.banKinh - kich.pad / 2) * 2,
      kich.height - (kich.banKinh - kich.pad / 2) * 2,
      kich.radius
    );
    ctx.fillStyle = lop.background;
    ctx.fill();
  }

  ctx.font = kich.font;
  ctx.textAlign = lop.align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.shadowColor = coBong ? lop.shadow : "rgba(0,0,0,0)";
  ctx.shadowBlur = coBong ? Math.round(lop.shadowBlur * kich.fontSize) : 0;
  const lech = coBong ? Math.round(lop.shadowOffset * kich.fontSize) : 0;
  ctx.shadowOffsetX = lech;
  ctx.shadowOffsetY = lech;

  if (coVien) {
    ctx.lineWidth = kich.lineWidth;
    ctx.strokeStyle = lop.stroke;
    ctx.strokeText(lop.text, x, kich.y);
  }
  ctx.fillStyle = lop.color;
  ctx.fillText(lop.text, x, kich.y);
}

/** Bề rộng văn bản, dùng một canvas đo riêng. */
export function doRongChu(ctx: VeChu, lop: LopChuVe, fontSize: number): number {
  ctx.font = `${lop.bold ? "700" : "400"} ${fontSize}px ${CHU_Y_CHU}`;
  return ctx.measureText(lop.text).width;
}