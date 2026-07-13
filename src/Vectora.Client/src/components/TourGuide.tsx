import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, BookOpen, Search, Settings } from 'lucide-react';

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
  // Optional illustration rendered in the tooltip for visual context.
  illustration?: ReactNode;
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
  // Step index to start from (default 0). Pass the stored completed-step count
  // so returning users only see steps that were added after they last finished.
  initialStep?: number;
}

const TOOLTIP_WIDTH = 320;
const TOOLTIP_MAX_HEIGHT = 460;
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

export default function TourGuide({ steps, onComplete, onSkip, initialStep = 0 }: TourGuideProps) {
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, Math.min(initialStep, steps.length - 1)));
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
        className="absolute bg-dark-800 border border-dark-500 rounded-xl shadow-2xl p-4 pointer-events-auto overflow-y-auto"
        style={{ ...tooltipStyle, zIndex: 10000, maxHeight: 'calc(100vh - 24px)' }}
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
        <p className="text-xs text-dark-300 mb-3 leading-relaxed">{currentStep.description}</p>

        {/* Illustration */}
        {currentStep.illustration && (
          <div className="mb-3 rounded-lg overflow-hidden border border-dark-700 bg-dark-900">
            {currentStep.illustration}
          </div>
        )}

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

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Vectora!',
    description:
      'This quick tour will show you the key features. Press Next or click anywhere outside the highlighted area to advance, or Skip to exit the tour at any time.',
    placement: 'bottom',
    illustration: (
      <div className="p-3 flex items-center justify-center gap-6 text-[10px]">
        <div className="flex flex-col items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-dark-700 border border-dark-600 rounded text-dark-200 font-mono text-[10px]">→</kbd>
          <span className="text-dark-500">Next step</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="px-1.5 py-0.5 bg-dark-700 border border-dark-600 rounded text-dark-200 text-[9px]">click</div>
          <span className="text-dark-500">Next step</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-dark-700 border border-dark-600 rounded text-dark-200 font-mono text-[10px]">Esc</kbd>
          <span className="text-dark-500">Skip tour</span>
        </div>
      </div>
    ),
  },
  {
    id: 'connection-selector',
    title: 'Connection Selector',
    description:
      'Click here to switch between your configured Service Bus connections. The currently active connection is shown with its name and type.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-dark-700 border border-primary-500/60 rounded-lg ring-1 ring-primary-400/30">
          <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-white font-medium truncate">prod-servicebus</p>
            <p className="text-[9px] text-dark-400">Azure Service Bus</p>
          </div>
          <span className="text-dark-400 text-[10px] flex-shrink-0">▾</span>
        </div>
      </div>
    ),
  },
  {
    id: 'manage-connections',
    title: 'Manage Connections',
    description:
      'Click "Manage Connections…" inside the dropdown to add, edit or delete Service Bus connections. Both real Azure Service Bus and local emulators are supported.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-3 py-2 flex items-center gap-2 bg-dark-700/60">
            <div className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0" />
            <span className="text-white">prod-servicebus</span>
            <span className="ml-auto text-primary-400 text-[9px]">active</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-dark-500 flex-shrink-0" />
            <span className="text-dark-300">dev-emulator</span>
          </div>
          <div className="px-3 py-2 text-primary-400 font-medium">+ Manage Connections…</div>
        </div>
      </div>
    ),
  },
  {
    id: 'entity-browser',
    title: 'Entity Browser',
    description:
      'This panel lists all queues and topics for the selected connection. Click any entity to open it in the message panel on the right.',
    placement: 'right',
    illustration: (
      <div className="p-2">
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-2 py-1 text-[9px] text-dark-500 uppercase tracking-wider bg-dark-900/40">Queues</div>
          <div className="px-3 py-2 flex items-center gap-2 bg-primary-900/30">
            <div className="w-1.5 h-1.5 rounded bg-primary-500 flex-shrink-0" />
            <span className="text-white font-medium">orders-queue</span>
            <span className="ml-auto text-primary-400 font-mono">42</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded bg-dark-500 flex-shrink-0" />
            <span className="text-dark-300">notifications</span>
            <span className="ml-auto text-dark-500 font-mono">0</span>
          </div>
          <div className="px-2 py-1 text-[9px] text-dark-500 uppercase tracking-wider bg-dark-900/40">Topics</div>
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded bg-dark-500 flex-shrink-0" />
            <span className="text-dark-300">domain-events</span>
            <span className="ml-auto text-dark-500 text-[9px]">3 subs</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'entity-search',
    title: 'Search Entities',
    description:
      'Type here to instantly filter queues and topics by name. The list updates as you type.',
    placement: 'bottom',
    illustration: (
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-dark-700 border border-primary-500/60 rounded-lg text-[10px]">
          <Search className="w-3 h-3 text-dark-400 flex-shrink-0" />
          <span className="text-white">order</span>
          <span className="inline-block w-px h-3 bg-primary-400" />
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-3 py-1.5 flex items-center bg-primary-900/30">
            <span className="text-white">orders-queue</span>
            <span className="ml-auto text-primary-400 font-mono">42</span>
          </div>
          <div className="px-3 py-1.5 flex items-center opacity-25">
            <span className="text-dark-400">notifications</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'entity-swipe',
    title: 'Edit & Delete Entities',
    description:
      'Swipe a queue or topic row to the left to reveal the Edit and Delete action buttons. These allow you to modify entity properties or remove the entity entirely.',
    placement: 'right',
    illustration: (
      <div className="p-2 text-[10px]">
        <div className="flex items-stretch rounded-lg overflow-hidden border border-dark-600">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-dark-800">
            <div className="w-1.5 h-1.5 rounded bg-primary-500 flex-shrink-0" />
            <span className="text-white">orders-queue</span>
            <span className="ml-auto text-dark-600 text-[8px] italic">← swipe</span>
          </div>
          <button className="px-3 flex items-center bg-primary-700 text-white font-medium border-l border-dark-600">Edit</button>
          <button className="px-3 flex items-center bg-red-700 text-white font-medium">Del</button>
        </div>
      </div>
    ),
  },
  {
    id: 'message-panel',
    title: 'Message Panel',
    description:
      'After selecting an entity, its messages appear here. You can peek the message list, view message details, and perform actions without affecting live consumers.',
    placement: 'left',
    illustration: (
      <div className="p-2">
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-3 py-2 flex items-start gap-2 bg-primary-900/30">
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate">Order #1042</p>
              <p className="text-dark-400 truncate text-[9px]">{"{ \"status\": \"pending\", \"items\": 3 }"}</p>
            </div>
            <span className="text-[9px] text-dark-500 flex-shrink-0">2m ago</span>
          </div>
          <div className="px-3 py-2 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-dark-300 truncate">Order #1041</p>
              <p className="text-dark-500 truncate text-[9px]">{"{ \"status\": \"complete\" }"}</p>
            </div>
            <span className="text-[9px] text-dark-500 flex-shrink-0">5m ago</span>
          </div>
          <div className="px-3 py-2 flex items-start gap-2 opacity-50">
            <div className="flex-1 min-w-0">
              <p className="text-dark-400 truncate">Order #1040</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'dlq-button',
    title: 'Dead Letter Queue',
    description:
      'Click "Switch to DLQ" to see messages that failed processing and ended up in the dead-letter queue. Switch back to the main queue with the same button.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Send</button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Consume</button>
          <button className="px-2.5 py-1.5 bg-amber-800/40 border border-amber-600/60 rounded-lg text-amber-300 font-medium ring-1 ring-amber-500/30">
            ⚠ Switch to DLQ
          </button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Select</button>
        </div>
      </div>
    ),
  },
  {
    id: 'send-button',
    title: 'Send a Message',
    description:
      'Click "Send" to compose and send a new message to this queue or topic. You can set the body, content type, headers, properties, and schedule delivery.',
    placement: 'bottom',
    illustration: (
      <div className="p-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button className="px-2.5 py-1.5 bg-primary-600 border border-primary-500 rounded-lg text-white font-medium ring-1 ring-primary-400/40 shadow-sm shadow-primary-500/20">
            ↑ Send
          </button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Consume</button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Switch to DLQ</button>
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-lg p-2 space-y-1.5">
          <div className="flex gap-1.5 text-[9px]">
            <span className="text-dark-500 w-14 flex-shrink-0">Body</span>
            <span className="text-dark-300 font-mono">{"{ \"id\": 42 }"}</span>
          </div>
          <div className="flex gap-1.5 text-[9px]">
            <span className="text-dark-500 w-14 flex-shrink-0">Subject</span>
            <span className="text-dark-300">order-created</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'consume-button',
    title: 'Consume Messages',
    description:
      'Click "Consume" to receive and permanently remove messages from the queue or DLQ. Use this to drain test messages during development.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Send</button>
          <button className="px-2.5 py-1.5 bg-red-800/40 border border-red-600/60 rounded-lg text-red-300 font-medium ring-1 ring-red-500/30">
            ✕ Consume
          </button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Switch to DLQ</button>
          <button className="px-2.5 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-dark-400">Select</button>
        </div>
      </div>
    ),
  },
  {
    id: 'select-mode-button',
    title: 'Select Multiple Messages',
    description:
      'Click "Select" to enter multi-select mode. Tick individual messages and then batch-return them from DLQ, delete, or perform other bulk operations.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-3 py-2 flex items-center gap-2 bg-primary-900/30">
            <div className="w-3 h-3 rounded border border-primary-500 bg-primary-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[7px] font-bold leading-none">✓</span>
            </div>
            <span className="text-white">Order #1042</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-2 bg-primary-900/20">
            <div className="w-3 h-3 rounded border border-primary-500 bg-primary-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[7px] font-bold leading-none">✓</span>
            </div>
            <span className="text-dark-200">Order #1041</span>
          </div>
          <div className="px-3 py-2 flex items-center gap-2">
            <div className="w-3 h-3 rounded border border-dark-500 flex-shrink-0" />
            <span className="text-dark-400">Order #1040</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'message-search',
    title: 'Search Messages',
    description:
      'Type here to search messages by body, subject, message ID, correlation ID, session ID, or any application property — without re-fetching from the server.',
    placement: 'bottom',
    illustration: (
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-dark-700 border border-primary-500/60 rounded-lg text-[10px]">
          <Search className="w-3 h-3 text-dark-400 flex-shrink-0" />
          <span className="text-white">pending</span>
          <span className="inline-block w-px h-3 bg-primary-400" />
        </div>
        <div className="bg-dark-800 border border-dark-600 rounded-lg overflow-hidden text-[10px] divide-y divide-dark-700">
          <div className="px-3 py-1.5 flex items-center gap-2 bg-primary-900/30">
            <span className="text-white">Order #1042</span>
            <span className="ml-auto px-1 py-0.5 bg-primary-900 text-primary-300 text-[8px] rounded font-medium">match</span>
          </div>
          <div className="px-3 py-1.5 flex items-center opacity-25">
            <span className="text-dark-400">Order #1041</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'settings-button',
    title: 'Settings',
    description:
      'Click Settings to configure the batch operation timeout, date format, and the built-in MCP server for AI agent access. You can also replay this tour at any time from the Settings dialog.',
    placement: 'bottom',
    illustration: (
      <div className="p-2">
        <div className="flex items-center justify-end gap-2 px-1">
          <button className="p-1.5 rounded-lg bg-dark-700 border border-dark-600 text-dark-400">
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 rounded-lg bg-primary-600 border border-primary-500 text-white ring-1 ring-primary-400/50 shadow-sm shadow-primary-500/20">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-center text-[9px] text-primary-400 mt-1.5">← click the Settings button</p>
      </div>
    ),
  },
];
