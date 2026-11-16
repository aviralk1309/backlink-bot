"""Run each candidate in a fresh process: uv run --with ... python this.py NAME."""

import json
import resource
import sys
import time
from pathlib import Path

samples = json.loads(
    (Path(__file__).parents[1] / "tests/fixtures/checks/languages.json").read_text()
)
start = time.perf_counter()
if sys.argv[1] == "lingua":
    from lingua import LanguageDetectorBuilder

    detector = LanguageDetectorBuilder.from_all_languages().with_low_accuracy_mode().build()

    def predict(text):
        values = detector.compute_language_confidence_values(text)
        return values[0].language.iso_code_639_1.name.lower(), values[0].value
else:
    from langid.langid import LanguageIdentifier, model

    detector = LanguageIdentifier.from_modelstring(model, norm_probs=True)
    predict = detector.classify
predictions = [predict(s["text"]) for s in samples]
cold = time.perf_counter() - start
start = time.perf_counter()
for _ in range(10):
    for s in samples:
        predict(s["text"])
warm = (time.perf_counter() - start) / (10 * len(samples))
print(
    json.dumps(
        {
            "candidate": sys.argv[1],
            "correct": sum(
                p[0] == s["language"] for p, s in zip(predictions, samples, strict=True)
            ),
            "total": len(samples),
            "cold_seconds": cold,
            "warm_ms_per_text": warm * 1000,
            "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            * (1 if sys.platform == "darwin" else 1024),
            "predictions": [(p[0], float(p[1])) for p in predictions],
        },
        indent=2,
    )
)
