use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Kiểu dữ liệu nhận từ frontend
// ---------------------------------------------------------------------------

/// Giá trị chỉnh màu theo clip, tất cả trong khoảng -1..1 (trừ khoảng 0..1 cho
/// fade/sharpen/vignette và boolean cho blackWhite).
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Adjust {
    brightness: f64,
    contrast: f64,
    saturation: f64,
    temperature: f64,
    highlights: f64,
    shadows: f64,
    fade: f64,
    sharpen: f64,
    vignette: f64,
    black_white: bool,
}

/// Vùng cắt chuẩn hoá 0..1 so với khung gần xa nhất.
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct CropRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Lọc màu nền (chroma key).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ChromaKey {
    enabled: bool,
    /// Màu phía trên, "RRGGBB".
    color: String,
    similarity: f64,
    smoothness: f64,
    spill: f64,
}

impl TimelineClip {
    fn is_image(&self) -> bool {
        self.kind.as_deref() == Some("image")
    }
}

impl Default for ChromaKey {
    fn default() -> Self {
        Self {
            enabled: false,
            color: "00FF00".into(),
            similarity: 0.3,
            smoothness: 0.1,
            spill: 0.2,
        }
    }
}

/// Đường cong màu: mỗi kênh một chuỗi điểm kiểu "0/0 0.5/0.6 1/1".
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Curves {
    master: String,
    red: String,
    green: String,
    blue: String,
}

