import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, BookOpen } from 'lucide-react';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  // CSS selector for the target element (uses data-tour attribute by default)
  targetSelector?: string;
  // Preferred side for the tooltip ('top' | 'bottom' | 'left' | 'right'). Defaults to 'bottom'.
  placement?: 'top' | 'bottom' | 'left' | 'right';
  // Extra padding around the highlighted element (default 8)
  spotlightPadding?: number;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TourGuideProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_MAX_HEIGHT = 200;
const VIEWPORT_MARGIN = 12;

function getTargetRect(step: TourStep): Rect | null {
  const selector = step.targetSelector ?? `[data-tour="${step.id}"]`;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function computeTooltipPosition(
  rect: Rect | null,
  placement: TourStep['placement'] = 'bottom',
  padding: number = 8
): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect) {
    // No target: center the tooltip
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: TOOLTIP_WIDTH,
    };
  }

  const padded = {
    top: rect.top - padding,
    left: rect.left - padding,
    right: rect.left + rect.width + padding,
    bottom: rect.top + rect.height + padding,
  };

  // Try preferred placement, fall back if it doesn't fit
  const placements: Array<TourStep['placement']> = [placement, 'bottom', 'top', 'right', 'left'];
  const tried = new Set<TourStep['placement']>();

  for (const p of placements) {
    if (tried.has(p)) continue;
    tried.add(p);

    let top = 0;
    let left = 0;

    if (p === 'bottom') {
      top = padded.bottom + 8;
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      if (top + TOOLTIP_MAX_HEIGHT <= vh - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, Math.min(vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN, left));
        return { position: 'fixed', top, left, width: TOOLTIP_WIDTH };
      }
    } else if (p === 'top') {
      top = padded.top - TOOLTIP_MAX_HEIGHT - 8;
      left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      if (top >= VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, Math.min(vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN, left));
        return { position: 'fixed', top, left, width: TOOLTIP_WIDTH };
      }
    } else if (p === 'right') {
      top = rect.top + rect.height / 2 - TOOLTIP_MAX_HEIGHT / 2;
      left = padded.right + 8;
      if (left + TOOLTIP_WIDTH <= vw - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, Math.min(vh - TOOLTIP_MAX_HEIGHT - VIEWPORT_MARGIN, top));
        return { position: 'fixed', top, left, width: TOOLTIP_WIDTH };
      }
    } else if (p === 'left') {
      top = rect.top + rect.height / 2 - TOOLTIP_MAX_HEIGHT / 2;
      left = padded.left - TOOLTIP_WIDTH - 8;
      if (left >= VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, Math.min(vh - TOOLTIP_MAX_HEIGHT - VIEWPORT_MARGIN, top));
        return { position: 'fixed', top, left, width: TOOLTIP_WIDTH };
      }
    }
  }

  // Last resort: bottom-center
  const left = Math.max(VIEWPORT_MARGIN, Math.min(vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2));
  return { position: 'fixed', top: Math.min(padded.bottom + 8, vh - TOOLTIP_MAX_HEIGHT - VIEWPORT_MARGIN), left, width: TOOLTIP_WIDTH };
}

