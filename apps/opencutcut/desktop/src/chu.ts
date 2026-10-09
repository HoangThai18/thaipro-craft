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
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
};

/** Tham số đường cong của chữ. */
export type KyHieuCong = {
  /** Mức cong, -100..100. 0 = chữ thẳng. */
  curve: number;
  /** Góc quét tối đa khi cong 100%, tính bằng radian. */
  thetaToiDa?: number;
};

/** Vị trí và góc xoay của một ký tự trên đường cong. */
export type ViTriCong = {
  /** Ký tự cần vẽ. */
  kyTu: string;
  /** Toạ độ tâm ký tự. */
  x: number;
  y: number;
  /** Góc xoay, radian. Dương = ngả theo chiều kim đồng hồ. */
  alpha: number;
};

/** Góc quét tối đa: 120 độ, đủ còng rõ mà chữ không đè lên nhau. */
export const GOC_QUET_TOI_DA = (2 * Math.PI) / 3;

/**
 * Độ võng của đường cong: đo từ giữa chữ tới tâm đường tròn, tính theo đơn vị ảnh.
 *
 * Dùng để biết phải chừa thêm bao nhiêu chiều cao và chiều rộng cho lớp chữ.
 * Dương là chữ còng lên (giữa chữ cao hơn hai đầu), âm là chữ chúm xuống.
 */
export function doVongCong(
  ky: KyHieuCong,
  chieuDai: number,
  chieuCaoChu: number
): number {
  const theta = Math.abs(gocQuet(ky));
  if (theta <= 0 || chieuDai <= 0) return 0;
  // Bán kính càng nhỏ thì càng còng: góc quét càng lớn, dây cung càng ngắn.
  const r = chieuDai / 2 / Math.sin(theta / 2);
  const sang = r * (1 - Math.cos(theta / 2));
  // Ký tự ở hai đầu bị xoay nghiêng nên bóng của nó vươn thêm ra ngoài dây cung.
  const nghieng = (chieuCaoChu / 2) * Math.abs(Math.sin(theta / 2));
  return Math.ceil(sang + nghieng);
}

/** Góc quét của đường cong, radian; đổi dấu theo chiều cong. */
function gocQuet(ky: KyHieuCong): number {
  const muc = Math.max(-100, Math.min(100, ky.curve ?? 0));
  const toiDa = ky.thetaToiDa ?? GOC_QUET_TOI_DA;
  return (muc / 100) * toiDa;
}

/**
 * Tính vị trí và góc xoay từng ký tự khi chữ chạy theo đường cong.
 *
 * `chuoi` là chuỗi cần vẽ, `rongKyTu[i]` là bề rộng ký tự thứ i vì canvas không
 * cho bề rộng từng ký tự trong một lần đo. `tam` là toạ độ tâm đường cong.
 *
 * Chữ thẳng (`curve = 0`) trả về thẳng hàng trên một dòng, đúng chỗ như chưa có
 * đường cong, để hai chế độ dùng chung một lối vẽ.
 */
