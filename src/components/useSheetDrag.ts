"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
  type RefObject,
} from "react";

/**
 * Drag-to-dismiss for the bottom sheets, plus the Escape key that goes with it.
 *
 * Every sheet draws a `.sheet-handle` bar that used to be pure decoration:
 * users read it as a grab handle and pulled, and nothing happened. This wires
 * it up.
 *
 * Why Pointer Events and not touch handlers: HabitFlow runs as a Telegram Mini
 * App, and on Telegram *Web* `window.Telegram` is never injected — those users
 * are in a browser, with a mouse. The older touch-only swipes elsewhere in the
 * app (MyDayView / TasksView rows) never fire for them, which makes a
 * gesture-only affordance unreachable for a real share of the audience. One
 * pointer stream covers mouse, touch and pen identically.
 *
 * The drag starts on the `.sheet-handle` and nowhere else. The body of every
 * sheet carries `max-height: 85dvh; overflow-y: auto`, so a drag that began
 * there would race that scroll — and under a mouse it would fight the text
 * selection the forms need. The handle is the one strip of the sheet with no
 * other job, which is exactly why the UI already draws it.
 */

/**
 * Vertical travel that turns a press into a drag. Below it the gesture is
 * treated as a tap, so brushing the handle on the way to a button does not
 * nudge the sheet.
 */
const DRAG_START_PX = 8;

/**
 * A quick throw dismisses without travelling the full distance, which is how
 * sheets are dismissed everywhere else. Both halves are required: the 32px so
 * a twitch cannot fire it, and the speed so a plain drag-and-release is not
 * mistaken for a throw. 1px/ms is 1000px/s, roughly 150mm/s on a phone — a
 * measured release rather than a flick, which is several times faster. An
 * unhurried drag decelerates well below it before the finger comes up.
 */
const FLICK_MIN_PX = 32;
const FLICK_MIN_VELOCITY = 1; // px/ms

/**
 * Dismiss distance: 30% of the sheet, capped at 120px.
 *
 * The percentage is what keeps the gesture proportional — FocusPicker is only a
 * few rows tall, and a flat 120px there would be most of the sheet. The cap is
 * for the other end: a tall sheet is up to 85dvh, so 30% of it is a 180px drag
 * on a phone, which is a lot of hand travel for a gesture meant to be casual.
 * 120px is roughly one comfortable thumb sweep, and still far enough that it
 * cannot be reached by accident.
 */
const DISMISS_FRACTION = 0.3;
const DISMISS_MAX_PX = 120;

/** Longest snap-back. Skipped entirely under prefers-reduced-motion. */
const SNAP_MS = 200;

/**
 * The transform the sheet rests at. The hook owns every write to it: React
 * renders this value once (see dragStyle), and the drag writes pixels straight
 * onto the node.
 */
const REST_TRANSFORM = "translateY(0px)";

/** Module-level so its identity never changes and React never re-writes it. */
const DRAG_STYLE: CSSProperties = { transform: REST_TRANSFORM };

/**
 * Inline styles for the handle itself.
 *
 * `touchAction: none` is load-bearing, not cosmetic: the handle sits inside a
 * scrollable sheet, so without it the browser claims a touch drag for scrolling
 * and answers our first pointermove with pointercancel. It is set on the handle
 * only — the body has to keep scrolling normally.
 */
const HANDLE_STYLE: CSSProperties = {
  touchAction: "none",
  // The only cue a mouse user gets that the bar does anything.
  cursor: "grab",
  // A mouse drag across the sheet would otherwise start selecting its text.
  userSelect: "none",
  WebkitUserSelect: "none",
};

export interface SheetDragOptions {
  open: boolean;
  onClose: () => void;
}

export interface SheetDrag {
  /** Attach to the `.bottom-sheet` element. */
  sheetRef: RefObject<HTMLDivElement | null>;
  /** Attach to the same element's `style`. */
  dragStyle: CSSProperties;
  /** Spread onto `.sheet-handle`. */
  handleProps: {
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
    onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
    style: CSSProperties;
  };
}

