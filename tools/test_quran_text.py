"""Regression tests: Quran text generation must preserve harakat and signs."""

import unittest
from pathlib import Path
import unicodedata

from quran_text import normalize_for_comparison, normalize_quran_text


class QuranTextNormalizationTests(unittest.TestCase):
    def test_preserves_harakat_and_quranic_marks(self):
        source = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ۞ ۚ ۖ ۗ ۝"
        result = normalize_quran_text(source)
        self.assertEqual(result, source)
        count_marks = lambda value: sum(  # noqa: E731 - compact test helper
            1 for char in value if unicodedata.category(char).startswith("M")
        )
        self.assertEqual(count_marks(result), count_marks(source))

    def test_preserves_tatweel_and_combining_marks(self):
        source = "اللَّـهُ"
        self.assertEqual(normalize_quran_text(source), source)

    def test_only_normalizes_whitespace_in_output_text(self):
        source = "  بِسْمِ   اللَّهِ\nالرَّحْمَٰنِ  "
        expected = "بِسْمِ اللَّهِ الرَّحْمَٰنِ"
        self.assertEqual(normalize_quran_text(source), expected)

    def test_comparison_normalization_does_not_change_output_normalizer(self):
        marked = "بِسْمِ اللَّهِ"
        plain = "بسم الله"
        self.assertEqual(normalize_for_comparison(marked), normalize_for_comparison(plain))
        self.assertEqual(normalize_quran_text(marked), marked)

    def test_builder_uses_the_mark_preserving_normalizer_for_written_text(self):
        builder = Path(__file__).with_name("build_data.py").read_text(encoding="utf-8")
        self.assertIn("T[k] = normalize_quran_text(v)", builder)
        self.assertIn("normalize_for_comparison(x)", builder)

    def test_rejects_non_string_input(self):
        with self.assertRaises(TypeError):
            normalize_quran_text(None)  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