/// LUT dạng .cube đã nạp từ tệp người dùng chọn.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Lut {
    path: String,
    strength: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct Keyframe {
    /// Thời điểm tuyệt đối trên timeline (giây).
    time: f64,
    /// Tên thuộc tính, khớp với frontend.
    prop: String,
    value: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct TimelineClip {
    path: String,
    /// "video" hoặc "image"; ảnh không có seek.
    #[serde(default)]
    kind: Option<String>,
    start: f64,
    duration: f64,
    #[serde(default)]
    seek_to: Option<f64>,
    #[serde(default)]
    speed: Option<f64>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    muted: bool,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    adjust: Option<Adjust>,
    #[serde(default)]
    mix_mode: Option<String>,
    #[serde(default)]
    crop: Option<CropRect>,
    #[serde(default)]
    chroma: Option<ChromaKey>,
    #[serde(default)]
    curves: Option<Curves>,
    #[serde(default)]
    lut: Option<Lut>,
    #[serde(default)]
    keyframes: Vec<Keyframe>,
    /// Chuyển cảnh áp dụng tại mép đi của clip này (không | fade | slide | ...).
    #[serde(default)]
    transition: Option<String>,
    #[serde(default)]
    transition_duration: Option<f64>,
    /// Hiệu ứng áp cho clip (id trong kho hiệu ứng của frontend).
    #[serde(default)]
    effect: Option<String>,
    /// Dùng bản mạnh của hiệu ứng.
    #[serde(default)]
    #[serde(rename = "effectStrong")]
    effect_strong: Option<bool>,
    /// Đảo ngược thứ tự khung hình (chỉ dùng được cho video).
    #[serde(default)]
    reverse: bool,
}

/// Lớp chữ/nhãn dán đã được frontend vẽ sẵn thành PNG.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ImageLayer {
    image_path: String,
    start: f64,
    duration: f64,
    /// Tọa đa tính theo phần trăm của khung hình (0..100).
    x: f64,
    y: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AudioTrack {
    path: String,
    start: f64,
    duration: f64,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    muted: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    clips: Vec<TimelineClip>,
    #[serde(default)]
    texts: Vec<ImageLayer>,
    #[serde(default)]
    audios: Vec<AudioTrack>,
    output: String,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    /// none | grayscale | warm | cool | vintage | film
    #[serde(default)]
    filter: Option<String>,
    /// none | blur | glow | vhs | filmnoise | sharpen | vignette | bw | invert | fade
    #[serde(default)]
    effect: Option<String>,
    /// high | medium | low
    #[serde(default)]
    quality: Option<String>,
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// Biểu thức ffmpeg nội suy tuyến tính từ các keyframe, hoặc None nếu thiếu.
fn keyframe_expression(points: &[(f64, f64)]) -> Option<String> {
    if points.len() < 2 {
        return None;
    }
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let last = sorted.last().unwrap().1;
    let mut expr = format!("{last:.6}");
    for w in (0..sorted.len() - 1).rev() {
        let (t0, v0) = sorted[w];
        let (t1, _v1) = sorted[w + 1];
        let span = t1 - t0;
        if span <= 1e-6 {
            expr = format!("{v0:.6}");
            continue;
        }
        let slope = (sorted[w + 1].1 - v0) / span;
        expr = format!("if(lt(t\\,{t1:.6})\\,{v0:.6}+({slope:.6})*(t-{t0:.6})\\,{expr})");
    }
    Some(expr)
}

/// Gom keyframe của một thuộc tính thành cặp (thời điểm, giá trị).
fn keyframe_points(clip: &TimelineClip, prop: &str) -> Vec<(f64, f64)> {
    clip.keyframes
        .iter()
        .filter(|k| k.prop == prop)
        .map(|k| (k.time, k.value))
        .collect()
}

/// Trừ offset clip để keyframe dùng thời gian tương đối trong chính clip đó.
fn to_clip_time(clip: &TimelineClip, abs_time: f64) -> f64 {
    abs_time - clip.start
}

/// Hex "RRGGBB" thành "0xRRGGBB" cho ffmpeg.
fn hex_color(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    if clean.len() == 6 {
        format!("0x{clean}")
    } else {
        "0x00FF00".to_string()
    }
}

fn temp_path(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("opencutcut_{name}"));
    p
}

// ---------------------------------------------------------------------------
// Dựng filter cho một clip
// ---------------------------------------------------------------------------

fn video_filter_chain(
    clip: &TimelineClip,
    w: u32,
    h: u32,
    fps: u32,
) -> Vec<String> {
    let mut f: Vec<String> = Vec::new();

    // Crop trước, rồi scale về khung: `crop` dùng số pixel nên cần biết kích
    // thước gốc, ta dùng biểu thức theo `in_w`/`in_h` của chính input.
    let crop = clip.crop;
    match crop {
        Some(c) => {
            let cw = clamp(c.width, 0.05, 1.0);
            let ch = clamp(c.height, 0.05, 1.0);
            let cx = clamp(c.x, 0.0, 1.0 - cw);
            let cy = clamp(c.y, 0.0, 1.0 - ch);
            f.push(format!("crop=iw*{cw:.4}:ih*{ch:.4}:iw*{cx:.4}:ih*{cy:.4}"));
        }
        None => {
            f.push("scale=iw:ih".into());
        }
    }

    f.push(format!("scale={w}:{h}:force_original_aspect_ratio=increase"));
    f.push(format!("crop={w}:{h}"));

    if let Some(s) = clip.speed {
        if (s - 1.0).abs() > 0.001 {
            f.push(format!("setpts={}*PTS", 1.0 / s));
        }
    }

    f.push(format!("fps={fps}"));

    let a = clip.adjust.clone().unwrap_or_default();

    // Keyframe độc lập cho ba thuộc tính màu, nếu có thì ghi đè giá trị tĩnh.
    let brightness_expr = keyframe_expression(&rel_points(clip, "brightness"));
    let contrast_expr = keyframe_expression(&rel_points(clip, "contrast"));
    let saturation_expr = keyframe_expression(&rel_points(clip, "saturation"));

    let brightness = brightness_expr
        .unwrap_or_else(|| format!("{:.4}", clamp(a.brightness, -1.0, 1.0) * 0.4));
    let contrast = contrast_expr.unwrap_or_else(|| {
        format!("{:.4}", 1.0 + clamp(a.contrast, -1.0, 1.0) * 0.8)
    });
    let saturation = saturation_expr.unwrap_or_else(|| {
        format!("{:.4}", clamp(1.0 + a.saturation, 0.0, 3.0))
    });
    f.push(format!(
        "eq=brightness={brightness}:contrast={contrast}:saturation={saturation}"
    ));

    let t = clamp(a.temperature, -1.0, 1.0);
    if t.abs() > 0.001 {
        let shift = t * 0.12;
        f.push(format!("colorbalance=rs={shift:.4}:bs={:.4}", -shift));
    }

    let shadows = clamp(a.shadows, -1.0, 1.0);
    if shadows.abs() > 0.001 {
        f.push(format!("eq=gamma={:.4}", 1.0 - shadows * 0.45));
    }

    let hl = clamp(a.highlights, -1.0, 1.0);
    if hl.abs() > 0.001 {
        let top = 1.0 - hl.max(0.0) * 0.6 + hl.min(0.0) * 0.4;
        f.push(format!(
            "colorlevels=romax={top:.4}:gomax={top:.4}:bomax={top:.4}"
        ));
    }

    let sharpen = clamp(a.sharpen, 0.0, 1.0);
    if sharpen > 0.001 {
        f.push(format!("unsharp=5:5:{}", sharpen * 1.4));
    }

    let vig = clamp(a.vignette, 0.0, 1.0);
    if vig > 0.001 {
        f.push(format!("vignette=angle=PI/{}", 4.0 + vig * 4.0));
    }

    if a.black_white {
        f.push("colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3".into());
    }

    // Đường cong màu.
    if let Some(curves) = &clip.curves {
        let master = if curves.master.trim().is_empty() {
            None
        } else {
            Some(curves.master.as_str())
        };
        let red = if curves.red.trim().is_empty() {
            None
        } else {
            Some(curves.red.as_str())
        };
        let green = if curves.green.trim().is_empty() {
            None
        } else {
            Some(curves.green.as_str())
        };
        let blue = if curves.blue.trim().is_empty() {
            None
        } else {
            Some(curves.blue.as_str())
        };
        if master.is_some() || red.is_some() || green.is_some() || blue.is_some() {
            let mut parts: Vec<String> = Vec::new();
            if let Some(p) = master {
                parts.push(format!("all='{p}'"));
            }
            if let Some(p) = red {
                parts.push(format!("r='{p}'"));
            }
            if let Some(p) = green {
                parts.push(format!("g='{p}'"));
            }
            if let Some(p) = blue {
                parts.push(format!("b='{p}'"));
            }
            f.push(format!("curves={}", parts.join(":")));
        }
    }

    // LUT.
    if let Some(lut) = &clip.lut {
        if !lut.path.is_empty() && PathBuf::from(&lut.path).exists() {
            let strength = clamp(lut.strength, 0.0, 1.0);
            if strength >= 0.999 {
                f.push(format!("lut3d='{}'", lut.path));
            } else {
                // Nội suy giữa ảnh gốc và ảnh đã LUT, rồi trộn theo độ mạnh.
                f.push(format!(
                    "split[a][b];[b]lut3d='{}'[l];[a][l]blend=all_expr='A*(1-{strength:.4})+B*{strength:.4}'",
                    lut.path
                ));
            }
        }
    }

    // Lọc màu nền. chromakey cần nền phẳng nên dùng bộ lọc đơn giản hơn.
    if let Some(chroma) = &clip.chroma {
        if chroma.enabled {
            let key = hex_color(&chroma.color);
            let similarity = clamp(chroma.similarity, 0.01, 1.0);
            let blend = clamp(chroma.smoothness, 0.0, 1.0);
            f.push(format!("chromakey={key}:{similarity:.4}:{blend:.4}"));
            let spill = clamp(chroma.spill, 0.0, 1.0);
            if spill > 0.001 {
                // `despill` dùng `mix` (0..1) và `type` là số nguyên: 0 = green.
                f.push(format!(
                    "despill=type=0:mix={spill:.3}:expand={:.3}",
                    spill * 0.5
                ));
            }
        }
    }

    // Fade mở/đóng tính theo giá trị thanh fade (0..1 -> 0..0.5s).
    let fade = a.fade;
    if fade > 0.001 {
        let d = clamp(fade * 0.5, 0.05, 2.0);
        f.push(format!("fade=t=in:st=0:d={d:.3}"));
        let out_start = (clip.duration - d).max(0.0);
        f.push(format!("fade=t=out:st={out_start:.3}:d={d:.3}"));
    }

    // Keyframe hình ảnh: scale, vị trí, độ đục. Áp dụng sau khi đã scale về khung.
    let scale_expr = keyframe_expression(&rel_points(clip, "scale"));
    if let Some(expr) = scale_expr {
        f.push(format!(
            "scale=iw*{expr}/100:ih*{expr}/100,scale={w}:{h}"
        ));
    }
    let opacity_expr = keyframe_expression(&rel_points(clip, "opacity"));
    if let Some(expr) = opacity_expr {
        // colorchannelmixer không nhận biểu thức cho alpha, geq thì có (biến T).
        f.push("format=rgba".into());
        f.push(format!(
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{}'",
            expr.replace('t', "T")
        ));
    }

    f
}

/// Keyframe đã chuyển sang thời gian tương đối trong clip.
fn rel_points(clip: &TimelineClip, prop: &str) -> Vec<(f64, f64)> {
    keyframe_points(clip, prop)
        .into_iter()
        .map(|(t, v)| (to_clip_time(clip, t), v))
        .filter(|(t, _)| *t >= -0.001)
        .collect()
}

/// Nối nhiều `atempo` để đạt tốc độ ngoài khoảng 0.5..2 mà bộ lọc cho phép.
///
/// `atempo` chỉ nhận 0.5..2 mỗi bước, nên tốc độ 4 cần hai bước 2×, còn 0.25
/// cần hai bước 0.5×. Lặp lại bằng phép nhân dừ ở khi vào khoảng cho phép.
fn atempo_chain(speed: f64) -> Vec<String> {
    let target = speed.clamp(0.05, 20.0);
    let mut out = Vec::new();
    // Nhân dần các hệ số hợp lệ cho tới khi phần còn lại vừa khoảng 0.5..2.
    let mut factor = 1.0_f64;
    while target / factor > 2.0 + 1e-6 {
        factor *= 2.0;
        out.push("atempo=2.0".to_string());
    }
    while target / factor < 0.5 - 1e-6 {
        factor *= 0.5;
        out.push("atempo=0.5".to_string());
    }
    let rest = target / factor;
    if (rest - 1.0).abs() > 0.001 {
        // `{}` bỏ số 0 thừa: 2.0 -> "2", 1.5 -> "1.5", tránh "2.0000".
        out.push(format!("atempo={rest}"));
    }
    out
}

fn audio_filter_chain(clip: &TimelineClip) -> Vec<String> {
    let mut f: Vec<String> = Vec::new();
    if let Some(s) = clip.speed {
        f.extend(atempo_chain(s));
    }
    let vol = clamp(clip.volume.unwrap_or(1.0), 0.0, 2.0);
    if (vol - 1.0).abs() > 0.001 {
        f.push(format!("volume={vol:.3}"));
    }
    if clip.muted {
        f.push("volume=0".into());
    }
    f
}

/// Thân bộ lọc của một hiệu ứng, theo bản thường hoặc bản mạnh.
///
/// Danh sách id và chuỗi lệnh phải khớp `src/effects.ts`; toàn bộ đã được kiểm
/// chứng bằng ffmpeg thật trong `kiemHieuUng.ts`.
fn hieu_ung(id: &str, manh: bool) -> Option<&'static str> {
    Some(match (id, manh) {
        // ----- Chuyển động -----
        ("zoom_vao", _) => {
            "scale=iw*'1+0.35*min(t/3\\,1)':ih*'1+0.35*min(t/3\\,1)':eval=frame,crop=iw/1.35:ih/1.35"
        }
        ("zoom_ra", _) => {
            "scale=iw*'(1.4-0.4*min(t/3\\,1))':ih*'(1.4-0.4*min(t/3\\,1))':eval=frame,crop=iw/1.4:ih/1.4"
        }
        ("zoom_3d_vao", _) => {
            "scale=iw*'1+0.5*min(t/3\\,1)':ih*'1+0.5*min(t/3\\,1)':eval=frame,crop=iw/1.5:ih/1.5"
        }
        ("lay", _) => "crop=iw-16:ih-16:'8+4*sin(t*38)':'8+4*cos(t*31)',scale=iw:ih",
        ("chop_an", false) => {
            "eq=brightness='0.22*exp(-pow((mod(t\\,1.5)-0.4)*14\\,2))':eval=frame"
        }
        ("chop_an", true) => {
            "eq=brightness='0.38*exp(-pow((mod(t\\,1.2)-0.4)*12\\,2))':eval=frame"
        }
        ("pho_de", _) => "eq=brightness='0.2*min(t/2\\,1)':eval=frame",

        // ----- Cổ điển -----
        ("phim", false) => "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=saturation=0.85",
        ("phim", true) => {
            "curves=all='0/0 0.3/0.35 0.7/0.9 1/1',noise=alls=12:allf=t"
        }
        ("truyen_anh", _) => "eq=saturation=0",
        ("sepia", _) => "colorchannelmixer=.39:.77:.19:0:.35:.69:.17:0:.27:.53:.13:0",

        // ----- Retro -----
        ("vhs", false) => "chromashift=crh=3:cbh=-3:crv=2:cbv=-2,noise=alls=8:allf=t+u",
        ("vhs", true) => "chromashift=crh=7:cbh=-7:crv=5:cbv=-5,noise=alls=18:allf=t+u",
        ("retro_zoom", _) => {
            "scale=iw*'1.02+0.3*floor(min(t/0.7\\,4))/4':ih*'1.02+0.3*floor(min(t/0.7\\,4))/4':eval=frame,crop=iw/1.32:ih/1.32"
        }
        ("crt", _) => {
            "eq=saturation=1.15:contrast=1.1,vignette=angle=PI/4.5,noise=alls=6:allf=t"
        }
        ("loa_sieu", _) => "eq=brightness=0.08:saturation=1.3,vignette=angle=PI/2.5",

        // ----- Nghệ thuật -----
        ("neon", false) => "eq=saturation=1.6:contrast=1.2:gamma=1.05",
        ("neon", true) => "eq=saturation=2.2:contrast=1.35:gamma=1.1",
        ("trieu_luong", _) => "eq=saturation=1.25:gamma=1.12:brightness=0.04",
        ("mo_man", _) => "gblur=sigma=2,eq=brightness=0.05:gamma=1.1",
        ("doi_mau", _) => "negate",
        ("am_bao", _) => "format=gray,eq=contrast=1.7:brightness=-0.04",
        ("am", _) => "colortemperature=temperature=6500",
        ("lanh", _) => "colortemperature=temperature=10000",
        ("hoai_niem", _) => {
            "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=contrast=1.05:saturation=0.9"
        }

        // ----- Biến dạng -----
        ("pixel", false) => "scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor",
        ("pixel", true) => "scale=iw/26:ih/26,scale=iw*26:ih*26:flags=neighbor",
        ("khay_mo", _) => "crop=iw/3:ih/3,tile=3x3,scale=iw:ih",
        ("guong", _) => "hflip",
        ("kaleido", _) => {
            "{IN}split[ka][kb];[kb]hflip[kc];[ka][kc]vstack,scale=iw/2:ih:flags=neighbor"
        }
        ("xoay", _) => "rotate=t*0.15:c=none:fillcolor=black",
        // `geq` dùng biến `T` cho thời gian tính bằng giây.
        ("gia_pho", _) => {
            "geq=r='r(X\\,Y+8*sin(X/40+3*T))':g='g(X\\,Y+8*sin(X/40+3*T))':b='b(X\\,Y+8*sin(X/40+3*T))'"
        }

        // ----- Ánh sáng -----
        ("phat_sang", false) => {
            "{IN}split[sa][sb];[sb]gblur=sigma=8[sg];[sa][sg]blend=all_mode=screen:all_opacity=0.45"
        }
        ("phat_sang", true) => {
            "{IN}split[sa][sb];[sb]gblur=sigma=16[sg];[sa][sg]blend=all_mode=screen:all_opacity=0.7"
        }
        ("lam_mo", false) => "boxblur=3:1",
        ("lam_mo", true) => "boxblur=8:2",
        ("tang_net", _) => "unsharp=5:5:1.1",
        ("vien_toi", _) => "vignette=angle=PI/3.2",

        _ => return None,
    })
}

