import { doKichChu, veChuLen, type LopChuVe, type VeChu } from "./chu";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`SAI  ${name}\n  thực tế: ${a}\n  cần:     ${e}`);
  }
}

/** Lớp chữ trần, không viền bóng nền. */
const lop = (ghi: Partial<LopChuVe> = {}): LopChuVe => ({
  text: "Chữ",
  size: 48,
  bold: true,
  align: "center",
  color: "#ffffff",
  stroke: "",
  strokeWidth: 0.08,
  shadow: "",
  shadowBlur: 0.3,
  shadowOffset: 0.08,
  background: "",
  backgroundPad: 0.3,
  backgroundRadius: 0.2,
  ...ghi,
});

// ---------------------------------------------------------------------------
// Kích thước ảnh của lớp chữ
// ---------------------------------------------------------------------------

const tran = doKichChu(lop(), 200);
check("cỡ chữ ảnh gấp rưỡi cỡ hiển thị", tran.fontSize, 77);
check("bề rộng không có viền bóng nền bằng bề rộng đo", tran.width, 200);
check("viền rỗng thì không kẻ viền", tran.lineWidth, 0);
check("chuỗi font theo độ đậm", tran.font, `700 77px ${tran.font.split("px ")[1]}`);

const coVien = doKichChu(lop({ stroke: "#000" }), 200);
check("viền làm ảnh rộng ra hai bên", coVien.width > tran.width, true);
check(
  "viền dày thêm đúng hai nửa bề dày",
  coVien.width - tran.width,
  coVien.lineWidth
);
check("bề dày viền tính theo cỡ chữ", coVien.lineWidth, Math.round(0.08 * 77));

const coBong = doKichChu(lop({ shadow: "#000" }), 200);
check("bóng làm ảnh lớn ra", coBong.width > tran.width, true);
check(
  "không có bóng thì không chừa chỗ trống",
  doKichChu(lop(), 200).width,
  tran.width
);
// Bóng phải chừa đủ ở cả hai bên: mỗi bên chừa độ nhò cộng độ lệch.
check(
  "chỗ chừa cho bóng bằng hai lần nhò cộng lệch",
  coBong.width - 200,
  (Math.round(0.3 * 77) + Math.round(0.08 * 77)) * 2
);

const coNen = doKichChu(lop({ background: "#000" }), 200);
check("nền làm ảnh lớn ra hai bên", coNen.width - 200, coNen.pad * 2);
check("khoảng đệm tính theo cỡ chữ", coNen.pad, Math.round(0.3 * 77));

check("chữ rỗng vẫn ra ảnh kích thước tối thiểu", doKichChu(lop(), 0).width >= 1, true);
check("cỡ chữ nhỏ không xuống dưới 12", doKichChu(lop({ size: 1 }), 20).fontSize, 12);
check("cỡ chữ lớn không tràn", doKichChu(lop({ size: 400 }), 900).fontSize, 640);

// Căn trái lùi vào bằng đệm, căn giữa thì giữa ảnh.
const trai = doKichChu(lop({ align: "left", background: "#000" }), 200);
check("căn trái bắt đầu sau khoảng đệm", trai.x, trai.pad);
check("căn giữa bắt đầu ở giữa ảnh", tran.x, 0);

// ---------------------------------------------------------------------------
// Thứ tự vẽ và việc tôn trọng thuộc tính
// ---------------------------------------------------------------------------

/**
 * Canvas giả, chỉ ghi lại thứ tự các thao tác để kiểm tra lớp vẽ không bỏ sót
 * bước nào và không vẽ thừa.
 */
const taoCanvasGia = (doRong = 200) => {
  const buoc: string[] = [];
  const thuoc = {
    scale: () => buoc.push("scale"),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: () => ({ width: doRong }),
    beginPath: () => buoc.push("beginPath"),
    roundRect: (_x: number, _y: number, _w: number, _h: number, r: number) =>
      buoc.push(`roundRect:${r}`),
    fill: () => buoc.push(`fill:${thuoc.fillStyle}`),
    strokeText: () => buoc.push("strokeText"),
    fillText: () => buoc.push("fillText"),
  };
  return { ctx: thuoc as unknown as VeChu, buoc };
};

{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop();
  veChuLen(ctx, l, doKichChu(l, 200));
  check("không viền bóng nền thì chỉ tô chữ", buoc, ["fillText"]);
  check("cỡ chữ truyền vào canvas", ctx.font.startsWith("700 "), true);
  check("chữ được kẻ ở giữa chiều cao", ctx.textBaseline, "middle");
}

{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop({ stroke: "#ff0000" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("có viền thì kẻ viền trước rồi tô chữ", buoc, ["strokeText", "fillText"]);
  check("màu viền đúng", ctx.strokeStyle, "#ff0000");
  check("bề dày viền đúng", ctx.lineWidth, Math.round(0.08 * 77));
}

{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop({ background: "#00ff00" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("nền được vẽ trước chữ", buoc, [
    "beginPath",
    "roundRect:15",
    "fill:#00ff00",
    "fillText",
  ]);
  check("màu chữ đè lên nền", ctx.fillStyle, "#ffffff");
}

{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop({ shadow: "#0000ff" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("bóng không vẽ thêm lần tô nào", buoc, ["fillText"]);
  check("màu bóng được đặt", ctx.shadowColor, "#0000ff");
  check("độ nhò của bóng", ctx.shadowBlur, Math.round(0.3 * 77));
  check("bóng lệch cả ngang và dọc", [ctx.shadowOffsetX, ctx.shadowOffsetY], [
    Math.round(0.08 * 77),
    Math.round(0.08 * 77),
  ]);
}

{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop({ stroke: "#f00", shadow: "#00f", background: "#0f0" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check(
    "đủ ba lớp thì thứ tự nền, viền, chữ",
    buoc,
    ["beginPath", "roundRect:15", "fill:#0f0", "strokeText", "fillText"]
  );
}

// Bán kính bo bằng 0 vẫn vẽ nền, chỉ là góc vuông.
{
  const { ctx, buoc } = taoCanvasGia();
  const l = lop({ background: "#123", backgroundRadius: 0 });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("bo bằng 0 thì nền góc vuông", buoc[1], "roundRect:0");
}

console.log(`\n${passed} đạt, ${failed} sai`);
if (failed > 0) throw new Error(`${failed} phép kiểm tra sai`);