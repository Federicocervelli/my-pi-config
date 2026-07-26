---
name: quality
description: Simplifies code without changing behavior. Use when the user asks for a quality pass, less duplication, fewer abstractions, standard-library reuse, or a smaller implementation.
---

# Quality pass

Inspect the current diff and surrounding code before editing. Make only high-confidence simplifications that preserve behavior and scope.

Look for:

- duplicated logic or state handling;
- needless abstractions and speculative infrastructure;
- reimplemented standard-library or platform functionality;
- dead code and unnecessarily difficult control flow.

Run the smallest relevant verification after editing. Do not commit or push. If no worthwhile simplification exists, say so instead of refactoring for style.