fn map_mix_mode(mode: &str) -> Option<&'static str> {
    match mode {
        "normal" => None,
        "multiply" => Some("multiply"),
        "screen" => Some("screen"),
        "overlay" => Some("overlay"),
        "soft_light" => Some("softlight"),
        "hard_light" => Some("hardlight"),
        "difference" => Some("difference"),
        "lighten" => Some("lighten"),
        "darken" => Some("darken"),
        "color_dodge" => Some("coloredodge"),
        _ => None,
    }
}

/// Tên chuyển cảnh ffmpeg mà clip mang ở mép phải, None nếu không có.
fn transition_kind(clip: &TimelineClip) -> Option<&'static str> {
    match clip.transition.as_deref().unwrap_or("none") {
        "fade" => Some("fade"),
        "fadeblack" => Some("fadeblack"),
        "fadewhite" => Some("fadewhite"),
        "wipeleft" => Some("wipeleft"),
        "wiperight" => Some("wiperight"),
        "wipeup" => Some("wipeup"),
        "wipedown" => Some("wipedown"),
        "slideleft" => Some("slideleft"),
        "slideright" => Some("slideright"),
        "slideup" => Some("slideup"),
        "slidedown" => Some("slidedown"),
        "smoothleft" => Some("smoothleft"),
        "smoothright" => Some("smoothright"),
        "circleopen" => Some("circleopen"),
        "circleclose" => Some("circleclose"),
        "radial" => Some("radial"),
        "dissolve" => Some("dissolve"),
        "pixelize" => Some("pixelize"),
        "diagtl" => Some("diagtl"),
        "diagtr" => Some("diagtr"),
        "distance" => Some("distance"),
        "rectcrop" => Some("rectcrop"),
        _ => None,
    }
}

/// Độ dài chuyển cảnh (giây), bị cắt lại cho vừa với hai clip.
fn transition_duration(left: &TimelineClip, right: &TimelineClip) -> f64 {
    let wanted = left
        .transition_duration
        .unwrap_or(0.5)
        .clamp(0.05, 5.0);
    // Không được dài hơn clip nào trong hai clip, và offset không được âm.
    let room = left
        .duration
        .min(right.duration)
        .min(right.start.max(0.0));
    wanted.min(room).max(0.05)
}

/// Dựng đoạn video của một clip cho lát thời gian [t0, t1] (thời gian tuyệt
/// đối trên timeline), trả về nhãn đã dựng xong.
///
/// Chuỗi bộ lọc màu chạy trước `trim` để keyframe và fade vẫn tính theo thời
/// gian riêng của clip; lát cắt áp dụng sau cùng.
fn clip_segment(
    clip: &TimelineClip,
    idx: usize,
    t0: f64,
    t1: f64,
    w: u32,
    h: u32,
    fps: u32,
    graph: &mut String,
) -> String {
    let chain = video_filter_chain(clip, w, h, fps).join(",");
    let from = (t0 - clip.start).max(0.0);
    let to = (t1 - clip.start).min(clip.duration);
    let tag = format!("sg{idx}_{}", t0.to_string().replace('.', "_"));
    let label = format!("[{tag}]");
    let mut f = chain;
    f.push_str(&format!(",fps={fps}"));
    f.push_str(&format!(
        ",trim=start={from:.4}:end={to:.4},setpts=PTS-STARTPTS"
    ));

    // Hiệu ứng ghép nhiều nhánh phải là một khối filtergraph riêng, không nối
    // bằng dấu phẩy. Nhãn bên trong được tiền tố bằng `tag` để không đụng nhãn
    // của clip khác.
    let hieu = clip
        .effect
        .as_deref()
        .and_then(|id| hieu_ung(id, clip.effect_strong.unwrap_or(false)));
    match hieu {
        None => graph.push_str(&format!("[{idx}:v]{f}{label};")),
        // Một câu lệnh: nối thẳng vào chuỗi hiện có.
        Some(body) if !body.contains(';') => {
            graph.push_str(&format!("[{idx}:v]{f},{body}{label};"))
        }
        // Nhiều câu lệnh: chuỗi chính tạo nhãn trung gian rồi khối hiệu ứng
        // lấy nhãn đó qua `{IN}`.
        Some(body) => {
            let mid = format!("[{tag}i]");
            let noi = body
                .replace("{IN}", &mid)
                .replace("[ka]", &format!("[{tag}ka]"))
                .replace("[kb]", &format!("[{tag}kb]"))
                .replace("[kc]", &format!("[{tag}kc]"))
                .replace("[sa]", &format!("[{tag}sa]"))
                .replace("[sb]", &format!("[{tag}sb]"))
                .replace("[sg]", &format!("[{tag}sg]"));
            graph.push_str(&format!("[{idx}:v]{f}{mid};"));
            // Nhãn cuối của khối là output ẩn, nên gắn nhãn ra bằng `null`.
            graph.push_str(&format!("{noi},null{label};"));
        }
    }
    label
}

