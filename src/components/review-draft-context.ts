import { createContext } from 'react'

// App owns the only draft dispatch. Viewers freeze this callback at opening;
// stale target generations reject even if selection later returns to that pane.
export const ReviewDraftContext = createContext<
  ((block: string) => string | null) | null
>(null)
