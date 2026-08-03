'use client';

import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// Drop-in replacement for <input type="password"> with a show/hide toggle.
// Wraps the input in a relative span so the toggle button anchors to its
// right edge; the input gets extra right padding so the eye icon never
// overlaps typed characters. Slots into existing gf-input-group markup —
// the outer Lock icon on the left keeps working because it's positioned
// against the outer group, not this inner wrap.
export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ style, ...props }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <span className="gf-pw-wrap">
        <input
          ref={ref}
          type={shown ? 'text' : 'password'}
          {...props}
          style={{ ...style, paddingRight: 40 }}
        />
        <button
          type="button"
          className="gf-pw-toggle"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          title={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff size={16} strokeWidth={1.9} /> : <Eye size={16} strokeWidth={1.9} />}
        </button>
      </span>
    );
  },
);