// ---------------------------------------------------------------------------
// Lệnh Tauri
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phân tích âm thanh: waveform và nhịp
// ---------------------------------------------------------------------------

/// Đọc toàn bộ tệp thành PCM mono 16-bit �nh tần số thấp, trả về mẫu thô.
fn decode_pcm_mono(path: &str) -> Result<Vec<i16>, String> {
    let output = Command::new("ffmpeg")
        .arg("-v")
        .arg("quiet")
        .arg("-i")
        .arg(path)
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("s16le")
        .arg("-")
        .output()
        .map_err(|e| format!("Không đọc được âm thanh: {e}"))?;
    if !output.status.success() {
        return Err("ffmpeg không giải mã được tệp âm thanh".into());
    }
    let bytes = output.stdout;
    Ok(bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect())
}

/// Đọc thời lượng của tệp media bằng ffprobe, trả về `fallback` nếu lỗi.
#[tauri::command]
fn probe_media(path: String, fallback: Option<f64>) -> Result<f64, String> {
    let fb = fallback.unwrap_or(5.0);
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("Không chạy được ffprobe: {e}"))?;
    if !output.status.success() {
        return Ok(fb);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // Không kéo thêm serde_json phức tạp: dò tay trường "duration".
    for line in text.lines() {
        let line = line.trim().trim_end_matches(',');
        if let Some(rest) = line.strip_prefix("\"duration\":") {
            if let Ok(v) = rest.trim().parse::<f64>() {
                if v.is_finite() && v > 0.0 {
                    return Ok(v);
                }
            }
        }
    }
    Ok(fb)
}

/// Độ lớn mẫu tuyệt đối, chuẩn hoá về 0..1.
fn envelope(samples: &[i16], window: usize) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    let win = window.max(1);
    samples
        .chunks(win)
        .map(|chunk| {
            let peak = chunk
                .iter()
                .map(|s| s.abs() as f32 / 32768.0)
                .fold(0.0_f32, f32::max);
            peak
        })
        .collect()
}

/// Đường bao âm thanh để vẽ waveform: `buckets` giá trị trong khoảng 0..1.
#[tauri::command]
fn audio_waveform(path: String, buckets: Option<u32>) -> Result<Vec<f32>, String> {
    let buckets = buckets.unwrap_or(600).clamp(16, 4096) as usize;
    let samples = decode_pcm_mono(&path)?;
    if samples.is_empty() {
        return Ok(vec![0.0; buckets]);
    }
    let per = (samples.len() as f64 / buckets as f64).ceil() as usize;
    let peaks = envelope(&samples, per.max(1));
    // Cân bằng theo đỉnh lớn nhất để waveform luôn nhìn rõ.
    let max = peaks.iter().cloned().fold(0.0_f32, f32::max).max(1e-6);
    let out: Vec<f32> = peaks.iter().take(buckets).map(|p| (p / max).min(1.0)).collect();
    Ok(out)
}

/// Phát hiện nhịp đơn giản: năng lượng cửa sổ trượt, đỉnh nổi lên rõ rệt so với
/// trung bình cục bộ. Trả về các mốc thời gian (giây).
#[tauri::command]
fn detect_beats(path: String, sensitivity: Option<f32>) -> Result<Vec<f64>, String> {
    let samples = decode_pcm_mono(&path)?;
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let sample_rate = 8000.0_f64;
    let hop = 256usize; // 32ms
    let window = 512usize; // 64ms
    let levels: Vec<f32> = samples
        .windows(window)
        .step_by(hop)
        .map(|w| {
            let sum: f32 = w.iter().map(|s| (*s as f32 / 32768.0).abs()).sum();
            sum / w.len() as f32
        })
        .collect();
    if levels.len() < 4 {
        return Ok(Vec::new());
    }

    // Trung bình trượt theo cửa sổ ~1 giây.
    let local_window = 32usize;
    let mut beats: Vec<f64> = Vec::new();
    let sensitivity = sensitivity.unwrap_or(0.5).clamp(0.05, 2.0);
    let min_gap_frames = ((0.28_f64 * sample_rate) / hop as f64) as usize;
    let mut last_beat = 0usize;

    for i in 1..levels.len() - 1 {
        let from = i.saturating_sub(local_window);
        let local_mean = levels[from..=i].iter().sum::<f32>() / (i - from + 1) as f32;
        if levels[i] <= levels[i - 1] || levels[i] < levels[i + 1] {
            continue;
        }
        if levels[i] < local_mean * (1.0 + sensitivity) {
            continue;
        }
        if beats.is_empty() && levels[i] < 0.05 {
            continue;
        }
        if i < last_beat + min_gap_frames {
            continue;
        }
        beats.push(i as f64 * hop as f64 / sample_rate);
        last_beat = i;
    }
    Ok(beats)
}

/// Đường dẫn bản nháp tự lưu, nằm trong thư mục dữ liệu của ứng dụng.
///
/// Dùng một tệp cố định để lúc khởi động luôn biết đọc từ đâu, không cần người
/// dùng chọn tệp. Trả về rỗng khi chạy ngoài Tauri (ví dụ trong kiểm thử).
#[tauri::command]
fn draft_path(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("ban-nhap.json").to_string_lossy().to_string())
}

/// Một dự án từng được mở, dùng cho danh sách "gần đây".
#[derive(serde::Serialize, serde::Deserialize)]
struct RecentProject {
    path: String,
    ten: String,
}

/// Đọc danh sách dự án mở gần đây, mới nhất trước.
#[tauri::command]
fn recent_projects(app: tauri::AppHandle) -> Vec<RecentProject> {
    let Some(dir) = app.path().app_data_dir().ok() else {
        return Vec::new();
    };
    let duong_dan = dir.join("mo-gan-nay.json");
    let Ok(noi_dung) = fs::read_to_string(&duong_dan) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<RecentProject>>(&noi_dung).unwrap_or_default()
}

/// Ghi một dự án vào danh sách gần đây, dồn lên đầu và giữ tối đa 10 mục.
#[tauri::command]
fn recent_push(app: tauri::AppHandle, path: String, ten: String) -> Vec<RecentProject> {
    let Ok(dir) = app.path().app_data_dir() else {
        return Vec::new();
    };
    let _ = fs::create_dir_all(&dir);
    let duong_dan = dir.join("mo-gan-nay.json");
    let mut danh_sach: Vec<RecentProject> = fs::read_to_string(&duong_dan)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    danh_sach.retain(|p| p.path != path);
    danh_sach.insert(0, RecentProject { path, ten });
    danh_sach.truncate(10);
    if let Ok(chuoi) = serde_json::to_string(&danh_sach) {
        let _ = fs::write(&duong_dan, chuoi);
    }
    danh_sach
}

/// Xoá một mục khỏi danh sách gần đây (tệp đã bị xoá hoặc di chuyển).
#[tauri::command]
fn recent_remove(app: tauri::AppHandle, path: String) -> Vec<RecentProject> {
    let Ok(dir) = app.path().app_data_dir() else {
        return Vec::new();
    };
    let duong_dan = dir.join("mo-gan-nay.json");
    let mut danh_sach: Vec<RecentProject> = fs::read_to_string(&duong_dan)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    danh_sach.retain(|p| p.path != path);
    if let Ok(chuoi) = serde_json::to_string(&danh_sach) {
        let _ = fs::write(&duong_dan, chuoi);
    }
    danh_sach
}