export function viTriTheoCong(
  ky: KyHieuCong,
  chuoi: string,
  rongKyTu: number[],
  tam: { x: number; y: number }
): ViTriCong[] {
  const theta = gocQuet(ky);
  const kyTu = Array.from(chuoi);
  const rong = kyTu.map((_, i) => rongKyTu[i] ?? 0);
  const tong = rong.reduce((a, b) => a + b, 0);
  if (theta === 0 || tong <= 0) {
    // Thẳng: xê dịch dần từ trái sang, y không đổi.
    return kyTu.map((c, i) => ({
      kyTu: c,
      x: tam.x - tong / 2 + rong.slice(0, i).reduce((a, b) => a + b, 0) + rong[i] / 2,
      y: tam.y,
      alpha: 0,
    }));
  }
  // Bán kính lấy theo nửa dây cung: càng cong thì càng nhỏ.
  const r = tong / 2 / Math.sin(theta / 2);
  // Tâm đường tròn nằm phía dưới khung khi chữ cong lên (hai đầu chúm xuống như
  // cầu vồng), phía trên khi chữ chúm xuống; dấu của góc quét quyết định.
  // `r` mang dấu của mức cong nên đảo chiều bằng cách đổi dấu góc quét.
  const cy = tam.y + r;
  // Vị trí trên dây cung, đo từ đầu chữ.
  let duongDi = 0;
  return kyTu.map((c, i) => {
    const giua = duongDi + rong[i] / 2;
    duongDi += rong[i];
    const alpha = -theta / 2 + (tong > 0 ? giua / tong : 0.5) * theta;
    return {
      kyTu: c,
      x: tam.x + r * Math.sin(alpha),
      // Trừ chứ không cộng: điểm trên nửa trên của đường tròn có y nhỏ hơn tâm,
      // nhờ đó ký tự giữa nằm cao nhất và hai đầu chúm xuống.
      y: cy - r * Math.cos(alpha),
      alpha,
    };
  });
}

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
  /** Mức cong của chữ, -100..100. 0 = chữ thẳng. */
  curve: number;
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
  // Chữ cong vọt lên và chúm xuống so với dòng thẳng, hai đầu lại bị xoay
  // nghiêng nên cần chừa thêm cả chiều lẫn bề rộng, không thì mép bị cắt.
  const vong = doVongCong({ curve: lop.curve ?? 0 }, doc, fontSize);
  const them = pad + choVien + choBong;
  return {
    width: Math.max(1, doc + them * 2 + vong),
    height: Math.max(1, cao + them * 2 + vong * 2),
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
  const cong = lop.curve ?? 0;

  // Tâm đường cong: giữ nguyên chỗ cũ của chữ thẳng để hai chế độ khớp nhau.
  const x =
    lop.align === "center"
      ? (kich.width - (kich.width - kich.pad * 2)) / 2
      : kich.x;
  const tam = { x: kich.width / 2, y: kich.y };

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
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.shadowColor = coBong ? lop.shadow : "rgba(0,0,0,0)";
  ctx.shadowBlur = coBong ? Math.round(lop.shadowBlur * kich.fontSize) : 0;
  const lech = coBong ? Math.round(lop.shadowOffset * kich.fontSize) : 0;
  ctx.shadowOffsetX = lech;
  ctx.shadowOffsetY = lech;

  const toMau = (kyTu: string, vx: number, vy: number, alpha: number) => {
    ctx.save();
    ctx.translate(vx, vy);
    if (alpha !== 0) ctx.rotate(alpha);
    ctx.textAlign = "center";
    if (coVien) {
      ctx.lineWidth = kich.lineWidth;
      ctx.strokeStyle = lop.stroke;
      ctx.strokeText(kyTu, 0, 0);
    }
    ctx.fillStyle = lop.color;
    ctx.fillText(kyTu, 0, 0);
    ctx.restore();
  };

  if (cong === 0) {
    // Chữ thẳng: vẽ cả câu trong một lần, không xoay gì cả.
    ctx.textAlign = lop.align;
    if (coVien) {
      ctx.lineWidth = kich.lineWidth;
      ctx.strokeStyle = lop.stroke;
      ctx.strokeText(lop.text, x, kich.y);
    }
    ctx.fillStyle = lop.color;
    ctx.fillText(lop.text, x, kich.y);
    return;
  }

  // Chữ cong: vẽ từng ký tự tại vị trí và góc xoay của riêng nó.
  const kyTu = Array.from(lop.text);
  const rongKyTu = kyTu.map((c) => {
    ctx.font = kich.font;
    return ctx.measureText(c).width;
  });
  const viTri = viTriTheoCong({ curve: cong }, lop.text, rongKyTu, tam);
  for (const v of viTri) {
    toMau(v.kyTu, v.x, v.y, v.alpha);
  }
}

/** Bề rộng văn bản, dùng một canvas đo riêng. */
export function doRongChu(ctx: VeChu, lop: LopChuVe, fontSize: number): number {
  ctx.font = `${lop.bold ? "700" : "400"} ${fontSize}px ${CHU_Y_CHU}`;
  return ctx.measureText(lop.text).width;
}