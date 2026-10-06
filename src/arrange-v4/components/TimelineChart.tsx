'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TodoItemWithId } from '@/lib/store/types';
import {
  type TimelineWindow,
  buildTimeAxisTicks,
  panWindow,
  positionPercent,
  spanOf,
  zoomWindow,
} from '@/lib/timeline/timelineWindow';
import { buildTimelineRows, type TimelineRow } from '@/lib/timeline/timelineRows';
import { formatAbsoluteDateTime } from '@/lib/dateUtils';
import {
  type BarEdge,
  msPerPixel,
  nudgeStep,
  resizeBar,
  snapStepFor,
} from '@/lib/timeline/timelineDrag';
import styles from './TimelineChart.module.css';

/** One wheel notch or button press. Small enough to feel continuous. */
export const ZOOM_STEP = 1.3;
/** A keyboard or button pan moves a quarter of the visible span. */
export const PAN_STEP = 0.25;
/** Below this a drag is a click that wobbled, not a pan. */
const DRAG_THRESHOLD_PX = 3;
/** How long after a drag a stray click is still treated as part of it. */
const CLICK_SUPPRESSION_MS = 400;

/**
 * Turns a wheel delta into a zoom factor.
 *
 * A trackpad sends dozens of small deltas per gesture, so applying a whole
 * step to each one would fling the view from six hours to a year. Scaling by
 * magnitude keeps a mouse notch (±100px) close to one step.
 */
function zoomFactorFor(deltaY: number): number {
  const capped = Math.max(-200, Math.min(200, deltaY));
  return Math.exp((capped / 100) * Math.log(ZOOM_STEP));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an arrow-key run is allowed to continue before it is saved. */
const KEY_COMMIT_DELAY_MS = 400;

/** Both ends of a bar, as they would be stored. */
interface EdgeTimes {
  etsDateTime: string;
  etaDateTime: string;
}

function toMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

interface ResizeHandleProps {
  edge: BarEdge;
  row: TimelineRow;
  window: TimelineWindow;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>, item: TodoItemWithId, edge: BarEdge) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, item: TodoItemWithId, edge: BarEdge) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onBlur: () => void;
}

/**
 * The grip at one end of a bar.
 *
 * It is a slider rather than a plain button so the same move is available from
 * the keyboard and so the date it lands on is announced: the chart would
 * otherwise be the one place in the app where a date can only be changed with
 * a mouse, and a silent one at that.
 */
