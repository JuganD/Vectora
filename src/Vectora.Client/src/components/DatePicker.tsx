import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDate, useDateFormat, SYSTEM_FORMAT } from '../utils/dateFormat';

interface DatePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
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

export default function DatePicker({ value, onChange, placeholder = 'Pick date…', ariaLabel, title }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfDay(value ?? new Date()));
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Keep the calendar view in sync with the selected date.
  const valYear = value?.getFullYear();
  const valMonth = value?.getMonth();
  useEffect(() => {
    if (valYear != null && valMonth != null) setViewMonth(new Date(valYear, valMonth, 1));
  }, [valYear, valMonth]);

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

  const pickDay = (day: Date) => {
    onChange(startOfDay(day));
    setOpen(false);
  };

  const dateFormat = useDateFormat();
  const display = value
    ? dateFormat === SYSTEM_FORMAT
      ? value.toLocaleDateString()
      : formatDate(value, dateFormat)
    : '';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        title={title}
        className={`w-32 flex items-center gap-1.5 px-2 py-1 bg-dark-800 border rounded text-xs text-left transition-colors ${
          open ? 'border-primary-500/50 ring-1 ring-primary-500/30' : 'border-dark-700'
        } ${value ? 'text-dark-200' : 'text-dark-500'}`}
      >
        <Calendar className="w-3 h-3 text-dark-400 flex-shrink-0" />
        <span className="flex-1 truncate">{display || placeholder}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange(null); } }}
            className="text-dark-400 hover:text-dark-200 p-0.5 -mr-0.5 flex-shrink-0"
            title="Clear"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4"
          onMouseDown={e => e.target === e.currentTarget && e.button === 0 && setOpen(false)}
        >
          <div
            className="w-full max-w-[280px] bg-dark-800 border border-dark-600 rounded-xl shadow-2xl p-4 select-none"
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
                const selected = value && sameDay(day, value);
                const today = sameDay(day, new Date());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDay(day)}
                    className={`h-8 text-xs rounded-lg transition-colors flex items-center justify-center relative ${
                      selected
                        ? 'bg-primary-500 text-white font-semibold'
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
