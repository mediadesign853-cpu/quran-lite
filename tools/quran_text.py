"""Text normalization helpers for rebuilding Quran data.

The output normalizer is intentionally conservative: it only normalizes
whitespace and must never remove Arabic harakat or Quranic annotation marks.
The comparison normalizer may ignore marks when checking orthographic identity,
but must never be used to produce stored Quran text.
"""

from __future__ import annotations

import re

_WHITESPACE_RE = re.compile(r"\s+")
_COMPARISON_MARKS_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u0640]")


def normalize_quran_text(value: str) -> str:
    """Normalize whitespace only; preserve all Arabic/Quranic characters."""
    if not isinstance(value, str):
        raise TypeError("Quran text must be a string")
    return _WHITESPACE_RE.sub(" ", value).strip()


def normalize_for_comparison(value: str) -> str:
    """Return a comparison-only form that ignores selected Arabic marks."""
    if not isinstance(value, str):
        raise TypeError("Quran text must be a string")
    value = _COMPARISON_MARKS_RE.sub("", value)
    value = value.replace("ٱ", "ا").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    return normalize_quran_text(value)
