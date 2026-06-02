import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface DateTimePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  /** Earliest selectable instant. Days/times before it are disabled. */
  minDate?: Date;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export default function DateTimePicker({ value, onChange, minDate }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  // The month currently shown in the calendar grid (defaults to the value's month or today).
  const [viewMonth, setViewMonth] = useState(() => startOfDay(value ?? minDate ?? new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Every time the picker opens, reset to the current PC time so it always starts at "now"
  // (a stale prior selection is discarded) and the quick chips have a fresh base to increment.
  useEffect(() => {
    if (!open) return;
    onChange(new Date());
    setViewMonth(startOfDay(new Date()));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the visible month in sync with the selected date (e.g. when a +increment rolls past
  // month end). Manual prev/next navigation leaves value unchanged, so it isn't overridden.
  const valYear = value?.getFullYear();
  const valMonth = value?.getMonth();
  useEffect(() => {
    if (valYear != null && valMonth != null) setViewMonth(new Date(valYear, valMonth, 1));
  }, [valYear, valMonth]);

  const min = minDate ?? null;
  const hours = value ? value.getHours() : 9;
  const minutes = value ? value.getMinutes() : 0;

  // Build the 6-row calendar grid for the viewed month.
  const days = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const startOffset = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [viewMonth]);

  // Apply a clicked day while preserving (or seeding) the time-of-day.
  const pickDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(value ? value.getHours() : 9, value ? value.getMinutes() : 0, 0, 0);
    // Never allow a result before minDate.
    if (min && next < min) {
      next.setHours(min.getHours(), min.getMinutes(), 0, 0);
      if (next < min) next.setTime(min.getTime());
    }
    onChange(next);
  };

  const setTime = (h: number, m: number) => {
    const base = value ?? startOfDay(min ?? new Date());
    const next = new Date(base);
    next.setHours(h, m, 0, 0);
    onChange(next);
  };

  // Quick chips increment the currently selected time (seeded to now on open).
  const addOffset = (ms: number) => {
    const base = value ?? new Date();
    onChange(new Date(base.getTime() + ms));
  };

  const isDayDisabled = (day: Date) => !!min && startOfDay(day) < startOfDay(min);

  const display = value
    ? value.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 bg-dark-900 border rounded-lg text-sm text-left transition-colors ${
          open ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-dark-500 hover:border-dark-400'
        } ${value ? 'text-white' : 'text-dark-400'}`}
      >
        <Calendar className="w-4 h-4 text-primary-400 flex-shrink-0" />
        <span className="flex-1 truncate">{display || 'Pick a date & time…'}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="text-dark-400 hover:text-white p-0.5 -mr-1"
            title="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4"
          onClick={() => setOpen(false)}
        >
        <div
          className="w-full max-w-[340px] bg-dark-800 border border-dark-600 rounded-xl shadow-2xl p-4 select-none"
          onClick={e => e.stopPropagation()}
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="p-1.5 text-dark-300 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-white">
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="p-1.5 text-dark-300 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-[11px] font-medium text-dark-500 py-1">{w}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, i) => {
              const outside = day.getMonth() !== viewMonth.getMonth();
              const disabled = isDayDisabled(day);
              const selected = value && sameDay(day, value);
              const today = sameDay(day, new Date());
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(day)}
                  className={`h-8 text-xs rounded-lg transition-colors flex items-center justify-center relative ${
                    selected
                      ? 'bg-primary-500 text-white font-semibold'
                      : disabled
                        ? 'text-dark-600 cursor-not-allowed'
                        : outside
                          ? 'text-dark-500 hover:bg-dark-700'
                          : 'text-dark-200 hover:bg-dark-700'
                  }`}
                >
                  {day.getDate()}
                  {today && !selected && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary-400" />}
                </button>
              );
            })}
          </div>

          {/* Time row */}
          <div className="mt-3 pt-3 border-t border-dark-700 flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary-400 flex-shrink-0" />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={23}
                value={pad(hours)}
                onChange={(e) => {
                  const h = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                  setTime(h, minutes);
                }}
                className="w-12 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm text-center focus:outline-none focus:border-primary-500"
              />
              <span className="text-dark-400 font-semibold">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={pad(minutes)}
                onChange={(e) => {
                  const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                  setTime(hours, m);
                }}
                className="w-12 px-2 py-1.5 bg-dark-900 border border-dark-500 rounded text-white text-sm text-center focus:outline-none focus:border-primary-500"
              />
            </div>
            <span className="text-xs text-dark-500 ml-auto">24h · local</span>
          </div>

          {/* Quick chips add to the selected time (use the calendar above for whole days) */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <PresetChip label="+1 min" onClick={() => addOffset(1 * 60 * 1000)} />
            <PresetChip label="+5 min" onClick={() => addOffset(5 * 60 * 1000)} />
            <PresetChip label="+15 min" onClick={() => addOffset(15 * 60 * 1000)} />
            <PresetChip label="+1 hour" onClick={() => addOffset(60 * 60 * 1000)} />
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 bg-primary-500 hover:bg-primary-400 text-white rounded-lg text-sm transition-colors"
            >
              Done
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

function PresetChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs bg-dark-700 hover:bg-dark-600 text-dark-200 hover:text-white rounded-full transition-colors"
    >
      {label}
    </button>
  );
}
