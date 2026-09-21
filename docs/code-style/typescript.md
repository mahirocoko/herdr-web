# TypeScript

- Keep strict TypeScript enabled.
- Prefix authored interfaces with `I`; keep type aliases unprefixed.
- Prefer explicit discriminated unions at browser/server boundaries.
- Avoid `any`; when external runtime payloads are wider than the local contract, narrow only the fields this app consumes.
- Extract pure validation and selection logic so it can be tested without the browser or Herdr daemon.
