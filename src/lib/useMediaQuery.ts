import { useEffect, useState } from "react";

/**
 * Follows a media query: the layout rules that CSS alone cannot apply. A menu that picks
 * between two forms, or a layout that has to know which side of a breakpoint it is on, reads it
 * here and is re-rendered when the viewport crosses the query.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (): void => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}