/**
 * Polished custom select used by administrator support workspaces.
 * Avoids the browser-native option menu so status and priority choices
 * remain visually consistent with the Voxidence admin interface.
 */
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export default function AdminSupportSelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const closeOnOutsidePress = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const choose = (nextValue) => {
    if (disabled) return;
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`admin-support-choice ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="admin-support-choice__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`admin-support-choice__tone ${selected?.tone || 'is-neutral'}`} aria-hidden="true" />
        <span className="admin-support-choice__label">{selected?.label ?? value}</span>
        <ChevronDown className="admin-support-choice__chevron" size={17} />
      </button>

      {open ? (
        <div id={listId} className="admin-support-choice__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`admin-support-choice__option ${active ? 'is-selected' : ''}`}
                onClick={() => choose(option.value)}
              >
                <span className={`admin-support-choice__tone ${option.tone || 'is-neutral'}`} aria-hidden="true" />
                <span className="admin-support-choice__option-copy">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <span className="admin-support-choice__check" aria-hidden="true">{active ? <Check size={15} /> : null}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
