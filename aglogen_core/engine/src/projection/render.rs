//! Dual-mode PNG rendering for 2D projections.
//!
//! Provides presentation (red fill, dark edge, AA, border) and scientific
//! (solid black on white, no AA, no border, no alpha) render modes.
//!
//! Both modes share identical 2D geometry via [`super::compute_2d_bbox`],
//! guaranteeing pixel-dimension and bbox parity.

use image::{ImageBuffer, Rgb, RgbImage, Rgba, RgbaImage};
use std::io::Cursor;

use super::compute_2d_bbox;

/// Result of a dual-mode render operation.
#[derive(Debug, Clone)]
pub struct DualRenderResult {
    /// Presentation PNG bytes (red fill, dark edge, AA, alpha border).
    pub presentation_bytes: Vec<u8>,
    /// Scientific PNG bytes (binary black/white, no AA, no border).
    pub scientific_bytes: Vec<u8>,
    /// Width of the 2D bounding box in engine units.
    pub bbox_width: f64,
    /// Height of the 2D bounding box in engine units.
    pub bbox_height: f64,
}

/// Render a presentation-mode PNG.
///
/// Style: red fill (200,50,50), dark edge stroke (80,20,20), alpha blending,
/// anti-aliased circles, white background. Matches the aglogen3D visual style.
///
/// # Arguments
/// * `coordinates` - 3D particle positions.
/// * `radii` - Particle radii in engine units.
/// * `azimuth_deg` - Viewing azimuth in degrees.
/// * `elevation_deg` - Viewing elevation in degrees.
/// * `img_size` - Square canvas pixel dimension.
///
/// # Returns
/// `(png_bytes, bbox_width, bbox_height)` — the PNG as bytes, and the 2D bbox
/// dimensions in engine units.
#[doc = "Render presentation PNG: red fill, dark edge, AA, alpha border."]
pub fn render_presentation(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_deg: f64,
    elevation_deg: f64,
    img_size: u32,
) -> (Vec<u8>, f64, f64) {
    let bbox = compute_2d_bbox(coordinates, radii, azimuth_deg, elevation_deg);

    if bbox.positions.is_empty() {
        let img: RgbaImage =
            ImageBuffer::from_pixel(img_size, img_size, Rgba([255, 255, 255, 255]));
        let bytes = encode_rgba_png(&img);
        return (bytes, 0.0, 0.0);
    }

    let (pixel_positions, pixel_radii) =
        map_to_pixel_space(&bbox.positions, &bbox.radii, &bbox, img_size);

    let mut img: RgbaImage =
        ImageBuffer::from_pixel(img_size, img_size, Rgba([255, 255, 255, 255]));

    // Draw circles with AA and border
    let fill_color = [200u8, 50, 50, 200]; // red fill with alpha
    let edge_color = [80u8, 20, 20, 255]; // dark edge, opaque

    for (i, &(cx, cy)) in pixel_positions.iter().enumerate() {
        let r = pixel_radii[i];
        // Edge stroke (slightly larger radius)
        draw_circle_aa(&mut img, cx, cy, r + 1.0, edge_color);
        // Fill
        draw_circle_aa(&mut img, cx, cy, r, fill_color);
    }

    let bytes = encode_rgba_png(&img);
    (bytes, bbox.bbox_width, bbox.bbox_height)
}

