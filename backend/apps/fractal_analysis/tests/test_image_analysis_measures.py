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
    assert analysis.results is not None
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
    assert analysis.results is not None
    assert analysis.results is not None
    dimension = analysis.results["fractal_dimension"]
    assert abs(dimension - np.log(8) / np.log(3)) < 0.15, (
        f"measured {dimension:.3f}; the known dimension is 1.8928"
    )


@pytest.mark.django_db
def test_the_same_image_measures_the_same_twice(project: Project) -> None:
    """A random result cannot agree with itself."""
    first = _run(_analysis(project, _square(65)))
    second = _run(_analysis(project, _square(65)))

    assert first.results is not None and second.results is not None
    assert first.results["fractal_dimension"] == second.results["fractal_dimension"]
    assert first.engine_version == second.engine_version


@pytest.mark.django_db
def test_the_result_carries_the_curve_it_was_read_from(project: Project) -> None:
    """The numbers behind the fit are stored, so the value can be audited."""
    analysis = _run(_analysis(project, _carpet(3)))
    results: dict[str, Any] = analysis.results or {}

    dimension = results["fractal_dimension"]
    standard_error = results["std_error"]

    assert len(results["log_sizes"]) == len(results["log_counts"]) >= 3
    assert len(results["residuals"]) == len(results["log_sizes"])
    # The engine stores `ln(1 / box_size)` against `ln(count)`, so the slope of the
    # stored curve IS the dimension. Exact, not "within half a unit": a payload with
    # its vectors mis-paired would still pass a wide band.
    x = np.asarray(results["log_sizes"], dtype=np.float64)
    y = np.asarray(results["log_counts"], dtype=np.float64)
    slope = float(np.polyfit(x, y, 1)[0])
    assert slope == pytest.approx(dimension, abs=1e-9)
    assert dimension > 0.0
    # And the interval is the one the slope and its error imply.
    low, high = results["confidence_interval_95"]
    assert low == pytest.approx(dimension - 1.96 * standard_error, abs=1e-9)
    assert high == pytest.approx(dimension + 1.96 * standard_error, abs=1e-9)


# --- What is not implemented says so -----------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("sandbox", "not implemented yet"),
        ("correlation", "not implemented yet"),
        ("lacunarity", "not implemented yet"),
        ("multifractal", "not implemented yet"),
        # The two FRAKTAL models *are* implemented — in the sibling pipeline.
        # Saying "not implemented" about them would be false about the code.
        ("fraktal_granulated_2012", "FRAKTAL analysis pipeline"),
        ("fraktal_voxel_2018", "FRAKTAL analysis pipeline"),
    ],
)
def test_an_unimplemented_method_ends_failed_naming_itself(
    project: Project, method: str, expected: str
) -> None:
    """Returning a plausible number for a method that does not exist is a lie."""
    analysis = _run(_analysis(project, _square(65), method=method))

    assert analysis.status == AnalysisStatus.FAILED
    message = analysis.error_message or ""
    assert method in message
    assert expected in message
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
    params_result: dict[str, Any] = analysis.results or {}
    # `<= 6` alone would pass with zero scales, which is the failure the guard
    # exists for: the payload has to carry a curve the fit could be read from.
    assert 3 <= len(params_result["log_sizes"]) <= 6


# --- The threshold is the one that was asked for -----------------------------


