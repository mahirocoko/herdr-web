/** The pictures a work line shows at its end: what its tools returned, in transcript order. */
import type { ConversationPart } from "../../shared/protocol.ts";

type ToolPart = Extract<ConversationPart, { kind: "tool" }>;

export interface WorkImage {
  part: ToolPart;
  ref: string;
  mediaType: string;
  /** 0-based among this tool's own pictures. */
  ordinal: number;
}

/** Maximum pictures beside a work line; touch leaves more room for each target. */
export const LINE_IMAGES_SHOWN = 4;
export const LINE_IMAGES_SHOWN_TOUCH = 3;

/** Every picture the tools among `parts` returned, in the work's order. */
export function workImages(parts: readonly ConversationPart[]): WorkImage[] {
  return parts.flatMap((part) => part.kind !== "tool" || part.images === undefined ? []
    : part.images.map((image, ordinal) => ({ part, ref: image.ref, mediaType: image.media_type, ordinal })));
}

/**
 * Only immutable image refs are fetched before a tool row is opened. Codex and OpenCode refs are
 * served no-store because their backing files/ordinals may change, so those stay in the detail.
 */
const CACHED_IMAGE_REFS = [/^[0-9a-f-]{8,64}:\d{1,3}(?::\d{1,3})?$/i, /^pi:/, /^pi-prompt:/];

export function cachedImageRef(ref: string): boolean {
  return CACHED_IMAGE_REFS.some((pattern) => pattern.test(ref));
}

export function linePictures(parts: readonly ConversationPart[]): WorkImage[] {
  return workImages(parts).filter((image) => cachedImageRef(image.ref));
}

/** Draw the latest `shown` pictures and count any earlier ones for a compact +N tile. */
export function lineImages<T>(images: readonly T[], shown = LINE_IMAGES_SHOWN): { hidden: number; shown: readonly T[] } {
  if (images.length <= shown) return { hidden: 0, shown: images };
  return { hidden: images.length - shown, shown: images.slice(images.length - shown) };
}