/// Render a scientific-mode PNG.
///
/// Style: solid black circles on white background, NO anti-aliasing, NO border
/// stroke, NO alpha channel. Post-render binary threshold applied: pixels
/// > 127 → 255, ≤ 127 → 0.
///
/// # Arguments
/// * `coordinates` - 3D particle positions.
/// * `radii` - Particle radii in engine units.
/// * `azimuth_deg` - Viewing azimuth in degrees.
/// * `elevation_deg` - Viewing elevation in degrees.
/// * `img_size` - Square canvas pixel dimension.
///
/// # Returns
/// `(png_bytes, bbox_width, bbox_height)` — the PNG as bytes (RGB, no alpha),
/// and the 2D bbox dimensions in engine units.
#[doc = "Render scientific PNG: binary black/white, no AA, no border, no alpha."]
pub fn render_scientific(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_deg: f64,
    elevation_deg: f64,
    img_size: u32,
) -> (Vec<u8>, f64, f64) {
    let bbox = compute_2d_bbox(coordinates, radii, azimuth_deg, elevation_deg);

    if bbox.positions.is_empty() {
        let img: RgbImage = ImageBuffer::from_pixel(img_size, img_size, Rgb([255, 255, 255]));
        let bytes = encode_rgb_png(&img);
        return (bytes, 0.0, 0.0);
    }

    let (pixel_positions, pixel_radii) =
        map_to_pixel_space(&bbox.positions, &bbox.radii, &bbox, img_size);

    let mut img: RgbImage = ImageBuffer::from_pixel(img_size, img_size, Rgb([255, 255, 255]));

    // Draw solid black circles — no AA, no border
    for (i, &(cx, cy)) in pixel_positions.iter().enumerate() {
        let r = pixel_radii[i];
        draw_circle_solid(&mut img, cx, cy, r);
    }

    // Post-render binary threshold: >127 → 255, ≤127 → 0
    apply_binary_threshold(&mut img);

    let bytes = encode_rgb_png(&img);
    (bytes, bbox.bbox_width, bbox.bbox_height)
}

/// Render both presentation and scientific PNGs in a single call.
///
/// Both modes share the same 2D bbox (computed once), guaranteeing
/// pixel-dimension and geometry parity (spec R3).
///
/// # Arguments
/// * `coordinates` - 3D particle positions.
/// * `radii` - Particle radii in engine units.
/// * `azimuth_deg` - Viewing azimuth in degrees.
/// * `elevation_deg` - Viewing elevation in degrees.
/// * `img_size` - Square canvas pixel dimension.
///
/// # Returns
/// A [`DualRenderResult`] containing both PNG byte vectors and the shared bbox.
#[doc = "Render both presentation and scientific PNGs, returning shared bbox."]
pub fn render_projection_dual(
    coordinates: &[[f64; 3]],
    radii: &[f64],
    azimuth_deg: f64,
    elevation_deg: f64,
    img_size: u32,
) -> DualRenderResult {
    let (pres_bytes, bbox_w, bbox_h) =
        render_presentation(coordinates, radii, azimuth_deg, elevation_deg, img_size);
    let (sci_bytes, _, _) =
        render_scientific(coordinates, radii, azimuth_deg, elevation_deg, img_size);

    DualRenderResult {
        presentation_bytes: pres_bytes,
        scientific_bytes: sci_bytes,
        bbox_width: bbox_w,
        bbox_height: bbox_h,
    }
}

// ── Internal helpers ────────────────────────────────────────────────

/// Map engine-unit positions to pixel coordinates within the image canvas.
///
/// Applies 2% padding per side (1.04 factor on the dominant axis) to match
/// the spec R3 formula.
fn map_to_pixel_space(
    positions: &[(f64, f64)],
    radii: &[f64],
    bbox: &super::Bbox2dResult,
    img_size: u32,
) -> (Vec<(f64, f64)>, Vec<f64>) {
    let span = bbox.bbox_width.max(bbox.bbox_height);
    if span < 1e-15 {
        // Degenerate — all points at same location
        let center = img_size as f64 / 2.0;
        let pixel_positions: Vec<(f64, f64)> = positions.iter().map(|_| (center, center)).collect();
        let pixel_radii: Vec<f64> = radii.iter().map(|_| 1.0).collect();
        return (pixel_positions, pixel_radii);
    }

    let padded_span = span * 1.04; // 2% padding per side
    let scale = img_size as f64 / padded_span;

    // Compute bbox center from particle extents (position ± radius)
    let min_x = positions
        .iter()
        .zip(radii.iter())
        .map(|(p, r)| p.0 - r)
        .fold(f64::INFINITY, f64::min);
    let max_x = positions
        .iter()
        .zip(radii.iter())
        .map(|(p, r)| p.0 + r)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = positions
        .iter()
        .zip(radii.iter())
        .map(|(p, r)| p.1 - r)
        .fold(f64::INFINITY, f64::min);
    let max_y = positions
        .iter()
        .zip(radii.iter())
        .map(|(p, r)| p.1 + r)
        .fold(f64::NEG_INFINITY, f64::max);
    let center_x = (min_x + max_x) / 2.0;
    let center_y = (min_y + max_y) / 2.0;

    let img_center = img_size as f64 / 2.0;

    let pixel_positions: Vec<(f64, f64)> = positions
        .iter()
        .map(|&(x, y)| {
            let px = img_center + (x - center_x) * scale;
            let py = img_center - (y - center_y) * scale; // flip Y for image coords
            (px, py)
        })
        .collect();

    let pixel_radii: Vec<f64> = radii.iter().map(|&r| r * scale).collect();

    (pixel_positions, pixel_radii)
}