export default function TourGuide({ steps, onComplete, onSkip }: TourGuideProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number>(0);

  const currentStep = steps[currentIndex];
  const padding = currentStep?.spotlightPadding ?? 8;

  const updateTargetRect = useCallback(() => {
    if (!currentStep) return;
    setTargetRect(getTargetRect(currentStep));
  }, [currentStep]);

  // Re-measure when the step changes or the window resizes/scrolls.
  useEffect(() => {
    updateTargetRect();

    const onResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateTargetRect);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    // Observe the target element for size changes (e.g. lazy-rendered content)
    observerRef.current?.disconnect();
    const selector = currentStep?.targetSelector ?? `[data-tour="${currentStep?.id}"]`;
    const el = currentStep ? document.querySelector(selector) : null;
    if (el) {
      observerRef.current = new ResizeObserver(onResize);
      observerRef.current.observe(el);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      observerRef.current?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [currentStep, updateTargetRect]);

  const handleNext = useCallback(() => {
    if (currentIndex < steps.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      onComplete();
    }
  }, [currentIndex, steps.length, onComplete]);

  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleNext, handleSkip]);

  if (!currentStep) return null;

  const tooltipStyle = computeTooltipPosition(targetRect, currentStep.placement, padding);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Spotlight rect with padding
  const spotlight = targetRect
    ? {
        top: Math.max(0, targetRect.top - padding),
        left: Math.max(0, targetRect.left - padding),
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
      }
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" aria-modal role="dialog" aria-label="Tour Guide">
      {/* Overlay segments creating a spotlight effect */}
      {spotlight ? (
        <>
          {/* Top */}
          <div
            className="absolute bg-black/70 pointer-events-auto"
            style={{ top: 0, left: 0, width: vw, height: spotlight.top }}
            onClick={handleNext}
          />
          {/* Left */}
          <div
            className="absolute bg-black/70 pointer-events-auto"
            style={{
              top: spotlight.top,
              left: 0,
              width: spotlight.left,
              height: spotlight.height,
            }}
            onClick={handleNext}
          />
          {/* Right */}
          <div
            className="absolute bg-black/70 pointer-events-auto"
            style={{
              top: spotlight.top,
              left: spotlight.left + spotlight.width,
              width: Math.max(0, vw - spotlight.left - spotlight.width),
              height: spotlight.height,
            }}
            onClick={handleNext}
          />
          {/* Bottom */}
          <div
            className="absolute bg-black/70 pointer-events-auto"
            style={{
              top: spotlight.top + spotlight.height,
              left: 0,
              width: vw,
              height: Math.max(0, vh - spotlight.top - spotlight.height),
            }}
            onClick={handleNext}
          />
          {/* Spotlight border */}
          <div
            className="absolute pointer-events-none rounded-lg"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
              boxShadow: '0 0 0 3px rgba(14, 165, 233, 0.8), 0 0 0 5px rgba(14, 165, 233, 0.3)',
              border: '2px solid rgba(14, 165, 233, 0.9)',
              transition: 'all 0.25s ease',
            }}
          />
        </>
      ) : (
        /* No target: full dark overlay */
        <div
          className="absolute inset-0 bg-black/70 pointer-events-auto"
          onClick={handleNext}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute bg-dark-800 border border-dark-500 rounded-xl shadow-2xl p-4 pointer-events-auto"
        style={{ ...tooltipStyle, zIndex: 10000 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
            <h3 className="text-sm font-semibold text-white leading-tight">{currentStep.title}</h3>
          </div>
          <button
            onClick={handleSkip}
            className="text-dark-400 hover:text-white flex-shrink-0 p-0.5"
            title="Close tour"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-dark-300 mb-4 leading-relaxed">{currentStep.description}</p>

        {/* Footer: step counter + navigation */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-dark-500">
            {currentIndex + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="px-3 py-1.5 text-xs text-dark-400 hover:text-white bg-dark-700 hover:bg-dark-600 rounded-lg transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="px-3 py-1.5 text-xs text-white bg-primary-500 hover:bg-primary-400 rounded-lg transition-colors"
            >
              {currentIndex < steps.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Tour step definitions ─────────────────────────────────────────────────

export const CURRENT_TOUR_VERSION = 1;

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Vectora!',
    description:
      'This quick tour will show you the key features. Press Next or click anywhere outside the highlighted area to advance, or Skip to exit the tour at any time.',
    placement: 'bottom',
  },
  {
    id: 'connection-selector',
    title: 'Connection Selector',
    description:
      'Click here to switch between your configured Service Bus connections. The currently active connection is shown with its name and type.',
    placement: 'bottom',
  },
  {
    id: 'manage-connections',
    title: 'Manage Connections',
    description:
      'Click "Manage Connections…" inside the dropdown to add, edit or delete Service Bus connections. Both real Azure Service Bus and local emulators are supported.',
    placement: 'bottom',
  },
  {
    id: 'entity-browser',
    title: 'Entity Browser',
    description:
      'This panel lists all queues and topics for the selected connection. Click any entity to open it in the message panel on the right.',
    placement: 'right',
  },
  {
    id: 'entity-search',
    title: 'Search Entities',
    description:
      'Type here to instantly filter queues and topics by name. The list updates as you type.',
    placement: 'bottom',
  },
  {
    id: 'entity-swipe',
    title: 'Edit & Delete Entities',
    description:
      'Swipe a queue or topic row to the left to reveal the Edit and Delete action buttons. These allow you to modify entity properties or remove the entity entirely.',
    placement: 'right',
  },
  {
    id: 'message-panel',
    title: 'Message Panel',
    description:
      'After selecting an entity, its messages appear here. You can peek the message list, view message details, and perform actions without affecting live consumers.',
    placement: 'left',
  },
  {
    id: 'dlq-button',
    title: 'Dead Letter Queue',
    description:
      'Click "Switch to DLQ" to see messages that failed processing and ended up in the dead-letter queue. Switch back to the main queue with the same button.',
    placement: 'bottom',
  },
  {
    id: 'send-button',
    title: 'Send a Message',
    description:
      'Click "Send" to compose and send a new message to this queue or topic. You can set the body, content type, headers, properties, and schedule delivery.',
    placement: 'bottom',
  },
  {
    id: 'consume-button',
    title: 'Consume Messages',
    description:
      'Click "Consume" to receive and permanently remove messages from the queue or DLQ. Use this to drain test messages during development.',
    placement: 'bottom',
  },
  {
    id: 'select-mode-button',
    title: 'Select Multiple Messages',
    description:
      'Click "Select" to enter multi-select mode. Tick individual messages and then batch-return them from DLQ, delete, or perform other bulk operations.',
    placement: 'bottom',
  },
  {
    id: 'message-search',
    title: 'Search Messages',
    description:
      'Type here to search messages by body, subject, message ID, correlation ID, session ID, or any application property — without re-fetching from the server.',
    placement: 'bottom',
  },
  {
    id: 'settings-button',
    title: 'Settings',
    description:
      'Click Settings to configure the batch operation timeout, date format, and the built-in MCP server for AI agent access. You can also replay this tour at any time from the Settings dialog.',
    placement: 'bottom',
  },
];
