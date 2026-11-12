"""#331 — the image analysis must measure the image, not invent a dimension.

Measured on `develop` before this change: every `ImageAnalysis` returned
`fractal_dimension = 1.65 ± 0.1` drawn from `np.random`, with
`engine_version = "0.1.0-placeholder"`, for each of the seven declared methods —
five of which have no implementation in the engine at all.

The witnesses below are chosen so the placeholder cannot pass them:

- a **filled square** measures 1.85–2.00 with the real engine and 1.65 with the
  placeholder, so the assertion is on the measured value, not on "something came
  back";
- two runs of the **same image** must produce the **same number**, which a random
  value cannot do;
- an unimplemented method must end `failed` **naming itself**, instead of
  answering with a plausible-looking result;
- `threshold_method: "otsu"` used to mean `np.mean` — a threshold that lands in the
  middle of a bimodal image only by luck. The witness separates two modes.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import pytest
from PIL import Image

from apps.fractal_analysis.models import AnalysisStatus, ImageAnalysis
from apps.fractal_analysis.tasks import run_fractal_analysis_task
from apps.projects.models import Project

PLACEHOLDER_VERSION = "0.1.0-placeholder"


@pytest.fixture
def project(db: Any) -> Project:
    return Project.objects.create(name="Image analysis")


def _png(mask: np.ndarray) -> bytes:
    """A binary mask as an 8-bit PNG, which is what the endpoint stores."""
    image = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _square(size: int = 129) -> np.ndarray:
    return np.ones((size, size), dtype=bool)


def _carpet(layers: int = 4) -> np.ndarray:
    """Sierpinski carpet at `layers`: dimension log(8)/log(3) = 1.8928."""
    side = 3**layers
    grid = np.zeros((side, side), dtype=bool)
    for i in range(side):
        for j in range(side):
            x, y = i, j
            keep = True
            for _ in range(layers):
                if x % 3 == 1 and y % 3 == 1:
                    keep = False
                    break
                x //= 3
                y //= 3
            grid[i, j] = keep
    return grid


def _analysis(
    project: Project,
    mask: np.ndarray,
    method: str = "box_counting",
    method_params: dict[str, Any] | None = None,
    preprocess: dict[str, Any] | None = None,
) -> ImageAnalysis:
    return ImageAnalysis.objects.create(
        project=project,
        original_image=_png(mask),
        original_filename="figure.png",
        original_content_type="image/png",
        preprocessing_params=preprocess or {"threshold_method": "otsu"},
        method=method,
        method_params=method_params,
    )


def _run(analysis: ImageAnalysis) -> ImageAnalysis:
    run_fractal_analysis_task(str(analysis.id))
    analysis.refresh_from_db()
    return analysis


# --- The measurement is real -------------------------------------------------


@pytest.mark.django_db
def test_a_filled_square_measures_like_a_square(project: Project) -> None:
    """The placeholder answers 1.65 ± 0.1; a square has to answer ~2."""
    analysis = _run(_analysis(project, _square()))

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    dimension = analysis.results["fractal_dimension"]
    assert abs(dimension - 2.0) < 0.15, (
        f"measured {dimension:.3f} for a filled square; the real box-counting "
        "answers ~1.96 and the placeholder answered 1.65 ± 0.1"
    )
    assert analysis.engine_version != PLACEHOLDER_VERSION
    assert analysis.engine_version != ""


@pytest.mark.django_db
def test_the_carpet_measures_near_its_known_dimension(project: Project) -> None:
    """Sierpinski carpet: log(8)/log(3) = 1.8928, measured 1.798 at 4 layers."""
    analysis = _run(_analysis(project, _carpet(4)))

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    dimension = analysis.results["fractal_dimension"]
    assert abs(dimension - np.log(8) / np.log(3)) < 0.15, (
        f"measured {dimension:.3f}; the known dimension is 1.8928"
    )


@pytest.mark.django_db
def test_the_same_image_measures_the_same_twice(project: Project) -> None:
    """A random result cannot agree with itself."""
    first = _run(_analysis(project, _square(65)))
    second = _run(_analysis(project, _square(65)))

    assert first.results["fractal_dimension"] == second.results["fractal_dimension"]
    assert first.engine_version == second.engine_version


@pytest.mark.django_db
def test_the_result_carries_the_curve_it_was_read_from(project: Project) -> None:
    """The numbers behind the fit are stored, so the value can be audited."""
    analysis = _run(_analysis(project, _carpet(3)))
    results = analysis.results

    assert len(results["log_sizes"]) == len(results["log_counts"]) >= 2
    assert results["r_squared"] >= 0.0
    assert "std_error" in results
    # The fit is a straight line through the points it reports: the stored curve
    # and the stored slope have to agree, or one of them is decoration.
    # The engine stores `ln(1 / box_size)` against `ln(count)`, so the slope of the
    # stored curve IS the dimension — positive, not negative. Asserting the sign
    # (and the agreement) is what stops the payload from being decoration.
    x = np.array(results["log_sizes"], dtype=float)
    y = np.array(results["log_counts"], dtype=float)
    slope = np.float64(np.polyfit(x, y, 1)[0])
    assert slope > 0.0
    assert abs(float(slope) - results["fractal_dimension"]) < 0.5


# --- What is not implemented says so -----------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["sandbox", "correlation", "lacunarity", "multifractal"])
def test_an_unimplemented_method_ends_failed_naming_itself(
    project: Project, method: str
) -> None:
    """Returning a plausible number for a method that does not exist is a lie."""
    analysis = _run(_analysis(project, _square(65), method=method))

    assert analysis.status == AnalysisStatus.FAILED
    assert method in (analysis.error_message or "")
    assert analysis.results is None, (
        "a failed analysis must not keep a fabricated result payload"
    )


@pytest.mark.django_db
def test_box_counting_accepts_a_payload_without_method_params(project: Project) -> None:
    """`method_params` is nullable in the model; `.get` on `None` used to raise."""
    analysis = _run(_analysis(project, _square(65), method_params=None))

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message


@pytest.mark.django_db
def test_the_declared_method_params_are_used(project: Project) -> None:
    """`num_scales` is a knob the caller sets, so it has to reach the engine."""
    analysis = _run(
        _analysis(
            project,
            _square(65),
            method_params={"min_box_size": 2, "max_box_size": 32, "num_scales": 6},
        )
    )

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    assert len(analysis.results["log_sizes"]) <= 6


# --- The threshold is the one that was asked for -----------------------------


@pytest.mark.django_db
def test_otsu_maximises_the_between_class_variance(project: Project) -> None:
    """`threshold_method: "otsu"` used to mean `np.mean`, which is a different rule.

    The witness is the definition, computed here from the histogram by a different
    route than the implementation. The image is deliberately skewed — 95 % of the
    pixels sit in one narrow mode — so the mean falls *inside* the background's
    spread and its cut is genuinely worse than the valley.
    """
    from apps.fractal_analysis.tasks import _otsu_threshold

    rng = np.random.default_rng(11)
    background = rng.normal(30, 4, 9500)
    foreground = rng.normal(200, 4, 500)
    image = np.clip(np.concatenate([background, foreground]), 0, 255).astype(np.uint8)

    hist = np.bincount(image.ravel(), minlength=256).astype(float)
    levels = np.arange(256, dtype=float)

    def between_classes(level: int) -> float:
        below, above = hist[: level + 1], hist[level + 1 :]
        weight_below, weight_above = below.sum(), above.sum()
        if weight_below == 0 or weight_above == 0:
            return -1.0
        mean_below = float((below * levels[: level + 1]).sum()) / weight_below
        mean_above = float((above * levels[level + 1 :]).sum()) / weight_above
        return weight_below * weight_above * (mean_below - mean_above) ** 2

    chosen = _otsu_threshold(image)
    best = max(range(256), key=between_classes)
    mean_cut = int(np.mean(image))

    assert between_classes(chosen) >= between_classes(best) - 1e-9, (
        f"threshold {chosen} does not attain the maximum between-class variance"
    )
    # The valley between the modes is empty, so the between-class variance is flat
    # across it and `argmax` returns its first index. What matters is that the cut
    # separates the two populations: no background above it, no foreground below.
    assert chosen >= int(background.max()), (
        f"threshold {chosen} leaves a background pixel above it "
        f"(max {int(background.max())})"
    )
    assert chosen < int(foreground.min()), (
        f"threshold {chosen} puts a foreground pixel (min {int(foreground.min())}) "
        "in the background"
    )
    # And the mean is inside the background's tail, which is why it is the wrong rule.
    assert mean_cut < chosen, (
        f"the mean ({mean_cut}) landed at or above the valley ({chosen}); "
        "this image cannot tell the two rules apart"
    )
    assert between_classes(chosen) > between_classes(mean_cut), (
        "the mean's split explains less of the variance than Otsu's, as expected — "
        "if they tie, the witness above is the one doing the work"
    )


@pytest.mark.django_db
def test_the_pipeline_binarizes_with_that_cut(project: Project) -> None:
    """The stored processed image is the binary the threshold produced."""
    size = 100
    image = np.full((size, size), 20, dtype=np.uint8)
    image[:, :30] = 220

    analysis = _analysis(project, np.zeros((1, 1), dtype=bool))
    analysis.original_image = _raw_png(image)
    analysis.save(update_fields=["original_image"])
    analysis = _run(analysis)

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    processed = np.array(
        Image.open(io.BytesIO(bytes(analysis.processed_image))).convert("L")
    )
    foreground = processed > 127
    assert foreground[:, :30].mean() == pytest.approx(1.0)
    assert foreground[:, 30:].mean() == pytest.approx(0.0)


def _raw_png(array: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array, mode="L").save(buffer, format="PNG")
    return buffer.getvalue()