/// Ghi nội dung dự án ra tệp (chỉ một tệp văn bản, không phải lưu video).
#[tauri::command]
fn save_project(path: String, data: String) -> Result<String, String> {
    fs::write(&path, data).map_err(|e| format!("Không ghi được tệp dự án: {e}"))?;
    Ok(path)
}

/// Đọc nội dung dự án từ tệp.
#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Không đọc được tệp dự án: {e}"))
}

/// Lấy các khung hình làm ảnh nhỏ cho clip trên timeline.
///
/// CapCut vẽ dải thumbnail dọc theo clip. Ta trả về một dải PNG ngang gộp
/// `count` khung, rồi frontend cắt ra bằng CSS nên chỉ cần gọi ffmpeg một lần.
#[tauri::command]
fn clip_thumbnails(path: String, seek_to: f64, duration: f64, count: u32, height: u32) -> Result<String, String> {
    let count = count.clamp(1, 24);
    let height = height.clamp(24, 240);
    // Vị trí lấy mẫu: rải đều trong clip, nhưng bỏ qua đoạn cuối quá ngắn.
    let span = duration.max(0.1);
    let mut seeks: Vec<f64> = Vec::new();
    let mut filters: Vec<String> = Vec::new();
    for i in 0..count {
        seeks.push(seek_to + span * (i as f64 + 0.5) / count as f64);
        filters.push(format!(
            "[{i}:v]scale=-1:{height},setsar=1,format=rgba[th{i}]"
        ));
    }
    let list: Vec<String> = (0..count).map(|i| format!("[th{i}]")).collect();
    let strip = temp_path(&format!("thumbs_{}.png", std::process::id()));
    let graph = format!(
        "{};{}hstack=inputs={count}[out]",
        filters.join(";"),
        list.join("")
    );
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y").arg("-nostdin").arg("-v").arg("error");
    // Mỗi mốc thời gian cần một input riêng để `hstack` ghép được.
    for at in &seeks {
        cmd.arg("-ss")
            .arg(format!("{at:.3}"))
            .arg("-i")
            .arg(&path);
    }
    cmd.arg("-filter_complex")
        .arg(&graph)
        .arg("-map")
        .arg("[out]")
        .arg("-frames:v")
        .arg("1")
        .arg(&strip);
    let result = cmd.output().map_err(|e| format!("Không chạy được ffmpeg: {e}"))?;
    if !result.status.success() {
        let tail = String::from_utf8_lossy(&result.stderr);
        let last: Vec<&str> = tail.lines().rev().take(4).collect();
        return Err(format!("Lấy thumbnail lỗi:\n{}", last.join("\n")));
    }
    Ok(strip.to_string_lossy().to_string())
}

