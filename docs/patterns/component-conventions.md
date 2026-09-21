# Component Conventions

- Use arrow-function React components and export the public component at the bottom.
- Keep props in an explicit `I...Props` interface.
- Components own rendering and local interaction state; hooks own polling, reconnect, and external lifecycle work.
- Prefer semantic HTML and native buttons/forms before custom interaction shells.
- A visual primitive should be extracted only after repeated use or distinct ownership appears.
