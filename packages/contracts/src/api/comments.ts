import type { OkResponse } from '../common.js';

export type PreviewCommentStatus =
  | 'open'
  | 'attached'
  | 'applying'
  | 'needs_review'
  | 'resolved'
  | 'failed';

export interface PreviewCommentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewAnnotationStyle {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  textAlign?: string;
  fontFamily?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  borderRadius?: string;
}

export type PreviewCommentSelectionKind = 'element' | 'pod';
export type PreviewVisualMarkKind = 'click' | 'stroke' | 'click+stroke';

/**
 * Comment anchor state.
 * Resolved each render from the live DOM — this is an anchor state, not a
 * processing state. Ladder (strong → weak): exact selector/xpath hit →
 * `anchored`; content changed but re-found via htmlHint → `reanchored`
 * (shows a "based on older v{anchoredVersion}" badge); fuzzy match on
 * selector + htmlHint + position → `stale` (dashed warning); nothing found →
 * `lost` (ghost pin at `lastGoodPosition` + explicit "anchor lost" badge).
 * The explicit `stale`/`lost` marking is load-bearing: with no injected id,
 * drift must be surfaced, never silently mis-pointed.
 */
export type PreviewCommentAnchorState =
  | 'anchored'
  | 'reanchored'
  | 'stale'
  | 'lost';

/**
 * An image attached to a preview comment. `path` is the project-relative file
 * path (uploaded via the normal file API) that the web app resolves to a raw
 * URL for display; `name` is the original filename for labels/alt text.
 */
export interface PreviewCommentAttachment {
  path: string;
  name: string;
}

export interface PreviewCommentMember {
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewCommentPosition;
  htmlHint: string;
  style?: PreviewAnnotationStyle;
}

export interface PreviewCommentTarget {
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewCommentPosition;
  htmlHint: string;
  style?: PreviewAnnotationStyle;
  selectionKind?: PreviewCommentSelectionKind;
  memberCount?: number;
  podMembers?: PreviewCommentMember[];
  /** Zero-based deck slide index when the comment was placed. */
  slideIndex?: number;
  /** Content version this anchor was captured against. */
  anchoredVersion?: number;
}

export interface PreviewComment {
  id: string;
  projectId: string;
  conversationId: string;
  filePath: string;
  elementId: string;
  selector: string;
  label: string;
  text: string;
  position: PreviewCommentPosition;
  htmlHint: string;
  style?: PreviewAnnotationStyle;
  selectionKind?: PreviewCommentSelectionKind;
  memberCount?: number;
  podMembers?: PreviewCommentMember[];
  /** Zero-based deck slide index when the comment was placed. */
  slideIndex?: number;
  note: string;
  attachments?: PreviewCommentAttachment[];
  status: PreviewCommentStatus;
  createdAt: number;
  updatedAt: number;
  /**
   * Permanent canvas pin number within (projectId, filePath). Assigned on
   * creation and never rewritten by an edit. Optional so legacy rows fall back
   * to a client-computed creation-order index.
   */
  pinSeq?: number;
  /**
   * Persisted sidebar display-order key (higher sorts first; default sort is
   * descending so a fresh comment — with the largest key — shows at the top).
   * Purely a local display preference. Rewritten only by an explicit
   * drag-reorder (see the `/reorder` route);
   * absent on legacy rows, which fall back to sorting by `createdAt`.
   */
  sortKey?: number;
  /** Last-known result from resolving the comment target in the rendered file. */
  anchorState?: PreviewCommentAnchorState;
  /** Content version the comment was anchored to; drives the "based on older vN" badge. */
  anchoredVersion?: number;
  /**
   * Bbox written back on each successful anchor. The `lost` ghost pin renders
   * here (last known-good position), NOT the creation-time `position`, which
   * may point somewhere unrelated after the author restructures the HTML.
   */
  lastGoodPosition?: PreviewCommentPosition;
}

export interface PreviewCommentUpsertRequest {
  /**
   * Existing comment id when editing a comment. Omit to create a new comment,
   * even if the same author comments on the same element again.
   */
  id?: string;
  target: PreviewCommentTarget;
  note: string;
  attachments?: PreviewCommentAttachment[];
}

/**
 * Drift-ladder write-back. The anchoring engine reports where a comment
 * resolved so the state persists across sessions.
 */
export interface PreviewCommentAnchorUpdateRequest {
  anchorState: PreviewCommentAnchorState;
  /** Written back on a successful (anchored/reanchored) resolve; the `lost` ghost pin renders here. */
  lastGoodPosition?: PreviewCommentPosition;
  /** Optional: refresh the anchored content version. */
  anchoredVersion?: number;
}

export interface PreviewCommentStatusRequest {
  status: PreviewCommentStatus;
}

/**
 * PATCH .../comments/:commentId/reorder request. The client computes the
 * target `sortKey` itself (a midpoint between the dragged item's new
 * neighbors, or one past the current max/min at either end) and this route
 * simply persists it for the one dragged comment — no server-side move
 * semantics, no rewrite of any other row's `sortKey`.
 */
export interface PreviewCommentReorderRequest {
  sortKey: number;
}

export interface PreviewCommentResponse {
  comment: PreviewComment;
}

export interface PreviewCommentsResponse {
  comments: PreviewComment[];
}

export interface PreviewCommentDeleteResponse extends OkResponse {}
