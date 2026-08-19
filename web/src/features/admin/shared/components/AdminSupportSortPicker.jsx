import {
    ArrowDown,
    ArrowUp,
    BadgeCheck,
    ChevronDown,
    SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

export default function AdminSupportSortPicker({
    label,
    value,
    order,
    options,
    onChange,
    onToggleOrder,
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const menuId = useId();
    const current = options.find((option) => option.value === value) ?? options[0];

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

    return (
        <div ref={rootRef} className={`admin-support-sort-picker ${open ? 'is-open' : ''}`}>
            <button
                type="button"
                className="admin-support-sort-picker__trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen((currentOpen) => !currentOpen)}
            >
                <SlidersHorizontal size={14} />
                <span>
                    <small>{label}</small>
                    <strong>{current?.label ?? value}</strong>
                </span>
                <ChevronDown className="admin-support-sort-picker__chevron" size={14} />
            </button>

            {open ? (
                <div id={menuId} className="admin-support-sort-picker__menu" role="listbox" aria-label={label}>
                    {options.map((option) => {
                        const active = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={active}
                                className={active ? 'is-active' : ''}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                            >
                                <span>{option.label}</span>
                                {active ? <BadgeCheck size={13} /> : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <button
                type="button"
                className="admin-support-sort-picker__direction"
                onClick={onToggleOrder}
                aria-label="Toggle sort direction"
            >
                {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            </button>
        </div>
    );
}