/// Draw an anti-aliased filled circle with alpha blending.
fn draw_circle_aa(img: &mut RgbaImage, cx: f64, cy: f64, radius: f64, color: [u8; 4]) {
    let x_min = ((cx - radius - 1.0).floor().max(0.0)) as u32;
    let x_max = ((cx + radius + 1.0).ceil() as u32).min(img.width() - 1);
    let y_min = ((cy - radius - 1.0).floor().max(0.0)) as u32;
    let y_max = ((cy + radius + 1.0).ceil() as u32).min(img.height() - 1);

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let dx = px as f64 + 0.5 - cx;
            let dy = py as f64 + 0.5 - cy;
            let dist2 = dx * dx + dy * dy;
            let dist = dist2.sqrt();

            if dist <= radius - 0.5 {
                // Fully inside — blend at full alpha
                alpha_blend(img, px, py, color);
            } else if dist <= radius + 0.5 {
                // Edge pixel — AA with fractional coverage
                let coverage = (radius + 0.5 - dist).clamp(0.0, 1.0);
                let aa_alpha = (color[3] as f64 * coverage) as u8;
                let aa_color = [color[0], color[1], color[2], aa_alpha];
                alpha_blend(img, px, py, aa_color);
            }
        }
    }
}

/// Draw a solid filled circle with no anti-aliasing.
fn draw_circle_solid(img: &mut RgbImage, cx: f64, cy: f64, radius: f64) {
    let x_min = ((cx - radius).floor().max(0.0)) as u32;
    let x_max = ((cx + radius).ceil() as u32).min(img.width().saturating_sub(1));
    let y_min = ((cy - radius).floor().max(0.0)) as u32;
    let y_max = ((cy + radius).ceil() as u32).min(img.height().saturating_sub(1));

    let r2 = radius * radius;

    for py in y_min..=y_max {
        for px in x_min..=x_max {
            let dx = px as f64 + 0.5 - cx;
            let dy = py as f64 + 0.5 - cy;
            if dx * dx + dy * dy <= r2 {
                img.put_pixel(px, py, Rgb([0, 0, 0]));
            }
        }
    }
}

/// Alpha-blend a color onto an RGBA pixel.
fn alpha_blend(img: &mut RgbaImage, x: u32, y: u32, color: [u8; 4]) {
    let bg = img.get_pixel(x, y);
    let alpha = color[3] as f64 / 255.0;
    let inv_alpha = 1.0 - alpha;

    let r = (color[0] as f64 * alpha + bg[0] as f64 * inv_alpha) as u8;
    let g = (color[1] as f64 * alpha + bg[1] as f64 * inv_alpha) as u8;
    let b = (color[2] as f64 * alpha + bg[2] as f64 * inv_alpha) as u8;
    let a = (color[3] as f64 + bg[3] as f64 * inv_alpha).min(255.0) as u8;

    img.put_pixel(x, y, Rgba([r, g, b, a]));
}

/// Apply binary threshold to an RGB image: pixel > 127 → 255, ≤ 127 → 0.
///
/// No tolerance. Every channel of every pixel becomes exactly 0 or 255.
fn apply_binary_threshold(img: &mut RgbImage) {
    for pixel in img.pixels_mut() {
        for ch in 0..3 {
            pixel[ch] = if pixel[ch] > 127 { 255 } else { 0 };
        }
    }
}

/// Encode an RGBA image as PNG bytes.
fn encode_rgba_png(img: &RgbaImage) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut buf, image::ImageOutputFormat::Png)
        .expect("PNG encoding must not fail");
    buf.into_inner()
}

