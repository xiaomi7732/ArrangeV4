'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { TodoItemWithId } from '@/lib/store/types';
import {
  type TimelineWindow,
  buildTimeAxisTicks,
  panWindow,
  positionPercent,
  spanOf,
  zoomWindow,
} from '@/lib/timeline/timelineWindow';
import { buildTimelineRows } from '@/lib/timeline/timelineRows';
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

export interface TimelineChartProps {
  items: TodoItemWithId[];
  window: TimelineWindow;
  onWindowChange: (next: TimelineWindow) => void;
  onSelectItem: (item: TodoItemWithId) => void;
  /** Rendered when no task falls inside the window. */
  emptyMessage: string;
  nowMs: number;
}

export default function TimelineChart({
  items,
  window,
  onWindowChange,
  onSelectItem,
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
  useEffect(() => {
    windowRef.current = window;
    onWindowChangeRef.current = onWindowChange;
  });

  const ticks = useMemo(() => buildTimeAxisTicks(window), [window]);

  const rows = useMemo(() => buildTimelineRows(items, window), [items, window]);

  const nowPercent = positionPercent(nowMs, window);
  const nowVisible = nowPercent >= 0 && nowPercent <= 100;

  const zoomAt = useCallback((factor: number, clientX?: number) => {
    const element = trackRef.current;
    let anchorRatio = 0.5;
    if (element && clientX !== undefined) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) anchorRatio = (clientX - rect.left) / rect.width;
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
        const anchorRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
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
      const travel = rect.width > 0
        ? Math.max(-PAN_STEP, Math.min(PAN_STEP, horizontal / rect.width))
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
    const drag = dragRef.current;
    const element = trackRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !element) return;
    // A button released outside the chart never reaches our pointerup, so a
    // move with nothing pressed is the first sign the drag is already over.
    if (e.pointerType !== 'touch' && e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved) {
      // Capturing before the user has clearly committed would swallow taps.
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      element.setPointerCapture(e.pointerId);
    }
    onWindowChange(panWindow(drag.startWindow, -dx / rect.width));
  }, [onWindowChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
  }, []);

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

  return (
    <div className={styles.chart}>
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

      <div
        ref={trackRef}
        className={styles.surface}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
        role="group"
        tabIndex={0}
        aria-label={`Timeline spanning about ${spanDays} ${spanDays === 1 ? 'day' : 'days'}. Use the arrow keys to move the window, and plus or minus to zoom.`}
      >
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

        {rows.length === 0 ? (
          <p className={styles.empty}>{emptyMessage}</p>
        ) : (
          <ul className={styles.rows}>
            {rows.map(row => (
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
