import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit
WORKER_ROOT = Path(__file__).parents[2]
FIXTURES = Path(__file__).parents[1] / "fixtures"


def test_offline_labelled_corpus_has_40_pages_and_reports_precision_at_50() -> None:
    assert len(list((FIXTURES / "checks").glob("*.html"))) >= 40
    assert (FIXTURES / "checks/huge_response_01.html").stat().st_size > 2 * 1024 * 1024
    result = subprocess.run(
        [
            sys.executable,
            str(WORKER_ROOT / "scripts/calibrate_checks.py"),
            str(FIXTURES / "calibration.csv"),
        ],
        cwd=WORKER_ROOT,
        capture_output=True,
        check=True,
        text=True,
        timeout=30,
    )
    assert "Fixtures evaluated: 40" in result.stdout
    assert "Auto-filtered: 17" in result.stdout
    assert "Ranked: 23" in result.stdout
    assert "Precision@50: 0.739 (17/23; top 23)" in result.stdout