/// Encode an RGB image as PNG bytes.
fn encode_rgb_png(img: &RgbImage) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img.clone())
        .write_to(&mut buf, image::ImageOutputFormat::Png)
        .expect("PNG encoding must not fail");
    buf.into_inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helper: simple test aggregate ────────────────────────────────
    fn test_coords() -> Vec<[f64; 3]> {
        vec![[0.0, 0.0, 0.0], [3.0, 0.0, 0.0], [0.0, 3.0, 0.0]]
    }

    fn test_radii() -> Vec<f64> {
        vec![1.0, 1.0, 1.0]
    }

    // ── T1.5: Presentation render tests ─────────────────────────────

    #[test]
    fn presentation_returns_valid_png_bytes() {
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, bbox_w, bbox_h) = render_presentation(&coords, &radii, 0.0, 0.0, 128);
        // Must return non-empty PNG bytes
        assert!(
            !png_bytes.is_empty(),
            "presentation PNG bytes must not be empty"
        );
        // PNG magic bytes
        assert_eq!(
            &png_bytes[0..4],
            &[0x89, 0x50, 0x4E, 0x47],
            "must start with PNG magic"
        );
        // bbox must be positive
        assert!(bbox_w > 0.0, "bbox_w must be positive");
        assert!(bbox_h > 0.0, "bbox_h must be positive");
    }

    #[test]
    fn presentation_has_red_pixels() {
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, _, _) = render_presentation(&coords, &radii, 0.0, 0.0, 128);

        // Decode the PNG and check for red pixels
        let img = image::load_from_memory(&png_bytes).expect("must decode PNG");
        let rgba = img.to_rgba8();
        let has_red = rgba
            .pixels()
            .any(|p| p[0] > 100 && p[1] < 100 && p[2] < 100);
        assert!(
            has_red,
            "presentation PNG must contain red-ish pixels (R>100, G<100, B<100)"
        );
    }

    #[test]
    fn presentation_has_non_binary_pixels_in_border_region() {
        // Spec R1.2: AA means intermediate pixel values exist
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, _, _) = render_presentation(&coords, &radii, 0.0, 0.0, 256);

        let img = image::load_from_memory(&png_bytes).expect("must decode PNG");
        let rgba = img.to_rgba8();
        // There should be at least one pixel with a channel value strictly between 1 and 254
        // (evidence of anti-aliasing or alpha blending)
        let has_intermediate = rgba.pixels().any(|p| {
            (p[3] > 0 && p[3] < 255) // alpha blending
                || (p[0] > 0 && p[0] < 255 && p[1] > 0 && p[1] < 255) // intermediate color
        });
        assert!(
            has_intermediate,
            "presentation PNG must have non-binary pixels (AA/alpha evidence)"
        );
    }

    // ── T1.1: Scientific render tests ───────────────────────────────

    #[test]
    fn scientific_returns_valid_png_bytes() {
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, bbox_w, bbox_h) = render_scientific(&coords, &radii, 0.0, 0.0, 128);
        assert!(!png_bytes.is_empty());
        assert_eq!(&png_bytes[0..4], &[0x89, 0x50, 0x4E, 0x47]);
        assert!(bbox_w > 0.0);
        assert!(bbox_h > 0.0);
    }

    #[test]
    fn scientific_has_black_pixels() {
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, _, _) = render_scientific(&coords, &radii, 0.0, 0.0, 128);

        let img = image::load_from_memory(&png_bytes).expect("must decode PNG");
        let rgb = img.to_rgb8();
        let has_black = rgb.pixels().any(|p| p[0] == 0 && p[1] == 0 && p[2] == 0);
        assert!(
            has_black,
            "scientific PNG must contain black pixels (particles)"
        );
    }

    // ── T1.2: Binary threshold test ─────────────────────────────────

    #[test]
    fn scientific_is_strictly_binary() {
        // Spec R2.1: every pixel must be 0 or 255, no intermediate values
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, _, _) = render_scientific(&coords, &radii, 0.0, 0.0, 256);

        let img = image::load_from_memory(&png_bytes).expect("must decode PNG");
        let rgb = img.to_rgb8();
        for (x, y, p) in rgb.enumerate_pixels() {
            for ch in 0..3 {
                assert!(
                    p[ch] == 0 || p[ch] == 255,
                    "scientific PNG pixel ({x},{y}) channel {ch} has non-binary value {}: \
                     must be exactly 0 or 255",
                    p[ch]
                );
            }
        }
    }

    #[test]
    fn scientific_has_no_alpha_channel() {
        // Spec R2.1: PNG mode must be RGB, not RGBA
        let coords = test_coords();
        let radii = test_radii();
        let (png_bytes, _, _) = render_scientific(&coords, &radii, 0.0, 0.0, 128);

        let img = image::load_from_memory(&png_bytes).expect("must decode PNG");
        // to_rgb8 always works, but the raw format should be RGB
        // We check by trying to decode as RGBA and ensuring it's not natively RGBA
        use image::DynamicImage;
        match img {
            DynamicImage::ImageRgb8(_) => {} // good
            other => {
                // If it's RGBA, that's a violation. If it's another format, also wrong.
                // But image crate may decode PNG as Rgba8 regardless of source channels.
                // So we check the raw PNG color type instead.
                // For simplicity: verify all alpha values are 255 (fully opaque)
                let rgba = other.to_rgba8();
                assert!(
                    rgba.pixels().all(|p| p[3] == 255),
                    "scientific PNG must have no transparency (all alpha = 255)"
                );
            }
        }
    }

    // ── T1.3 already tested in mod.rs ───────────────────────────────

    // ── R3: Bbox parity (presentation == scientific) ────────────────

    #[test]
    fn dual_render_bbox_parity() {
        // Spec R3: both modes must report identical bbox
        let coords = test_coords();
        let radii = test_radii();
        let (_, pres_w, pres_h) = render_presentation(&coords, &radii, 45.0, 30.0, 256);
        let (_, sci_w, sci_h) = render_scientific(&coords, &radii, 45.0, 30.0, 256);
        assert!(
            (pres_w - sci_w).abs() < 1e-10,
            "bbox_w parity: pres={pres_w}, sci={sci_w}"
        );
        assert!(
            (pres_h - sci_h).abs() < 1e-10,
            "bbox_h parity: pres={pres_h}, sci={sci_h}"
        );
    }

    // ── T1.4: Dual render public API ────────────────────────────────

    #[test]
    fn dual_render_returns_both_pngs_and_shared_bbox() {
        let coords = test_coords();
        let radii = test_radii();
        let result = render_projection_dual(&coords, &radii, 0.0, 0.0, 128);
        assert!(!result.presentation_bytes.is_empty());
        assert!(!result.scientific_bytes.is_empty());
        assert!(result.bbox_width > 0.0);
        assert!(result.bbox_height > 0.0);
    }

    #[test]
    fn dual_render_same_bbox_for_both() {
        // Call dual render and verify the returned bbox matches both individual renders
        let coords = test_coords();
        let radii = test_radii();
        let dual = render_projection_dual(&coords, &radii, 30.0, 15.0, 128);
        let (_, pres_w, pres_h) = render_presentation(&coords, &radii, 30.0, 15.0, 128);
        assert!(
            (dual.bbox_width - pres_w).abs() < 1e-10,
            "dual bbox_w must match presentation bbox_w"
        );
        assert!(
            (dual.bbox_height - pres_h).abs() < 1e-10,
            "dual bbox_h must match presentation bbox_h"
        );
    }

    // ── Edge cases ──────────────────────────────────────────────────

    #[test]
    fn single_particle_renders_correctly() {
        let coords = vec![[0.0, 0.0, 0.0]];
        let radii = vec![1.0];
        let result = render_projection_dual(&coords, &radii, 0.0, 0.0, 64);
        assert!(!result.presentation_bytes.is_empty());
        assert!(!result.scientific_bytes.is_empty());
        assert!(result.bbox_width > 0.0);
        assert!(result.bbox_height > 0.0);
    }

    #[test]
    fn particles_at_bbox_corners() {
        // Particles placed at extreme corners of the projection
        let coords = vec![
            [-5.0, -5.0, 0.0],
            [5.0, -5.0, 0.0],
            [-5.0, 5.0, 0.0],
            [5.0, 5.0, 0.0],
        ];
        let radii = vec![0.5, 0.5, 0.5, 0.5];
        let result = render_projection_dual(&coords, &radii, 0.0, 90.0, 128);
        assert!(!result.presentation_bytes.is_empty());
        assert!(!result.scientific_bytes.is_empty());

        // Scientific must still be binary
        let img = image::load_from_memory(&result.scientific_bytes).expect("decode");
        let rgb = img.to_rgb8();
        for (x, y, p) in rgb.enumerate_pixels() {
            for ch in 0..3 {
                assert!(
                    p[ch] == 0 || p[ch] == 255,
                    "corner-case scientific pixel ({x},{y}) ch {ch} = {} (non-binary)",
                    p[ch]
                );
            }
        }
    }
}