function ResizeHandle({
  edge,
  row,
  window: timelineWindow,
  onPointerDown,
  onKeyDown,
  onKeyUp,
  onBlur,
}: ResizeHandleProps) {
  const what = edge === 'start' ? 'start' : 'end';
  const startMs = toMs(row.item.etsDateTime);
  const endMs = toMs(row.item.etaDateTime);
  const value = edge === 'start'
    ? row.item.etsDateTime ?? row.item.etaDateTime
    : row.item.etaDateTime ?? row.item.etsDateTime;
  const valueMs = toMs(value);
  /*
   * The only real limit is the other end of the bar, which neither edge may
   * pass; in the other direction a date can go as far as the user drags it,
   * so the visible window stands in — widened if need be, because a value
   * reported outside its own bounds is worse than a loose bound.
   */
  const opposite = edge === 'start' ? endMs ?? startMs : startMs ?? endMs;
  const lower = edge === 'start' ? timelineWindow.startMs : opposite ?? timelineWindow.startMs;
  const upper = edge === 'start' ? opposite ?? timelineWindow.endMs : timelineWindow.endMs;
  const min = valueMs === null ? lower : Math.min(lower, valueMs);
  const max = valueMs === null ? upper : Math.max(upper, valueMs);
  return (
    <button
      type="button"
      className={`${styles.handle} ${edge === 'start' ? styles.handleStart : styles.handleEnd}`}
      style={{
        left: edge === 'start'
          ? `${row.left}%`
          : `calc(${row.left + row.width}% - var(--timeline-handle-width))`,
      }}
      role="slider"
      aria-label={`${what === 'start' ? 'Estimated start' : 'Estimated finish'} of ${row.item.subject}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={valueMs ?? undefined}
      aria-valuetext={value ? formatAbsoluteDateTime(value) : undefined}
      title={`Drag, or use the arrow keys, to change the ${what}`}
      onPointerDown={e => onPointerDown(e, row.item, edge)}
      onKeyDown={e => onKeyDown(e, row.item, edge)}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    />
  );
}

export interface RescheduleFields {
  etsDateTime?: string;
  etaDateTime?: string;
}

export interface TimelineChartProps {
  items: TodoItemWithId[];
  window: TimelineWindow;
  onWindowChange: (next: TimelineWindow) => void;
  onSelectItem: (item: TodoItemWithId) => void;
  /**
   * Saves a bar dragged by its edge. Omit it to make the chart read-only —
   * the handles are not drawn at all without a way to save them.
   */
  onRescheduleItem?: (item: TodoItemWithId, next: RescheduleFields) => void;
  /** Rendered when no task falls inside the window. */
  emptyMessage: string;
  nowMs: number;
}

export default function TimelineChart({
  items,
  window,
  onWindowChange,
  onSelectItem,
  onRescheduleItem,
  emptyMessage,
  nowMs,
}: TimelineChartProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  /*
   * The gesture is measured from where it began, not from the previous event:
   * two pointer moves can arrive before React re-renders, and a delta applied
   * to a stale window would silently lose the first of them.
   */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWindow: TimelineWindow;
    moved: boolean;
  } | null>(null);
  // A drag ends with a click on whatever was under the pointer. Opening the
  // task the user was only scrolling past would be maddening.
  const suppressClickUntilRef = useRef(0);

  // Read by the native wheel listener and by pointer handlers, which are
  // registered once and so cannot close over the current render's props.
  const windowRef = useRef(window);
  const onWindowChangeRef = useRef(onWindowChange);
  // Rows carry the preview while a gesture is running, so the saved dates a
  // change has to be measured against are looked up here instead.
  const itemsRef = useRef(items);
  useEffect(() => {
    windowRef.current = window;
    onWindowChangeRef.current = onWindowChange;
    itemsRef.current = items;
  });

  const savedItem = useCallback((item: TodoItemWithId) => (
    itemsRef.current.find(candidate => candidate.id === item.id) ?? item
  ), []);

  const ticks = useMemo(() => buildTimeAxisTicks(window), [window]);

  /*
   * A drag in progress is drawn from the preview rather than from the saved
   * task: the write only happens when the gesture ends, and a bar that stayed
   * put until then would feel broken.
   */
  const [preview, setPreview] = useState<{
    id: string;
    etsDateTime: string;
    etaDateTime: string;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    item: TodoItemWithId;
    edge: BarEdge;
    startX: number;
    moved: boolean;
    next: EdgeTimes | null;
  } | null>(null);
  // An auto-repeating arrow key would otherwise put one write per repeat on
  // the wire, and the stores give no promise about the order they land in.
  const keyNudgeRef = useRef<{ item: TodoItemWithId; next: EdgeTimes } | null>(null);
  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewedItems = useMemo(() => {
    if (!preview) return items;
    return items.map(item => (
      item.id === preview.id
        ? { ...item, etsDateTime: preview.etsDateTime, etaDateTime: preview.etaDateTime }
        : item
    ));
  }, [items, preview]);

  const rows = useMemo(
    () => buildTimelineRows(previewedItems, window),
    [previewedItems, window],
  );

  /*
   * Rows are ordered by start time, so a bar dragged past its neighbour would
   * jump to another line mid-gesture. The order from before the gesture is
   * held until it ends.
   */
  const settledOrder = useMemo(
    () => buildTimelineRows(items, window).map(row => row.item.id),
    [items, window],
  );
  const orderedRows = useMemo(() => {
    if (!preview) return rows;
    const rank = new Map(settledOrder.map((id, index) => [id, index]));
    return [...rows].sort((a, b) => (
      (rank.get(a.item.id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(b.item.id) ?? Number.MAX_SAFE_INTEGER)
    ));
  }, [preview, rows, settledOrder]);

  const nowPercent = positionPercent(nowMs, window);
  const nowVisible = nowPercent >= 0 && nowPercent <= 100;

  /*
   * The arithmetic a grip drags through, and the write it ends in.
   */
  const computeEdge = useCallback((
    source: { etsDateTime?: string; etaDateTime?: string },
    edge: BarEdge,
    deltaMs: number,
  ): EdgeTimes | null => {
    const startMs = toMs(source.etsDateTime);
    const endMs = toMs(source.etaDateTime);
    if (startMs === null && endMs === null) return null;
    const next = resizeBar({
      startMs,
      endMs,
      edge,
      deltaMs,
      stepMs: snapStepFor(spanOf(windowRef.current)),
    });
    return {
      etsDateTime: new Date(next.startMs).toISOString(),
      etaDateTime: new Date(next.endMs).toISOString(),
    };
  }, []);

  /*
   * Only the dates that actually moved are sent. Writing both would drop the
   * "moved from" notice on an end the user never touched, and a drag that
   * snapped back where it started would still cost a write.
   */
  const commitEdge = useCallback((item: TodoItemWithId, next: EdgeTimes) => {
    const fields: RescheduleFields = {};
    if (toMs(item.etsDateTime) !== toMs(next.etsDateTime)) fields.etsDateTime = next.etsDateTime;
    if (toMs(item.etaDateTime) !== toMs(next.etaDateTime)) fields.etaDateTime = next.etaDateTime;
    if (!fields.etsDateTime && !fields.etaDateTime) return;
    onRescheduleItem?.(item, fields);
  }, [onRescheduleItem]);

  const cancelResize = useCallback(() => {
    resizeRef.current = null;
    setPreview(null);
  }, []);

  /*
   * Abandons whatever gesture is in progress without saving it — the Escape
   * key, and the one place a half-finished drag is thrown away rather than
   * committed.
   */
  const cancelGesture = useCallback(() => {
    if (keyTimerRef.current !== null) {
      clearTimeout(keyTimerRef.current);
      keyTimerRef.current = null;
    }
    keyNudgeRef.current = null;
    const resize = resizeRef.current;
    if (resize && trackRef.current?.hasPointerCapture(resize.pointerId)) {
      trackRef.current.releasePointerCapture(resize.pointerId);
    }
    resizeRef.current = null;
    setPreview(null);
  }, []);

  /*
   * Escape is listened for on the document while something is in flight: a
   * grip is only drawn while its end of the bar is in view, so the element
   * that had focus when the gesture began may be gone by now.
   */
  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelGesture();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cancelGesture, preview]);

  const zoomAt = useCallback((factor: number, clientX?: number) => {
    const element = trackRef.current;
    let anchorRatio = 0.5;
    if (element && clientX !== undefined) {
      const rect = element.getBoundingClientRect();
      const width = element.clientWidth;
      if (width > 0) anchorRatio = (clientX - rect.left) / width;
    }
    onWindowChange(zoomWindow(window, factor, anchorRatio));
  }, [onWindowChange, window]);

  /*
   * The wheel listener is attached by hand because React registers `wheel`
   * passively, which forbids `preventDefault`. Without it every zoom notch
   * would also scroll the page out from under the chart.
   */
  useEffect(() => {
    const element = trackRef.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      const current = windowRef.current;
      const rect = element.getBoundingClientRect();
      // The content width, which a vertical scrollbar is not part of.
      const width = element.clientWidth;
      // Wheel deltas arrive in pixels, lines or pages depending on the device.
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height || 400 : 1;
      const deltaX = e.deltaX * scale;
      const deltaY = e.deltaY * scale;

      // A pinch gesture reaches the page as ctrl+wheel. Zooming on a plain
      // wheel as well would trap the page scroll: the chart grows a row per
      // task and can easily be taller than the viewport.
      if (e.ctrlKey || e.metaKey) {
        if (!deltaY) return;
        e.preventDefault();
        const anchorRatio = width > 0 ? (e.clientX - rect.left) / width : 0.5;
        onWindowChangeRef.current(zoomWindow(current, zoomFactorFor(deltaY), anchorRatio));
        return;
      }

      // Horizontal intent — a trackpad swipe or shift+wheel — moves through
      // time. A mostly vertical gesture with a little sideways jitter is still
      // a page scroll, so the horizontal part has to dominate to count.
      const horizontal = e.shiftKey && !e.deltaX ? deltaY : deltaX;
      if (!horizontal) return;
      if (!e.shiftKey && Math.abs(deltaX) <= Math.abs(deltaY)) return;
      e.preventDefault();
      const travel = width > 0
        ? Math.max(-PAN_STEP, Math.min(PAN_STEP, horizontal / width))
        : 0;
      if (!travel) return;
      onWindowChangeRef.current(panWindow(current, travel));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only a plain primary-button drag pans.
    if (e.button !== 0) return;
    // A fresh gesture answers for itself; nothing an earlier one did applies.
    suppressClickUntilRef.current = 0;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWindow: windowRef.current,
      moved: false,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const element = trackRef.current;
    if (!element) return;
    // A resize is captured here too, so it is answered before the pan.
    const resize = resizeRef.current;
    if (resize) {
      if (resize.pointerId !== e.pointerId) return;
      if (e.pointerType !== 'touch' && e.buttons === 0) {
        cancelResize();
        return;
      }
      // `clientWidth` excludes a vertical scrollbar, which the bars' percents
      // are measured against as well.
      const width = element.clientWidth;
      if (width <= 0) return;
      const dx = e.clientX - resize.startX;
      if (!resize.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      resize.moved = true;
      const next = computeEdge(
        resize.item,
        resize.edge,
        dx * msPerPixel(spanOf(windowRef.current), width),
      );
      if (!next) return;
      resize.next = next;
      setPreview({ id: resize.item.id, ...next });
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    // A button released outside the chart never reaches our pointerup, so a
    // move with nothing pressed is the first sign the drag is already over.
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const width = element.clientWidth;
    if (width <= 0) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved) {
      // Capturing before the user has clearly committed would swallow taps.
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      element.setPointerCapture(e.pointerId);
    }
    onWindowChange(panWindow(drag.startWindow, -dx / width));
  }, [cancelResize, computeEdge, onWindowChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (resize) {
      if (resize.pointerId !== e.pointerId) return;
      resizeRef.current = null;
      setPreview(null);
      if (trackRef.current?.hasPointerCapture(e.pointerId)) {
        trackRef.current.releasePointerCapture(e.pointerId);
      }
      // Whatever is under the pointer is about to receive a click it did not
      // ask for — the bar under a grip, most often.
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
      if (e.type === 'pointercancel') return;
      if (!resize.moved) {
        // A grip can cover a short bar completely, so a press that never
        // moved opens the task rather than doing nothing at all.
        onSelectItem(resize.item);
        return;
      }
      if (resize.next) commitEdge(resize.item, resize.next);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
  }, [commitEdge, onSelectItem]);

  /*
   * Capture can also be lost without a pointerup — a browser gesture taking
   * over, or the element being hidden. A preview left on screen would show
   * dates that were never saved.
   */
  const handleLostPointerCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    /*
     * A touch press gives the element under the finger implicit capture, so
     * moving capture to the surface makes that element fire this event too.
     * Only the surface losing its own capture ends a gesture.
     */
    if (e.target !== e.currentTarget) return;
    if (resizeRef.current?.pointerId === e.pointerId) cancelResize();
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }, [cancelResize]);

  /*
   * The click that closes a drag is swallowed here rather than inside each
   * bar: a drag over empty chart space produces no bar click at all, and a
   * flag left set would go on to eat the user's next deliberate one. A drag
   * that never produces a click — a touch pan, or one ending in pointercancel
   * — is covered by letting the suppression lapse, and a keyboard or
   * screen-reader activation (detail 0) is never suppressed at all.
   */
  const handleClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const until = suppressClickUntilRef.current;
    if (!until) return;
    suppressClickUntilRef.current = 0;
    if (e.detail === 0 || Date.now() > until) return;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  /*
   * Dragging an edge.
   *
   * The gesture is captured on the surface rather than on the grip itself: a
   * grip is only drawn while its end of the bar is in view, so dragging an
   * edge out of the window would unmount the element holding the capture and
   * strand the drag half-finished.
   */
  const flushKeyNudge = useCallback(() => {
    if (keyTimerRef.current !== null) {
      clearTimeout(keyTimerRef.current);
      keyTimerRef.current = null;
    }
    const pending = keyNudgeRef.current;
    keyNudgeRef.current = null;
    if (!pending) return;
    setPreview(null);
    commitEdge(pending.item, pending.next);
  }, [commitEdge]);

  // A nudge still waiting to be saved when the chart goes away would be lost.
  const flushKeyNudgeRef = useRef(flushKeyNudge);
  useEffect(() => {
    flushKeyNudgeRef.current = flushKeyNudge;
  });
  useEffect(() => () => flushKeyNudgeRef.current(), []);

  const handleResizeStart = useCallback((
    e: React.PointerEvent<HTMLButtonElement>,
    item: TodoItemWithId,
    edge: BarEdge,
  ) => {
    if (e.button !== 0) return;
    // The surface must not read the same press as the start of a pan.
    e.stopPropagation();
    suppressClickUntilRef.current = 0;
    flushKeyNudge();
    resizeRef.current = {
      pointerId: e.pointerId,
      item: savedItem(item),
      edge,
      startX: e.clientX,
      moved: false,
      next: null,
    };
    trackRef.current?.setPointerCapture(e.pointerId);
  }, [flushKeyNudge, savedItem]);

  const handleResizeKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLButtonElement>,
    item: TodoItemWithId,
    edge: BarEdge,
  ) => {
    if (e.key === 'Escape') {
      cancelGesture();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    // The surface would otherwise read the same key as a pan.
    e.stopPropagation();
    e.preventDefault();
    // Repeats build on what is already on screen, so holding the key walks —
    // but what is finally saved is measured against the stored dates, not
    // against the step before it, which a clamped repeat would call unchanged.
    const source = preview && preview.id === item.id ? preview : item;
    const base = keyNudgeRef.current?.item.id === item.id
      ? keyNudgeRef.current.item
      : savedItem(item);
    const step = nudgeStep(snapStepFor(spanOf(windowRef.current)), e.shiftKey);
    const next = computeEdge(source, edge, e.key === 'ArrowLeft' ? -step : step);
    if (!next) return;
    setPreview({ id: item.id, ...next });
    keyNudgeRef.current = { item: base, next };
    if (keyTimerRef.current !== null) clearTimeout(keyTimerRef.current);
    keyTimerRef.current = setTimeout(() => {
      keyTimerRef.current = null;
      flushKeyNudgeRef.current();
    }, KEY_COMMIT_DELAY_MS);
  }, [cancelGesture, computeEdge, preview, savedItem]);

  const handleResizeKeyUp = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') flushKeyNudge();
  }, [flushKeyNudge]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only the chart surface itself navigates; the bars inside it are buttons
    // and must keep their own Enter and Space.
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case 'ArrowLeft':
        onWindowChange(panWindow(window, -PAN_STEP));
        break;
      case 'ArrowRight':
        onWindowChange(panWindow(window, PAN_STEP));
        break;
      case '+':
      case '=':
        zoomAt(1 / ZOOM_STEP);
        break;
      case '-':
      case '_':
        zoomAt(ZOOM_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
  }, [onWindowChange, window, zoomAt]);

  const spanDays = Math.max(1, Math.round(spanOf(window) / DAY_MS));

  /*
   * A task whose stored block could not be parsed must not be written back —
   * the stores refuse it — so it is given no grips at all rather than a
   * gesture that can only end in a rollback and a banner.
   */
  const canReschedule = (item: TodoItemWithId) => (
    Boolean(onRescheduleItem) && item.dataUnreadable !== true
  );

  return (
    <div className={styles.chart}>
      <div
        ref={trackRef}
        className={styles.surface}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
        role="group"
        tabIndex={0}
        aria-label={`Timeline spanning about ${spanDays} ${spanDays === 1 ? 'day' : 'days'}. Use the arrow keys to move the window, and plus or minus to zoom.`}
      >
        <div className={styles.axis} aria-hidden="true">
          {ticks.map(tick => (
            <span
              key={tick.timeMs}
              className={`${styles.tickLabel} ${tick.major ? styles.tickMajor : ''}`}
              style={{ left: `${tick.positionPercent}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        <div className={styles.track}>
          <div className={styles.gridLines} aria-hidden="true">
            {ticks.map(tick => (
              <span
                key={tick.timeMs}
                className={`${styles.gridLine} ${tick.major ? styles.gridLineMajor : ''}`}
                style={{ left: `${tick.positionPercent}%` }}
              />
            ))}
            {nowVisible && <span className={styles.nowLine} style={{ left: `${nowPercent}%` }} />}
          </div>

          {orderedRows.length === 0 ? (
            <p className={styles.empty}>{emptyMessage}</p>
          ) : (
            <ul className={styles.rows}>
              {orderedRows.map(row => (
                <li key={row.item.id} className={styles.row}>
                  <button
                    type="button"
                    className={[
                      styles.bar,
                      styles[`status_${row.item.status || 'new'}`],
                      row.item.urgent ? styles.barUrgent : '',
                      row.clippedStart ? styles.clippedStart : '',
                      row.clippedEnd ? styles.clippedEnd : '',
                    ].filter(Boolean).join(' ')}
                    style={{ left: `${row.left}%`, width: `${row.width}%` }}
                    title={row.tooltip}
                    aria-label={row.accessibleLabel}
                    onClick={() => onSelectItem(row.item)}
                  >
                    {/*
                      A sliver of a bar cannot hold a label, so the label hangs
                      beside it instead of being clipped to nothing — and flips
                      to the other side near the right edge, where it would
                      otherwise run off the chart.
                    */}
                    <span
                      className={[
                        styles.barLabel,
                        row.width >= 14 ? styles.barLabelInside : '',
                        row.width < 14 && row.left > 65 ? styles.barLabelBefore : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {row.item.subject}
                    </span>
                  </button>
                  {/*
                    A grip is dropped once its end of the bar leaves the
                    window — except on the task being moved right now, where
                    it stays (pinned to the edge) so a keyboard user doesn't
                    lose their place mid-nudge. A task whose stored data could
                    not be read is never offered one: the write would be
                    refused, leaving a preview to roll back.
                  */}
                  {canReschedule(row.item) && (!row.clippedStart || preview?.id === row.item.id) && (
                    <ResizeHandle
                      edge="start"
                      row={row}
                      window={window}
                      onPointerDown={handleResizeStart}
                      onKeyDown={handleResizeKeyDown}
                      onKeyUp={handleResizeKeyUp}
                      onBlur={flushKeyNudge}
                    />
                  )}
                  {canReschedule(row.item) && (!row.clippedEnd || preview?.id === row.item.id) && (
                    <ResizeHandle
                      edge="end"
                      row={row}
                      window={window}
                      onPointerDown={handleResizeStart}
                      onKeyDown={handleResizeKeyDown}
                      onKeyUp={handleResizeKeyUp}
                      onBlur={flushKeyNudge}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
