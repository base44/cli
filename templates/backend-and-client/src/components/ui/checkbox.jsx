import { forwardRef } from 'react';
import { Check } from 'lucide-react';

const Checkbox = forwardRef(({ className = '', checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={() => onCheckedChange?.(!checked)}
    className={`h-4 w-4 shrink-0 rounded-sm border border-slate-300 shadow-sm flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-slate-900 text-white border-slate-900' : 'bg-white'} ${className}`}
    {...props}
  >
    {checked && <Check className="h-3 w-3" />}
  </button>
));

Checkbox.displayName = 'Checkbox';

export { Checkbox };
