#!/usr/bin/env python3
"""lottie2rc — convert Lottie (bodymovin) JSON to RemoteCompose .rc.

The implementation lives in the `lottierc` package next to this file (wire, props, shapes,
tracks, text, convert); this module re-exports it so `import lottie2rc`, `lottie2rc.py file.json`
and the validation scripts keep working unchanged.
"""
import sys

from lottierc import *          # noqa: F401,F403
from lottierc.convert import main

if __name__ == '__main__':
    sys.exit(main())