/// Ghi lớp chữ/sticker (PNG base64) ra file tạm, trả về đường dẫn.
#[tauri::command]
fn save_overlay_image(name: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;
    let path = temp_path(&format!("{name}.png"));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.split(',').next_back().unwrap_or(&base64_data))
        .map_err(|e| format!("PNG không hợp lệ: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("Không ghi được file tạm: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_video(req: ExportRequest) -> Result<String, String> {
    if req.clips.is_empty() {
        return Err("Không có clip nào để xuất".into());
    }
    // Timeline có thể lưu clip theo thứ tự khác (kéo thả, thêm xen kẽ), nên
    // sắp lại theo thời gian trước khi tính các lát cắt.
    let mut clips = req.clips.clone();
    clips.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let w = req.width.unwrap_or(1280);
    let h = req.height.unwrap_or(720);
    let h = req.height.unwrap_or(720);
    let fps = req.fps.unwrap_or(30);

    // Clip đảo ngược phải đọc hết rồi ghi ra tệp tạm, vì bộ lọc `reverse` của
    // ffmpeg cần toàn bộ khung hình trong bộ nhớ.
    let mut tam_dao_nguoc: Vec<PathBuf> = Vec::new();
    for (i, clip) in clips.iter_mut().enumerate() {
        if !clip.reverse || clip.is_image() || clip.duration <= 0.05 {
            continue;
        }
        let span = clip.duration * clip.speed.unwrap_or(1.0).max(0.05);
        let out = temp_path(&format!("dao_nguoc_{}_{}.mp4", std::process::id(), i));
        let result = Command::new("ffmpeg")
            .arg("-y")
            .arg("-nostdin")
            .arg("-v")
            .arg("error")
            .arg("-ss")
            .arg(clip.seek_to.unwrap_or(0.0).to_string())
            .arg("-t")
            .arg(span.to_string())
            .arg("-i")
            .arg(&clip.path)
            .arg("-vf")
            .arg(format!(
                "scale={w}x{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps},reverse"
            ))
            .arg("-c:v")
            .arg("libx264")
            .arg("-crf")
            .arg("18")
            .arg("-c:a")
            .arg("aac")
            .arg(&out)
            .output();
        match result {
            Ok(r) if r.status.success() => {
                clip.path = out.to_string_lossy().to_string();
                clip.seek_to = Some(0.0);
                // Tệp đã nén sẵn về khung, đừng co giãn và đổi tốc độ lần nữa.
                clip.speed = Some(1.0);
                tam_dao_nguoc.push(out);
            }
            Ok(r) => {
                let tail = String::from_utf8_lossy(&r.stderr);
                let lines: Vec<&str> = tail.lines().rev().take(4).collect();
                return Err(format!("Không đảo ngược được clip:\n{}", lines.join("\n")));
            }
            Err(e) => return Err(format!("Không chạy được ffmpeg: {e}")),
        }
    }
    let crf = match req.quality.as_deref() {
        Some("low") => "28",
        Some("high") => "18",
        _ => "23",
    };

    let mut cmd = Command::new("ffmpeg");
    // Không đọc stdin: tránh treo khi ffmpeg chạy nền hoặc trong test.
    cmd.arg("-y").arg("-nostdin");

    for clip in &clips {
        // `speed` nén/nới thời gian bằng `setpts`, nên phải đọc nhiều nguồn hơn
        // rồi mới nén lại cho đúng `duration` giây trên timeline.
        let source_span = clip.duration * clip.speed.unwrap_or(1.0).max(0.05);
        // Ảnh phải lặp vô hạn để có đủ dòng hình trong bộ dài của clip.
        if clip.is_image() {
            cmd.arg("-loop").arg("1").arg("-t").arg(source_span.to_string());
        } else {
            cmd.arg("-ss")
                .arg(clip.seek_to.unwrap_or(0.0).to_string())
                .arg("-t")
                .arg(source_span.to_string());
        }
        cmd.arg("-i").arg(&clip.path);
    }

    let live_texts: Vec<&ImageLayer> = req
        .texts
        .iter()
        .filter(|l| PathBuf::from(&l.image_path).exists())
        .collect();
    for layer in &live_texts {
        cmd.arg("-loop")
            .arg("1")
            .arg("-t")
            .arg(layer.duration.to_string())
            .arg("-i")
            .arg(&layer.image_path);
    }

    let live_audios: Vec<&AudioTrack> = req
        .audios
        .iter()
        .filter(|a| !a.muted && PathBuf::from(&a.path).exists())
        .collect();
    for audio in &live_audios {
        cmd.arg("-t")
            .arg(audio.duration.to_string())
            .arg("-i")
            .arg(&audio.path);
    }

    let text_input_base = clips.len();
    let audio_input_base = text_input_base + live_texts.len();

    let mut graph = String::new();

    // --- Dựng video theo lát cắt thời gian ---
    //
    // Timeline cho phép khoảng trống và clip chồng nhau (nhiều lớp), nên không
    // thể dùng `concat` thẳng. Ta chia timeline thành các lát giữa hai mốc thời
    // gian (đầu/cuối clip, đầu/cuối cửa sổ chuyển cảnh). Trong mỗi lát, tập clip
    // đang chạy là cố định nên chỉ cần vẽ đè lên nền đen rồi ghép các lát lại.
    //
    // Cách này xử lý được cả ba trường hợp: khoảng trống (lát không clip -> đen),
    // chồng lấn (vẽ đè nhiều lớp) và chuyển cảnh (lát giao nhau dùng `xfade`).
    let mut marks: Vec<f64> = vec![0.0];
    for clip in &clips {
        marks.push(clip.start.max(0.0));
        marks.push(clip.start + clip.duration);
    }
    let mut edges: Vec<(usize, usize, &'static str, f64)> = Vec::new();
    for i in 0..clips.len().saturating_sub(1) {
        if let Some(kind) = transition_kind(&clips[i]) {
            let td = transition_duration(&clips[i], &clips[i + 1]);
            if td > 0.001 {
                let left = clips[i].start + clips[i].duration;
                let right = clips[i + 1].start;
                if (left - right).abs() < 0.05 {
                    edges.push((i, i + 1, kind, td));
                    marks.push(left);
                    marks.push(right);
                }
            }
        }
    }
    let total_duration = req
        .clips
        .iter()
        .map(|c| c.start + c.duration)
        .fold(0.0_f64, f64::max);
    marks.push(total_duration);
    marks.retain(|m| *m >= -0.001 && *m <= total_duration + 0.001);
    marks.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    marks.dedup_by(|a, b| (*a - *b).abs() < 0.004);

    let mut slice_labels: Vec<String> = Vec::new();
    for s in 0..marks.len().saturating_sub(1) {
        let t0 = marks[s];
        let t1 = marks[s + 1];
        let len = t1 - t0;
        if len <= 0.0005 {
            continue;
        }
        // Các clip đang chạy trong lát này.
        let active: Vec<usize> = (0..clips.len())
            .filter(|i| {
                let c = &clips[*i];
                c.start < t1 - 0.001 && c.start + c.duration > t0 + 0.001
            })
            .collect();

        let label = format!("[sl{s}]");
        if active.is_empty() {
            graph.push_str(&format!(
                "color=c=black:s={w}x{h}:r={fps}:d={len:.3},format=yuv420p{label};"
            ));
            slice_labels.push(label);
            continue;
        }

        // Lát chỉ có hai lớp và trùng cửa sổ chuyển cảnh -> `xfade`.
        if active.len() == 2 {
            let (first, second) = if clips[active[0]].start <= clips[active[1]].start {
                (active[0], active[1])
            } else {
                (active[1], active[0])
            };
            if let Some((_, _, kind, td)) = edges
                .iter()
                .find(|(a, b, _, _)| *a == first && *b == second)
                .copied()
            {
                if (len - td).abs() < 0.02 {
                    let fa = clip_segment(&clips[first], first, t0, t1, w, h, fps, &mut graph);
                    let fb = clip_segment(&clips[second], second, t0, t1, w, h, fps, &mut graph);
                    graph.push_str(&format!(
                        "{fa}{fb}xfade=transition={kind}:duration={td:.3}:offset=0{label};"
                    ));
                    slice_labels.push(label);
                    continue;
                }
            }
        }

        // Lát thường: nền đen rồi vẽ đè từng lớp.
        graph.push_str(&format!(
            "color=c=black:s={w}x{h}:r={fps}:d={len:.3}[bg{s}];"
        ));
        let mut cursor = format!("[bg{s}]");
        for (rank, idx) in active.iter().enumerate() {
            let seg = clip_segment(&clips[*idx], *idx, t0, t1, w, h, fps, &mut graph);
            let next = format!("[lx{s}_{rank}]");
            let mode = clips[*idx].mix_mode.as_deref().and_then(map_mix_mode);
            match mode {
                // `blend` bỏ qua alpha nên chỉ dùng cho lớp đục. Cả nền và lớp
                // phải cùng định dạng phẳng trước khi trộn.
                Some(m) => {
                    graph.push_str(&format!(
                        "{cursor}format=gbrp[bgm{s}_{rank}];{seg}format=gbrp[fgm{s}_{rank}];\
                         [bgm{s}_{rank}][fgm{s}_{rank}]blend=all_mode={m}:all_opacity=1{next};"
                    ));
                }
                None => {
                    graph.push_str(&format!("{cursor}{seg}overlay=0:0{next};"));
                }
            }
            cursor = next;
        }
        graph.push_str(&format!("{cursor}format=yuv420p{label};"));
        slice_labels.push(label);
    }

    graph.push_str(&format!(
        "{}concat=n={}:v=1:a=0[basev];",
        slice_labels.concat(),
        slice_labels.len()
    ));

    if let Some(f) = req.filter.as_deref() {
        match f {
            "grayscale" => {
                graph.push_str("[basev]colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3[basev];")
            }
            // `colortemp` không tồn tại trong một số bản ffmpeg; `colortemperature` và
            // `colorbalance` thì có mặt và cho ra màu tương đương.
            "warm" => graph.push_str("[basev]colortemperature=temperature=6500[basev];"),
            "cool" => graph.push_str("[basev]colortemperature=temperature=10000[basev];"),
            "vintage" => {
                graph.push_str("[basev]curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95'[basev];")
            }
            "film" => {
                graph.push_str("[basev]eq=contrast=1.1:saturation=0.85:gamma=0.95[basev];")
            }
            "sepia" => {
                graph.push_str("[basev]colorchannelmixer=.39:.77:.19:0:.35:.69:.17:0:.27:.53:.13:0[basev];")
            }
            "invert" => graph.push_str("[basev]negate[basev];"),
            "noir" => {
                graph.push_str(
                    "[basev]format=gray,eq=contrast=1.6:brightness=-0.05[basev];",
                )
            }
            _ => {}
        }
    }

    // --- Hiệu ứng nhanh toàn video ---
    if let Some(e) = req.effect.as_deref() {
        match e {
            "blur" => graph.push_str("[basev]boxblur=2:1[basev];"),
            // `blend` cần hai nguồn nên phải tách nhãn riêng, không dùng lại
            // nhãn đã vào một bộ lọc khác trong cùng chuỗi.
            "glow" => graph.push_str(
                "[basev]split[efsrc][efblur];[efblur]gblur=sigma=6[efglow];\
                 [efsrc][efglow]blend=all_mode=screen:all_opacity=0.5[basev];",
            ),
            "vhs" => {
                // Trôi màu + nhiễu dòng, gần với hiệu ứng video cũ.
                graph.push_str(
                    "[basev]chromashift=crh=3:cbh=-3:crv=2:cbv=-2,noise=alls=8:allf=t+u[basev];",
                );
            }
            "filmnoise" => graph.push_str("[basev]noise=alls=14:allf=t[basev];"),
            "sharpen" => graph.push_str("[basev]unsharp=5:5:1.2[basev];"),
            "vignette" => graph.push_str("[basev]vignette=angle=PI/3[basev];"),
            "bw" => {
                graph.push_str("[basev]colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3[basev];")
            }
            "invert" => graph.push_str("[basev]negate[basev];"),
            "fade" => {
                // Mờ dần ở đầu và cuối, mỗi bên 0.5 giây.
                graph.push_str(&format!(
                    "[basev]fade=t=in:st=0:d=0.5,fade=t=out:st={:.3}:d=0.5[basev];",
                    (total_duration - 0.5).max(0.0)
                ));
            }
            _ => {}
        }
    }

    // --- Ghép âm thanh ---
    //
    // Không cần chia lát: mỗi clip trễ theo `start` rồi `amix` chồng lên nhau.
    // `amix` tự cắt theo lát cắt đầu-cuối nên khoảng trống và chồng lấn đều
    // đúng; cuối cùng pad/cắt cho khớp tổng thời lượng của timeline.
    let mut mix_parts: Vec<String> = Vec::new();
    for (i, clip) in clips.iter().enumerate() {
        if clip.muted || clip.is_image() {
            continue;
        }
        let mut a = audio_filter_chain(clip);
        if a.is_empty() {
            a.push("anull".into());
        }
        a.push(format!("atrim=0:{:.3}", clip.duration));
        a.push("asetpts=N/SR/TB".into());
        let delay_ms = (clip.start * 1000.0).round().max(0.0) as i64;
        if delay_ms > 0 {
            a.push(format!("adelay={delay_ms}|{delay_ms}"));
        }
        graph.push_str(&format!("[{i}:a]{}[am{i}];", a.join(",")));
        mix_parts.push(format!("[am{i}]"));
    }
    let audio_count = mix_parts.len();
    if audio_count == 0 {
        graph.push_str(&format!(
            "anullsrc=channel_layout=stereo:sample_rate=48000,\
             atrim=0:{total_duration:.3},asetpts=N/SR/TB[clipa];"
        ));
    } else if audio_count == 1 {
        graph.push_str(&format!(
            "{}apad,atrim=0:{total_duration:.3}[clipa];",
            mix_parts.concat()
        ));
    } else {
        graph.push_str(&format!(
            "{}amix=inputs={audio_count}:duration=longest:normalize=0,\
             apad,atrim=0:{total_duration:.3}[clipa];",
            mix_parts.concat()
        ));
    }

    // --- Trộn nhạc nền ---
    let mut mix_inputs = String::from("[clipa]");
    for (j, audio) in live_audios.iter().enumerate() {
        let idx = audio_input_base + j;
        let vol = clamp(audio.volume.unwrap_or(1.0), 0.0, 2.0);
        let delay_ms = (audio.start * 1000.0).round() as i64;
        graph.push_str(&format!(
            "[{idx}:a]volume={vol:.3},adelay={delay_ms}|{delay_ms}[bg{j}];"
        ));
        mix_inputs.push_str(&format!("[bg{j}]"));
    }
    let mix_count = 1 + live_audios.len();
    graph.push_str(&format!(
        "{mix_inputs}amix=inputs={mix_count}:duration=longest:normalize=0[outa];"
    ));

    // --- Dán lớp chữ / nhãn dán ---
    let mut cursor = String::from("[basev]");
    let mut placed = 0usize;
    for layer in live_texts.iter() {
        let idx = text_input_base + placed;
        placed += 1;
        let x = ((layer.x / 100.0) * w as f64 - 100.0).round() as i64;
        let y = ((layer.y / 100.0) * h as f64 - 100.0).round() as i64;
        graph.push_str(&format!("[{idx}:v]format=rgba,scale=iw:ih[layer{placed}];"));
        graph.push_str(&format!(
            "{cursor}[layer{placed}]overlay=x={x}:y={y}:enable='between(t,{:.3},{:.3})'{next};",
            layer.start,
            layer.start + layer.duration,
            next = format!("[ov{placed}]")
        ));
        cursor = format!("[ov{placed}]");
    }

    let video_out = if placed == 0 {
        "[basev]".to_string()
    } else {
        cursor
    };

    graph.push_str(&format!("{video_out}format=yuv420p[outv]"));

    cmd.arg("-filter_complex").arg(&graph);
    cmd.arg("-map").arg("[outv]").arg("-map").arg("[outa]");
    cmd.arg("-c:v").arg("libx264").arg("-crf").arg(crf);
    cmd.arg("-preset").arg("medium");
    cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
    cmd.arg("-movflags").arg("+faststart");
    cmd.arg(&req.output);

    let result = cmd
        .output()
        .map_err(|e| format!("Không chạy được ffmpeg: {e}"))?;
    if !result.status.success() {
        let tail = String::from_utf8_lossy(&result.stderr);
        let last: Vec<&str> = tail.lines().rev().take(14).collect();
        return Err(format!("ffmpeg lỗi:\n{}", last.join("\n")));
    }

    for layer in live_texts {
        let _ = fs::remove_file(&layer.image_path);
    }
    for path in &tam_dao_nguoc {
        let _ = fs::remove_file(path);
    }

    Ok(format!("Xuất thành công: {}", req.output))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

// ---------------------------------------------------------------------------
// Kiểm thử
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Thư mục tạm riêng cho test để không đụng vào tệp người dùng.
    fn thu_muc_test(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opencutcut_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("tạo thư mục test");
        dir
    }

    fn co_ffmpeg() -> bool {
        Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn co_ffprobe() -> bool {
        Command::new("ffprobe")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Tạo video màu kèm âm thanh, dùng làm đầu vào cho test.
    fn tao_clip(dir: &Path, name: &str, seconds: u32, freq: u32) -> String {
        let path = dir.join(name);
        let status = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-nostdin"])
            .args(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=25"])
            .args(["-f", "lavfi", "-i", &format!("sine=frequency={freq}:sample_rate=48000")])
            .args(["-t", &seconds.to_string(), "-c:v", "libx264", "-crf", "30", "-preset", "ultrafast"])
            .args(["-c:a", "aac", "-shortest"])
            .arg(&path)
            .status()
            .expect("chạy ffmpeg tạo clip");
        assert!(status.success(), "không tạo được clip {name}");
        path.to_string_lossy().to_string()
    }

    /// Độ dài tệp đã xuất (giây).
    fn do_thoi_luong(path: &str) -> f64 {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "format=duration"])
            .args(["-of", "csv=p=0", path])
            .output()
            .expect("chạy ffprobe");
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .expect("đọc thời lượng")
    }

    /// Kiểm tra một tệp xuất có đúng thời lượng mong muốn (sai số 0.25s).
    fn kiem_tra_tap(path: &str, can_co: f64, nhan: &str) {
        let thuc_te = do_thoi_luong(path);
        assert!(
            (thuc_te - can_co).abs() < 0.25,
            "{nhan}: thực tế {thuc_te:.3}s, cần {can_co:.3}s"
        );
    }

    fn clip_mau(path: String, bat_dau: f64, do_dai: f64) -> TimelineClip {
        TimelineClip {
            path,
            kind: Some("video".into()),
            start: bat_dau,
            duration: do_dai,
            seek_to: None,
            speed: None,
            volume: None,
            muted: false,
            locked: false,
            adjust: None,
            mix_mode: None,
            crop: None,
            chroma: None,
            curves: None,
            lut: None,
            keyframes: Vec::new(),
            transition: None,
            transition_duration: None,
            effect: None,
            effect_strong: None,
            reverse: false,
        }
    }

    fn request(clips: Vec<TimelineClip>, output: &str, w: u32, h: u32) -> ExportRequest {
        ExportRequest {
            clips,
            texts: Vec::new(),
            audios: Vec::new(),
            output: output.into(),
            width: Some(w),
            height: Some(h),
            fps: Some(25),
            filter: None,
            effect: None,
            quality: Some("low".into()),
        }
    }

    /// Xuất video và trả về thông báo (lỗi nếu ffmpeg chạy không thành công).
    fn xuat_hoac_loi(req: ExportRequest) -> String {
        match export_video(req) {
            Ok(msg) => msg,
            Err(e) => panic!("export lỗi: {e}"),
        }
    }

    #[test]
    fn xuất_clip_lien_nhau_giữ_nguyên_thoi_luong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("nhau");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), clip_mau(b, 4.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 7.0, "hai clip liền nhau");
    }

    #[test]
    fn xuất_giu_khoang_trong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("trong");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        // Clip sau bắt đầu muộn hơn 2s: phải có 2s đen ở giữa.
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), clip_mau(b, 6.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 9.0, "khoảng trống");
    }

    #[test]
    fn xuất_clip_chong_lan_linh_ho_cua_tong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("chong");
        let a = tao_clip(&dir, "a.mp4", 6, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        // Clip thứ hai nằm đè lên clip đầu: tổng thời lượng lấy theo mép phải
        // của clip kết thúc muộn nhất (2 + 4 = 6s).
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 6.0), clip_mau(b, 2.0, 4.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "clip chồng lấn");
    }

    #[test]
    fn xuất_chuyen_canh_giu_nguyen_tong_thoi_luong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("transition");
        let a = tao_clip(&dir, "a.mp4", 5, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut first = clip_mau(a, 0.0, 5.0);
        first.transition = Some("fade".into());
        first.transition_duration = Some(0.5);
        xuat_hoac_loi(request(
            vec![first, clip_mau(b, 5.0, 4.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        // Chuyển cảnh phải chồng lấn chứ không cắt bớt thời lượng.
        kiem_tra_tap(&out.to_string_lossy(), 9.0, "có chuyển cảnh");
    }

    #[test]
    fn xuất_mix_mode_khong_lam_hong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("mix");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut top = clip_mau(b, 2.0, 4.0);
        top.mix_mode = Some("screen".into());
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), top],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "mix mode");
    }

    #[test]
    fn xuất_tat_ca_clip_giu_am_thanh() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("audio");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), clip_mau(b, 4.0, 4.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        // Clip sau bắt buộc còn dòng âm thanh (trước đây bị bỏ mất khi ghép).
        let probe = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name"])
            .args(["-of", "csv=p=0", &out.to_string_lossy()])
            .output()
            .expect("chạy ffprobe");
        assert!(
            String::from_utf8_lossy(&probe.stdout).contains("aac"),
            "tệp xuất không có dòng âm thanh"
        );
        // Và âm thanh phải dài bằng video.
        let aout = dir.join("out.m4a");
        let status = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-nostdin", "-i"])
            .arg(&out)
            .args(["-vn", "-c:a", "copy"])
            .arg(&aout)
            .status()
            .expect("chạy ffmpeg");
        assert!(status.success());
        kiem_tra_tap(&aout.to_string_lossy(), 8.0, "âm thanh ghép");
    }

    #[test]
    fn xuất_clip_tat_tieng_va_clip_anh() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("muted");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut muted = clip_mau(b, 4.0, 4.0);
        muted.muted = true;
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), muted],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 8.0, "clip tắt tiếng");
    }

    #[test]
    fn xuất_toc_do_phai_dung_thu_tu_timeline() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("thutu");
        let a = tao_clip(&dir, "a.mp4", 3, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        // Truyền vào lộn thứ tự: kết quả phải theo `start`, không theo mảng.
        xuat_hoac_loi(request(
            vec![clip_mau(b, 3.0, 3.0), clip_mau(a, 0.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "thứ tự lộn");
    }

    #[test]
    fn atempo_tep_phong_dong_duoc_toc_do() {
        // 4x cần hai bước 2×, 0.25x cần hai bước 0.5×.
        assert_eq!(atempo_chain(4.0), vec!["atempo=2.0", "atempo=2"]);
        assert_eq!(atempo_chain(0.25), vec!["atempo=0.5", "atempo=0.5"]);
        assert_eq!(atempo_chain(1.5), vec!["atempo=1.5"]);
        assert!(atempo_chain(1.0).is_empty());
        // 1.5x chỉ một bước, còn 8x cần ba bước.
        assert_eq!(atempo_chain(1.5).len(), 1);
        assert_eq!(atempo_chain(8.0).len(), 3);
    }

    #[test]
    fn chuyen_canh_bi_cat_theo_clip_ngan() {
        // Transition dài hơn clip thì phải bị cắt vừa, không được âm.
        let short = clip_mau("/tmp/a.mp4".into(), 0.0, 0.2);
        let long = clip_mau("/tmp/b.mp4".into(), 0.2, 5.0);
        let (_, td) = (transition_kind(&short), transition_duration(&short, &long));
        assert!(td > 0.0 && td <= 0.2, "thời lượng chuyển cảnh = {td}");
        // Clip sau bắt đầu âm thì offset không được âm.
        let behind = clip_mau("/tmp/c.mp4".into(), -1.0, 3.0);
        let td2 = transition_duration(&long, &behind);
        assert!(td2 > 0.0 && td2 <= 3.0);
    }

    #[test]
    fn khong_co_chuyen_canh_thi_khong_dung_xfade() {
        let plain = clip_mau("/tmp/a.mp4".into(), 0.0, 3.0);
        assert_eq!(transition_kind(&plain), None);
    }

    #[test]
    fn dao_nguoc_clip_giu_nguyen_do_dai() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("dao_nguoc");
        let clip = tao_clip(&dir, "a.mp4", 4, 300);
        let out = dir.join("out.mp4");
        let mut dao = clip_mau(clip, 0.0, 4.0);
        dao.reverse = true;
        xuat_hoac_loi(request(vec![dao], &out.to_string_lossy(), 320, 180));
        kiem_tra_tap(&out.to_string_lossy(), 4.0, "clip đảo ngược");
        // Tệp tạm phải được dọn sau khi xuất.
        let con_lai: Vec<PathBuf> = std::env::temp_dir()
            .read_dir()
            .map(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with(&format!("opencutcut_dao_nguoc_{}_", std::process::id())))
                            .unwrap_or(false)
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert!(con_lai.is_empty(), "còn tệp tạm: {con_lai:?}");
    }

    #[test]
    fn tat_ca_hieu_ung_trong_kho_deu_chay_duoc() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("kho_hieu_ung");
        let clip = tao_clip(&dir, "a.mp4", 3, 300);
        // Danh sách id phải khớp `src/effects.ts`; lệch thì hậu xuất sẽ báo lỗi.
        let ids = [
            "zoom_vao", "zoom_ra", "zoom_3d_vao", "lay", "chop_an", "pho_de", "phim",
            "truyen_anh", "sepia", "vhs", "retro_zoom", "crt", "loa_sieu", "neon",
            "trieu_luong", "mo_man", "doi_mau", "am_bao", "am", "lanh", "hoai_niem", "pixel",
            "khay_mo", "guong", "kaleido", "xoay", "gia_pho", "phat_sang", "lam_mo", "tang_net",
            "vien_toi",
        ];
        for id in ids {
            for manh in [false, true] {
                let mut clip_mau_hieu = clip_mau(clip.clone(), 0.0, 3.0);
                clip_mau_hieu.effect = Some(id.to_string());
                clip_mau_hieu.effect_strong = Some(manh);
                let out = dir.join(format!("{id}{}.mp4", if manh { "-m" } else { "" }));
                xuat_hoac_loi(request(
                    vec![clip_mau_hieu],
                    &out.to_string_lossy(),
                    320,
                    180,
                ));
                kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("hiệu ứng {id}"));
            }
        }
    }

    #[test]
    fn bo_loc_va_hieu_ung_moi_deu_chay_duoc() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("effects");
        let clip = tao_clip(&dir, "a.mp4", 3, 300);
        let filters = [
            "none",
            "grayscale",
            "warm",
            "cool",
            "vintage",
            "film",
            "sepia",
            "invert",
            "noir",
        ];
        let effects = [
            "none", "blur", "glow", "vhs", "filmnoise", "sharpen", "vignette", "bw", "invert",
            "fade",
        ];
        for (i, f) in filters.iter().enumerate() {
            let out = dir.join(format!("f{i}.mp4"));
            let mut req = request(vec![clip_mau(clip.clone(), 0.0, 3.0)], &out.to_string_lossy(), 320, 180);
            req.filter = Some((*f).to_string());
            xuat_hoac_loi(req);
            kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("bộ lọc {f}"));
        }
        for (i, e) in effects.iter().enumerate() {
            let out = dir.join(format!("e{i}.mp4"));
            let mut req = request(vec![clip_mau(clip.clone(), 0.0, 3.0)], &out.to_string_lossy(), 320, 180);
            req.effect = Some((*e).to_string());
            xuat_hoac_loi(req);
            kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("hiệu ứng {e}"));
        }
    }

    #[test]
    fn lay_duoc_dai_thumbnail_cho_clip() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("thumbs");
        let clip = tao_clip(&dir, "a.mp4", 4, 300);
        let strip = clip_thumbnails(clip, 0.0, 4.0, 4, 32).expect("lấy thumbnail");
        assert!(PathBuf::from(&strip).exists(), "không tạo được dải {strip}");
        // Dải gồm 4 khung nối ngang nên phải rộng hơn chiều cao.
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=width,height"])
            .args(["-of", "csv=p=0", &strip])
            .output()
            .expect("chạy ffprobe");
        let text = String::from_utf8_lossy(&out.stdout);
        let dims: Vec<i64> = text
            .trim()
            .split(',')
            .map(|v| v.parse().unwrap_or(0))
            .collect();
        assert_eq!(dims.get(1).copied(), Some(32), "chiều cao: {text}");
        assert!(
            dims.first().copied().unwrap_or(0) > 32 * 3,
            "dải phải có nhiều khung: {text}"
        );
        let _ = fs::remove_file(&strip);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            export_video,
            save_overlay_image,
            save_project,
            load_project,
            draft_path,
            recent_projects,
            recent_push,
            recent_remove,
            clip_thumbnails,
            probe_media,
            audio_waveform,
            detect_beats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}