@pytest.mark.django_db
def test_otsu_maximises_the_between_class_variance(project: Project) -> None:
    """`threshold_method: "otsu"` used to mean `np.mean`, which is a different rule.

    The image is deliberately skewed — 95 % of the pixels sit in one narrow mode —
    so the mean falls *inside* the background's spread and its cut is genuinely
    worse than the valley. What this separates is `np.mean`: it does **not**
    distinguish Otsu from any other rule that lands in the empty valley, which is
    why the assertions that compare against the mean are the discriminating ones.
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
        return float(weight_below * weight_above * (mean_below - mean_above) ** 2)

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
    assert analysis.processed_image is not None
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

# --- An image with nothing in it is not a measurement -------------------------


@pytest.mark.django_db
def test_a_blank_image_fails_instead_of_reporting_zero(project: Project) -> None:
    """An all-dark upload used to store `fractal_dimension: 0.0, status: completed`.

    The engine's fit answers `(0.0, 0.0, ...)` when no scale had any occupied box,
    so the row looked like a successful measurement of nothing.
    """
    analysis = _run(_analysis(project, np.zeros((64, 64), dtype=bool)))

    assert analysis.status == AnalysisStatus.FAILED
    assert "no foreground pixels" in (analysis.error_message or "")
    assert analysis.results is None


@pytest.mark.django_db
def test_invert_counts_a_dark_object_on_a_light_background(project: Project) -> None:
    """`invert` is what makes a dark-on-light micrograph measurable.

    Without it, `img > threshold` marks the background as foreground — 3996 pixels
    instead of the 100 that are the object.
    """
    image = np.full((64, 64), 220, dtype=np.uint8)
    image[20:30, 20:30] = 20  # the object is dark, the background is light

    analysis = _analysis(
        project,
        np.zeros((1, 1), dtype=bool),
        preprocess={"threshold_method": "otsu", "invert": True},
    )
    analysis.original_image = _raw_png(image)
    analysis.save(update_fields=["original_image"])
    analysis = _run(analysis)

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    assert analysis.processed_image is not None
    processed = np.array(
        Image.open(io.BytesIO(bytes(analysis.processed_image))).convert("L")
    )
    assert (processed > 127).sum() == 100, "the object, not the background"


@pytest.mark.django_db
def test_invert_without_it_measures_the_background(project: Project) -> None:
    """The contrast case: the same image, no invert, yields the other mask."""
    image = np.full((64, 64), 220, dtype=np.uint8)
    image[20:30, 20:30] = 20

    analysis = _analysis(
        project, np.zeros((1, 1), dtype=bool), preprocess={"threshold_method": "otsu"}
    )
    analysis.original_image = _raw_png(image)
    analysis.save(update_fields=["original_image"])
    analysis = _run(analysis)

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    assert analysis.processed_image is not None
    processed = np.array(
        Image.open(io.BytesIO(bytes(analysis.processed_image))).convert("L")
    )
    assert (processed > 127).sum() == 64 * 64 - 100


@pytest.mark.django_db
def test_a_manual_threshold_is_used_as_given(project: Project) -> None:
    """`threshold_method: "manual"` must not fall back to Otsu."""
    mask = np.zeros((60, 60), dtype=bool)
    mask[:10, :] = True
    analysis = _run(
        _analysis(
            project,
            mask,
            preprocess={"threshold_method": "manual", "threshold_value": 200},
        )
    )

    assert analysis.status == AnalysisStatus.COMPLETED, analysis.error_message
    assert analysis.processed_image is not None
    processed = np.array(
        Image.open(io.BytesIO(bytes(analysis.processed_image))).convert("L")
    )
    assert (processed > 127).sum() == mask.sum()


@pytest.mark.django_db
def test_an_unknown_threshold_method_names_itself(project: Project) -> None:
    """`adaptive` is documented but never implemented; now it says so."""
    analysis = _run(
        _analysis(project, _square(64), preprocess={"threshold_method": "adaptive"})
    )

    assert analysis.status == AnalysisStatus.FAILED
    assert "adaptive" in (analysis.error_message or "")


@pytest.mark.django_db
def test_the_engine_version_is_the_one_that_ran(project: Project) -> None:
    """The version comes from the loaded cdylib, and fits the model's 20 chars."""
    import aglogen_core

    analysis = _run(_analysis(project, _square(64)))

    assert analysis.engine_version == aglogen_core.version()[:20]
    assert len(analysis.engine_version) <= 20


# --- What the engine must never be asked ------------------------------------


@pytest.mark.django_db
def test_a_zero_box_size_fails_instead_of_panicking_the_engine(project: Project) -> None:
    """`min_box_size: 0` divides by zero inside Rust, and a panic is not an Exception.

    `PanicException` derives from `BaseException`, so the handler would not catch it
    and the row would stay `running` forever — the #232 class, reached through a
    free-form `method_params`. The guard turns it into a refusal before the call.
    """
    analysis = _run(
        _analysis(
            project,
            _square(64),
            method_params={"min_box_size": 0, "max_box_size": 32, "num_scales": 8},
        )
    )

    assert analysis.status == AnalysisStatus.FAILED
    assert "min_box_size" in (analysis.error_message or "")
    assert analysis.results is None


@pytest.mark.django_db
def test_an_inverted_window_fails_naming_it(project: Project) -> None:
    analysis = _run(
        _analysis(
            project,
            _square(64),
            method_params={"min_box_size": 32, "max_box_size": 8},
        )
    )

    assert analysis.status == AnalysisStatus.FAILED
    assert "max_box_size" in (analysis.error_message or "")


@pytest.mark.django_db
def test_a_single_scale_fails(project: Project) -> None:
    """One scale cannot make a slope, and the engine answers zeros for it."""
    analysis = _run(_analysis(project, _square(64), method_params={"num_scales": 1}))

    assert analysis.status == AnalysisStatus.FAILED
    assert "num_scales" in (analysis.error_message or "")


@pytest.mark.django_db
def test_a_failed_rerun_clears_the_previous_payload(project: Project) -> None:
    """A placeholder-era row must not keep its fabricated number through a re-run."""
    analysis = _analysis(project, _square(64))
    analysis.results = {
        "fractal_dimension": 1.65,
        "r_squared": 0.9987,
        "std_error": 0.012,
        "confidence_interval_95": [1.626, 1.674],
        "log_sizes": [0.5, 1.0],
        "log_counts": [10.0, 9.0],
        "residuals": [0.0, 0.0],
    }
    analysis.engine_version = "0.1.0-placeholder"
    analysis.save()

    analysis.method = "sandbox"  # a method that cannot run
    analysis.save(update_fields=["method"])
    analysis = _run(analysis)

    assert analysis.status == AnalysisStatus.FAILED
    assert analysis.results is None, (
        "the fabricated payload survived the failure, and the API exposes results "
        "without looking at the status"
    )