/** Live gesture state. A ref, not state: none of it should re-render anything. */
interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  lastY: number;
  lastT: number;
  /** px/ms over the last move, sign follows the Y axis. */
  velocity: number;
  /** How far the sheet has been pulled down, in px. */
  offset: number;
  /** Set once the gesture has been committed to a sheet drag. */
  active: boolean;
  /** Set when the gesture was claimed by a different axis — see onPointerMove. */
  rejected: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useSheetDrag({ open, onClose }: SheetDragOptions): SheetDrag {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);

  /**
   * A sheet must never come back up half-dragged, so every style the drag wrote
   * is cleared whenever `open` changes. The sheets that unmount their body when
   * closed would be safe anyway, but CreateModal keeps one node across its
   * steps and this is the invariant that keeps that honest.
   */
  useEffect(() => {
    // Cleared before the node check, and unconditionally: a sheet that closed
    // mid-drag (Escape, a parent unmounting it) leaves a gesture behind, and a
    // stale one would trip the "already dragging" guard in onPointerDown —
    // killing the handle for every later open of that same sheet.
    gesture.current = null;

    const node = sheetRef.current;
    if (!node) return;
    node.style.transform = REST_TRANSFORM;
    node.style.transition = "";
    node.style.willChange = "";
    node.style.animation = "";
    node.style.cursor = "";
  }, [open]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Left button / touch / pen only. A right-click is a context menu.
    if (event.button !== 0) return;
    // A second finger landing mid-drag must not hijack the gesture.
    if (gesture.current) return;
    if (!sheetRef.current) return;

    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      offset: 0,
      active: false,
      rejected: false,
    };

    // Without capture the stream dies the moment the pointer leaves the 5px
    // handle, which is exactly what a fast drag or a mouse pointer does — the
    // sheet would freeze mid-pull and then snap back.
    event.currentTarget.setPointerCapture(event.pointerId);
    // Keeps a mouse drag from selecting the sheet's text as a side effect.
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = gesture.current;
      if (!state || event.pointerId !== state.pointerId) return;

      const node = sheetRef.current;
      if (!node) return;

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;

      if (!state.active) {
        if (state.rejected) return;
        // Axis lock. Whichever axis first passes the commit distance decides
        // what the gesture is: a mostly-horizontal move is a text selection or
        // a scroll attempt, and once rejected it stays rejected, so a later
        // wiggle downwards cannot turn it into a dismissal.
        if (Math.abs(dx) > DRAG_START_PX && Math.abs(dx) >= Math.abs(dy)) {
          state.rejected = true;
          return;
        }
        // Upward movement never starts a drag. The sheet is anchored to the
        // bottom edge of the viewport with nothing above it to reveal, so
        // pulling it up would only tear a gap underneath.
        if (dy < DRAG_START_PX) return;

        state.active = true;
        // The entrance animation (slideUp, 250ms) outranks inline styles for
        // its duration, so a drag started right after opening would look frozen
        // without this. Dropping it lands the sheet on the transform below.
        node.style.animation = "none";
        // Promote to its own layer for the duration of the drag, then release.
        node.style.willChange = "transform";
        // No easing while the pointer is down: the sheet has to sit exactly
        // under it, and a transition would leave it lagging behind.
        node.style.transition = "none";
        // Mouse users get the closed-hand cursor while they are actually
        // pulling, which is the only feedback a drag on a bar this thin gives.
        node.style.cursor = "grabbing";
      }

      const dt = event.timeStamp - state.lastT;
      if (dt > 0) state.velocity = (event.clientY - state.lastY) / dt;
      state.lastY = event.clientY;
      state.lastT = event.timeStamp;

      // Downward only (an upward pull leaves the offset at 0) and clamped to
      // the sheet's own height, so it can never be dragged past the top.
      const offset = Math.min(Math.max(dy, 0), node.offsetHeight);
      state.offset = offset;
      // Written straight to the node instead of through state: pointermove
      // fires well over 100 times a second, and a setState per move would
      // re-render the entire sheet tree (SettingsSheet alone carries ~20
      // controls, EditTaskSheet a full form) to move one decorative value.
      node.style.transform = `translate3d(0, ${offset}px, 0)`;
    },
    []
  );

  /** Animated return to the resting position. */
  const snapBack = useCallback((node: HTMLDivElement) => {
    node.style.willChange = "";
    node.style.cursor = "";
    if (prefersReducedMotion()) {
      // No animation at all for users who asked for none — still ends at 0.
      node.style.transition = "none";
      node.style.transform = REST_TRANSFORM;
      return;
    }
    node.style.transition = `transform ${SNAP_MS}ms ease-out`;
    node.style.transform = REST_TRANSFORM;
    // The transition is deliberately left in place: the next drag sets
    // `transition: none` before it moves anything, so it cannot lag the pointer.
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = gesture.current;
      if (!state || event.pointerId !== state.pointerId) return;

      // Cleared before releasing the capture: `lostpointercapture` fires right
      // after this and must find nothing to undo.
      gesture.current = null;

      const node = sheetRef.current;
      if (!state.active || !node) return; // a tap: nothing was moved

      // Release explicitly so a pointer that is still down cannot keep dragging
      // a sheet that is about to unmount.
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const threshold = Math.min(
        node.offsetHeight * DISMISS_FRACTION,
        DISMISS_MAX_PX
      );
      const flicked =
        state.offset >= FLICK_MIN_PX && state.velocity >= FLICK_MIN_VELOCITY;

      if (state.offset >= threshold || flicked) {
        // No transform reset here: every sheet returns null once closed, so the
        // node (and its inline transform) goes with it. Resetting first would
        // flash the sheet back to the bottom for a frame before it disappeared.
        onClose();
        return;
      }

      snapBack(node);
    },
    [onClose, snapBack]
  );

  /**
   * Abandoned gesture — a pointercancel (the browser took the gesture for
   * something else) or a capture that was lost (the node went away). Never
   * dismisses: an interrupted drag is not a decision.
   */
  const cancelDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = gesture.current;
      if (!state || event.pointerId !== state.pointerId) return;
      gesture.current = null;
      if (!state.active) return;
      const node = sheetRef.current;
      if (node) snapBack(node);
    },
    [snapBack]
  );

  const handleProps = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: cancelDrag,
      onLostPointerCapture: cancelDrag,
      style: HANDLE_STYLE,
    }),
    [onPointerDown, onPointerMove, onPointerUp, cancelDrag]
  );

  return { sheetRef, dragStyle: DRAG_STYLE, handleProps };
}

/**
 * Escape closes the sheet, matching the platform expectation on Telegram Web.
 *
 * `enabled` exists for the sheets that stay mounted and render null while
 * closed; pass the same `open` flag they use. Sheets that only render their
 * body while open can leave it off.
 */
export function useEscapeToClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // An inner control that already handled Escape (a combobox closing its
      // list, say) wins: closing the whole sheet on top of that would be two
      // dismissals for one keypress.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onClose]);
}
