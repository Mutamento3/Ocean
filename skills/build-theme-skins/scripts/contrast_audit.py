#!/usr/bin/env python3
"""Calculate WCAG 2.2 contrast for two sRGB hex colors."""

from __future__ import annotations

import argparse
import re


KINDS = {
    "normal-text": (4.5, "normal text"),
    "large-text": (3.0, "large text"),
    "ui": (3.0, "UI state or meaningful graphic"),
    "decorative": (None, "pure decoration"),
}


def parse_hex(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", value.strip())
    if not match:
        raise argparse.ArgumentTypeError(f"invalid color {value!r}; use #RGB or #RRGGBB")
    raw = match.group(1)
    if len(raw) == 3:
        raw = "".join(channel * 2 for channel in raw)
    return tuple(int(raw[index:index + 2], 16) for index in (0, 2, 4))


def linear_channel(channel: int) -> float:
    srgb = channel / 255
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    red, green, blue = (linear_channel(channel) for channel in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(first: tuple[int, int, int], second: tuple[int, int, int]) -> float:
    lighter, darker = sorted((relative_luminance(first), relative_luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a color pair against WCAG 2.2")
    parser.add_argument("foreground", type=parse_hex, help="foreground color, for example #5e6680")
    parser.add_argument("background", type=parse_hex, help="background or adjacent color, for example #fafbff")
    parser.add_argument("--kind", choices=KINDS, default="normal-text", help="object being checked")
    args = parser.parse_args()

    ratio = contrast_ratio(args.foreground, args.background)
    threshold, label = KINDS[args.kind]
    print(f"Object: {label}")
    print(f"Contrast: {ratio:.4f}:1")
    if threshold is None:
        print("Result: no universal WCAG minimum; decoration must not be the only information cue.")
        return 0

    passed = ratio >= threshold
    print(f"Threshold: {threshold:.1f}:1")
    print(f"Result: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
