import {
  ArrowDown,
  ArrowUp,
  BadgePlus,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Eye,
  FileText,
  Gift,
  History,
  LoaderCircle,
  Mail,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-credits.css';

const PAGE_SIZE = 20;

const TYPE_OPTIONS = [
  { key: 'all', label: 'All movements', icon: History },
  { key: 'PURCHASE', label: 'Purchased', icon: WalletCards },
  { key: 'BONUS', label: 'Bonus', icon: Gift },
  { key: 'DEDUCTION_GENERATION', label: 'Generation', icon: Sparkles },
  { key: 'DEDUCTION_PUBLICATION_ADVANCED', label: 'Publication advanced', icon: FileText },
  { key: 'REFUND', label: 'Refunded', icon: RotateCcw },
  { key: 'ADMIN_ADJUSTMENT', label: 'Admin adjustment', icon: ShieldCheck },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Transaction date' },
  { key: 'amount', label: 'Credit amount' },
  { key: 'balanceAfter', label: 'Balance after' },
  { key: 'type', label: 'Movement type' },
];

const TYPE_META = {
  PURCHASE: {
    label: 'Purchase',
    detail: 'Credits purchased',
    icon: WalletCards,
    tone: 'is-purchase',
  },
  BONUS: {
    label: 'Bonus',
    detail: 'Bonus credits',
    icon: Gift,
    tone: 'is-bonus',
  },
  DEDUCTION_GENERATION: {
    label: 'Generation',
    detail: 'Idea generation',
    icon: Sparkles,
    tone: 'is-deduction',
  },
  DEDUCTION_PUBLICATION_ADVANCED: {
    label: 'Publication advanced',
    detail: 'Advanced publication outputs',
    icon: FileText,
    tone: 'is-deduction',
  },
  REFUND: {
    label: 'Refund',
    detail: 'Credits returned',
    icon: RotateCcw,
    tone: 'is-refund',
  },
  ADMIN_ADJUSTMENT: {
    label: 'Admin adjustment',
    detail: 'Administrative balance change',
    icon: ShieldCheck,
    tone: 'is-admin',
  },
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.transactions)) return payload.transactions;
  if (Array.isArray(payload.users)) return payload.users;
  if (isObject(payload.data)) {
    const nested = Object.values(payload.data).find(Array.isArray);
    if (nested) return nested;
  }
  return [];
}

function unwrapMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
  const total = Number(source.total ?? source.totalItems ?? payload?.total ?? count) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(
    1,
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(limit, 1))) || 1,
  );
  return { total, page, limit, totalPages };
}

function unwrapObject(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
}

function formatDate(value, compact = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (compact) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortId(value, length = 9) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length <= length + 2 ? text : `${text.slice(0, length)}…`;
}

function dateBoundaryIso(value, endOfDay = false) {
  if (!value) return undefined;
  const parts = String(value).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date.toISOString();
}

function typeInfo(type) {
  const key = String(type || '').toUpperCase();
  return TYPE_META[key] || {
    label: String(type || 'Credit movement').replaceAll('_', ' '),
    detail: 'Credit ledger movement',
    icon: Coins,
    tone: 'is-generic',
  };
}

function signedAmount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString()}`;
}

function contextLabel(transaction) {
  if (transaction.idea?.title) return transaction.idea.title;
  if (transaction.publicationAcceptance?.publication?.publicTitle) {
    return transaction.publicationAcceptance.publication.publicTitle;
  }
  if (transaction.payment?.id) return `Payment ${shortId(transaction.payment.id, 8)}`;
  if (transaction.description) return transaction.description;
  return typeInfo(transaction.type).detail;
}

function movementDirection(amount) {
  const numeric = Number(amount || 0);
  if (numeric > 0) return 'is-positive';
  if (numeric < 0) return 'is-negative';
  return 'is-neutral';
}

function TypeBadge({ type }) {
  const meta = typeInfo(type);
  const Icon = meta.icon;
  return (
    <span className={`admin-credit-type-badge ${meta.tone}`}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function SortControl({ sortBy, sortOrder, onChange, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = SORT_OPTIONS.find((option) => option.key === sortBy) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="admin-credit-sort" ref={ref}>
      <div className="admin-credit-sort__picker">
        <button
          type="button"
          className="admin-credit-sort__trigger"
          onClick={() => setOpen((state) => !state)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <SlidersHorizontal size={15} />
          <span><small>SORT LEDGER</small><strong>{current.label}</strong></span>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="admin-credit-sort__menu">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === sortBy ? 'is-active' : ''}
                aria-pressed={option.key === sortBy}
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.key === sortBy && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="admin-credit-sort__direction"
        onClick={onToggle}
        title={sortOrder === 'asc' ? 'Ascending order' : 'Descending order'}
      >
        {sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function DateRangeFilter({ fromDate, toDate, onFromChange, onToChange, onClear }) {
  const active = Boolean(fromDate || toDate);
  return (
    <div className={`admin-credit-date-range ${active ? 'is-active' : ''}`}>
      <span className="admin-credit-date-range__icon"><CalendarRange size={16} /></span>
      <label>
        <small>From</small>
        <input
          type="date"
          value={fromDate}
          max={toDate || undefined}
          onChange={(event) => onFromChange(event.target.value)}
          aria-label="Credits from date"
        />
      </label>
      <i />
      <label>
        <small>To</small>
        <input
          type="date"
          value={toDate}
          min={fromDate || undefined}
          onChange={(event) => onToChange(event.target.value)}
          aria-label="Credits to date"
        />
      </label>
      {active && (
        <button type="button" onClick={onClear} aria-label="Clear credit date range">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono = false, wide = false, icon: Icon }) {
  return (
    <article className={`admin-credit-detail ${wide ? 'is-wide' : ''}`}>
      {Icon && <span><Icon size={14} /></span>}
      <div>
        <small>{label}</small>
        <strong className={mono ? 'is-mono' : ''}>{value || '—'}</strong>
      </div>
    </article>
  );
}

function CreditDetailModal({ transaction, onClose, onAdjust }) {
  useEffect(() => {
    if (!transaction) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [transaction, onClose]);

  if (!transaction) return null;

  const meta = typeInfo(transaction.type);
  const Icon = meta.icon;
  const userName = transaction.user?.fullName || 'Platform user';
  const userEmail = transaction.user?.email || '—';

  return createPortal(
    <div
      className="admin-credit-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="admin-credit-modal" role="dialog" aria-modal="true" aria-label="Credit transaction details">
        <header className="admin-credit-modal__head">
          <div className="admin-credit-modal__identity">
            <span className={`admin-credit-modal__mark ${movementDirection(transaction.amount)}`}><Coins size={21} /></span>
            <div>
              <small>CREDIT LEDGER RECORD</small>
              <h3>{signedAmount(transaction.amount)} credits</h3>
              <p>Transaction {shortId(transaction.id, 13)}</p>
            </div>
          </div>
          <button type="button" className="admin-credit-modal__close" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </header>

        <div className="admin-credit-modal__body">
          <aside className="admin-credit-modal__summary">
            <div className="admin-credit-modal__movement-card">
              <span className={`admin-credit-modal__type-icon ${meta.tone}`}><Icon size={18} /></span>
              <div>
                <small>MOVEMENT TYPE</small>
                <strong>{meta.label}</strong>
                <p>{meta.detail}</p>
              </div>
            </div>

            <div className="admin-credit-user-card">
              <span><UserRound size={18} /></span>
              <div>
                <small>User</small>
                <strong>{userName}</strong>
                <p><Mail size={12} /> {userEmail}</p>
              </div>
            </div>

            <div className="admin-credit-balance-card">
              <small>Balance after transaction</small>
              <strong>{Number(transaction.balanceAfter || 0).toLocaleString()}</strong>
              <p>credits remaining at this ledger point</p>
            </div>

            <div className="admin-credit-audit-note">
              <ShieldCheck size={16} />
              <div>
                <strong>Audited ledger entry</strong>
                <span>Transactions stay immutable. Balance corrections create a new admin adjustment.</span>
              </div>
            </div>
          </aside>

          <main className="admin-credit-modal__details">
            <div className="admin-credit-modal__section-head">
              <span><FileText size={17} /></span>
              <div>
                <small>LEDGER CONTEXT</small>
                <h4>Movement, source and related activity</h4>
              </div>
            </div>

            <div className="admin-credit-detail-grid">
              <DetailItem label="Transaction ID" value={transaction.id} mono wide />
              <DetailItem label="Amount" value={`${signedAmount(transaction.amount)} credits`} icon={transaction.amount >= 0 ? PlusCircle : MinusCircle} />
              <DetailItem label="Balance after" value={`${Number(transaction.balanceAfter || 0).toLocaleString()} credits`} icon={Coins} />
              <DetailItem label="Created" value={formatDate(transaction.createdAt)} icon={CalendarRange} />
              <DetailItem label="User ID" value={transaction.user?.id} mono />
              <DetailItem label="Movement type" value={meta.label} icon={Icon} />
              {transaction.payment && (
                <>
                  <DetailItem label="Payment ID" value={transaction.payment.id} mono />
                  <DetailItem label="Payment amount" value={String(transaction.payment.amount ?? '—')} icon={WalletCards} />
                  <DetailItem label="Payment method" value={transaction.payment.paymentMethodKey || '—'} />
                  <DetailItem label="Payment status" value={transaction.payment.status || '—'} />
                </>
              )}
              {transaction.idea && (
                <>
                  <DetailItem label="Idea" value={transaction.idea.title} wide icon={Sparkles} />
                  <DetailItem label="Idea ID" value={transaction.idea.id} mono wide />
                </>
              )}
              {transaction.publicationAcceptance?.publication && (
                <>
                  <DetailItem label="Publication" value={transaction.publicationAcceptance.publication.publicTitle} wide icon={FileText} />
                  <DetailItem label="Publication ID" value={transaction.publicationAcceptance.publication.id} mono wide />
                </>
              )}
              <DetailItem label="Description" value={transaction.description || 'No description recorded.'} wide icon={FileText} />
            </div>

            <footer className="admin-credit-modal__footer">
              <button type="button" className="admin-credit-modal__secondary" onClick={onClose}>Close</button>
              <button
                type="button"
                className="admin-credit-modal__primary"
                onClick={() => {
                  onClose();
                  onAdjust(transaction.user);
                }}
              >
                <BadgePlus size={16} />
                Adjust this user
              </button>
            </footer>
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function AdjustCreditsModal({ open, initialUser, onClose, onSaved }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(initialUser || null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedUser(initialUser || null);
    setQuery(initialUser?.email || initialUser?.fullName || '');
    setAmount('');
    setDescription('');
    setError('');
  }, [open, initialUser]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || selectedUser) return undefined;
    const timer = window.setTimeout(async () => {
      setLoadingUsers(true);
      try {
        const payload = await adminApi.users.list({
          page: 1,
          limit: 8,
          search: query.trim() || undefined,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        setUsers(unwrapRows(payload));
      } catch {
        setUsers([]);
      } finally {
        setLoadingUsers(false);
      }
    }, query.trim() ? 240 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, selectedUser]);

  if (!open) return null;

  const numericAmount = Number(amount);
  const canSave = selectedUser && Number.isInteger(numericAmount) && numericAmount !== 0 && description.trim().length >= 5 && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminApi.credits.adjust({
        userId: selectedUser.id,
        amount: numericAmount,
        description: description.trim(),
      });
      onSaved(result);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to adjust this credit balance.'));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="admin-credit-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="admin-credit-adjust-modal" role="dialog" aria-modal="true" aria-label="Adjust user credits">
        <header className="admin-credit-adjust-modal__head">
          <div>
            <span className="admin-credit-adjust-modal__mark"><BadgePlus size={20} /></span>
            <span>
              <small>ADMINISTRATIVE CREDIT ACTION</small>
              <h3>Adjust user credits</h3>
              <p>Add or deduct credits while preserving a full ledger and audit trail.</p>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close adjustment"><X size={18} /></button>
        </header>

        <div className="admin-credit-adjust-modal__body">
          <section className="admin-credit-adjust-user">
            <div className="admin-credit-adjust-section-title">
              <span><UserRound size={16} /></span>
              <div><small>STEP 1</small><strong>Select user</strong></div>
            </div>

            {selectedUser ? (
              <div className="admin-credit-selected-user">
                <span><UserRound size={18} /></span>
                <div>
                  <strong>{selectedUser.fullName || 'Platform user'}</strong>
                  <p>{selectedUser.email || '—'}</p>
                  {selectedUser.creditBalance !== undefined && (
                    <small>{Number(selectedUser.creditBalance || 0).toLocaleString()} current credits</small>
                  )}
                </div>
                <button type="button" onClick={() => {
                  setSelectedUser(null);
                  setQuery('');
                }}>Change</button>
              </div>
            ) : (
              <>
                <label className="admin-credit-user-search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search user name or email..."
                    autoFocus
                  />
                  {loadingUsers && <LoaderCircle size={15} className="is-spinning" />}
                </label>
                <div className="admin-credit-user-results">
                  {users.map((user) => (
                    <button key={user.id} type="button" onClick={() => setSelectedUser(user)}>
                      <span><UserRound size={15} /></span>
                      <div>
                        <strong>{user.fullName || 'Platform user'}</strong>
                        <small>{user.email || '—'}</small>
                      </div>
                      <em>{Number(user.creditBalance || 0).toLocaleString()} credits</em>
                    </button>
                  ))}
                  {!loadingUsers && users.length === 0 && (
                    <div className="admin-credit-user-empty">No matching users found.</div>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="admin-credit-adjust-fields">
            <div className="admin-credit-adjust-section-title">
              <span><Coins size={16} /></span>
              <div><small>STEP 2</small><strong>Define balance change</strong></div>
            </div>

            <div className="admin-credit-adjust-amounts">
              <button
                type="button"
                className={numericAmount > 0 ? 'is-active is-add' : ''}
                onClick={() => setAmount((current) => String(Math.abs(Number(current || 1))))}
              >
                <PlusCircle size={16} /> Add credits
              </button>
              <button
                type="button"
                className={numericAmount < 0 ? 'is-active is-deduct' : ''}
                onClick={() => setAmount((current) => String(-Math.abs(Number(current || 1))))}
              >
                <MinusCircle size={16} /> Deduct credits
              </button>
            </div>

            <label className="admin-credit-adjust-input">
              <span>Signed amount</span>
              <div><Coins size={16} /><input type="number" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 10 or -5" /></div>
              <small>Positive values add credits. Negative values deduct credits.</small>
            </label>

            <label className="admin-credit-adjust-input">
              <span>Administrative reason</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, 500))}
                placeholder="Explain why this balance adjustment is required..."
              />
              <small>{description.length}/500 · minimum 5 characters</small>
            </label>

            {error && <div className="admin-credit-adjust-error">{error}</div>}
          </section>
        </div>

        <footer className="admin-credit-adjust-modal__footer">
          <div>
            <ShieldCheck size={16} />
            <span>This action creates a new ADMIN_ADJUSTMENT ledger entry.</span>
          </div>
          <span className="admin-credit-adjust-modal__actions">
            <button type="button" className="is-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="is-save" disabled={!canSave} onClick={submit}>
              {saving ? <LoaderCircle size={16} className="is-spinning" /> : <BadgePlus size={16} />}
              Save adjustment
            </button>
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminCreditsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [typeCounts, setTypeCounts] = useState({});
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustUser, setAdjustUser] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const baseFilters = useMemo(() => ({
    search: search || undefined,
    type: type === 'all' ? undefined : type,
    fromDate: dateBoundaryIso(fromDate, false),
    toDate: dateBoundaryIso(toDate, true),
  }), [search, type, fromDate, toDate]);

  const listParams = useMemo(() => ({
    ...baseFilters,
    page,
    limit: PAGE_SIZE,
    sortBy,
    sortOrder,
  }), [baseFilters, page, sortBy, sortOrder]);

  const analyticsFilters = useMemo(() => ({
    search: search || undefined,
    fromDate: dateBoundaryIso(fromDate, false),
    toDate: dateBoundaryIso(toDate, true),
  }), [search, fromDate, toDate]);

  const load = useCallback(async ({ fresh = false, quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const listRequest = fresh && adminApi.credits.listFresh
        ? adminApi.credits.listFresh(listParams)
        : adminApi.credits.list(listParams);
      const summaryRequest = fresh && adminApi.credits.summaryFresh
        ? adminApi.credits.summaryFresh(analyticsFilters)
        : adminApi.credits.summary(analyticsFilters);
      const chartsRequest = fresh && adminApi.credits.chartsFresh
        ? adminApi.credits.chartsFresh(analyticsFilters)
        : adminApi.credits.charts(analyticsFilters);

      const listPayload = await listRequest;
      const listRows = unwrapRows(listPayload);
      setRows(listRows);
      setMeta(unwrapMeta(listPayload, listRows.length));

      const applyAnalytics = (summaryPayload, chartsPayload) => {
        setSummary(unwrapObject(summaryPayload));

        const chart = unwrapObject(chartsPayload);
        const counts = {};
        const items = Array.isArray(chart.transactionsByType) ? chart.transactionsByType : [];
        items.forEach((item) => {
          counts[String(item.type || item.label || '').toUpperCase()] = Number(item.count || 0);
        });
        setTypeCounts(counts);
      };

      if (!fresh) {
        if (!quiet) setLoading(false);

        void Promise.allSettled([summaryRequest, chartsRequest]).then(
          ([summaryResult, chartsResult]) => {
            applyAnalytics(
              summaryResult.status === 'fulfilled' ? summaryResult.value : {},
              chartsResult.status === 'fulfilled' ? chartsResult.value : {},
            );
          },
        );
      } else {
        const [summaryPayload, chartsPayload] = await Promise.all([
          summaryRequest.catch(() => ({})),
          chartsRequest.catch(() => ({})),
        ]);
        applyAnalytics(summaryPayload, chartsPayload);
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load the credit ledger.'));
    } finally {
      setLoading(false);
    }
  }, [analyticsFilters, listParams]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load({ fresh: true, quiet: true });
    setRefreshing(false);
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      await adminApi.credits.exportCsv({ ...baseFilters, sortBy, sortOrder });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to export the credit ledger.'));
    } finally {
      setExporting(false);
    }
  };

  const openAdjustment = (user = null) => {
    setAdjustUser(user || null);
    setAdjustOpen(true);
  };

  const handleAdjustmentSaved = async (result) => {
    setAdjustOpen(false);
    setNotice(result?.message || 'Credit balance adjusted successfully.');
    window.setTimeout(() => setNotice(''), 3600);
    await load({ fresh: true, quiet: true });
  };

  const visibleTotal = meta.total;
  const allCount = Object.values(typeCounts).reduce((sum, count) => sum + Number(count || 0), 0) || summary.totalTransactions || 0;

  return (
    <div className="admin-page admin-credit-page">
      <section className="admin-hero admin-credit-hero">
        <div className="admin-hero__eyebrow"><Coins size={15} /> CREDIT OPERATIONS</div>
        <h2>Credit ledger</h2>
        <p>Review every credit movement, inspect its source, filter the ledger and apply audited administrative balance adjustments.</p>
      </section>

      <section className="admin-credit-panel">
        <header className="admin-credit-panel__head">
          <div>
            <span className="admin-credit-panel__kicker"><History size={12} /> CREDIT LEDGER</span>
            <h3>Credit movements</h3>
            <p>{visibleTotal.toLocaleString()} matching transaction{visibleTotal === 1 ? '' : 's'}</p>
          </div>
          <div className="admin-credit-panel__actions">
            <span className="admin-credit-live"><i /> Live ledger</span>
            <button type="button" className="admin-credit-action" onClick={exportCsv} disabled={exporting}>
              {exporting ? <LoaderCircle size={14} className="is-spinning" /> : <Download size={14} />}
              Export CSV
            </button>
            <button type="button" className="admin-credit-action" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} />
              Refresh
            </button>
            <button type="button" className="admin-credit-action is-primary" onClick={() => openAdjustment()}>
              <BadgePlus size={15} />
              Adjust credits
            </button>
          </div>
        </header>

        <div className="admin-credit-metrics">
          <article className="admin-credit-metric is-primary">
            <i />
            <span className="admin-credit-metric__icon"><WalletCards size={19} /></span>
            <div><small>Purchased credits</small><strong>{Number(summary.purchasedCredits || 0).toLocaleString()}</strong><span>Credits added through purchases</span></div>
          </article>
          <article className="admin-credit-metric">
            <i />
            <span className="admin-credit-metric__icon"><MinusCircle size={19} /></span>
            <div><small>Consumed credits</small><strong>{Number(summary.deductedCredits || 0).toLocaleString()}</strong><span>Generation and publication usage</span></div>
          </article>
          <article className="admin-credit-metric is-bonus">
            <i />
            <span className="admin-credit-metric__icon"><Gift size={19} /></span>
            <div><small>Bonus credits</small><strong>{Number(summary.bonusCredits || 0).toLocaleString()}</strong><span>{Number(summary.refundedCredits || 0).toLocaleString()} refunded credits</span></div>
          </article>
          <article className="admin-credit-metric is-admin">
            <i />
            <span className="admin-credit-metric__icon"><ShieldCheck size={19} /></span>
            <div><small>Admin adjustments</small><strong>{Number(summary.adminAdjustments || 0).toLocaleString()}</strong><span>Net audited manual adjustment</span></div>
          </article>
        </div>

        <div className="admin-credit-type-tabs">
          {TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const count = option.key === 'all' ? allCount : Number(typeCounts[option.key] || 0);
            return (
              <button
                key={option.key}
                type="button"
                className={type === option.key ? 'is-active' : ''}
                onClick={() => {
                  setType(option.key);
                  setPage(1);
                }}
              >
                <Icon size={13} />
                {option.label}
                <em>{count.toLocaleString()}</em>
              </button>
            );
          })}
        </div>

        <div className="admin-credit-controls">
          <SortControl
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={(next) => {
              setSortBy(next);
              setPage(1);
            }}
            onToggle={() => {
              setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
          />

          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromChange={(next) => {
              setFromDate(next);
              if (next && toDate && next > toDate) setToDate(next);
              setPage(1);
            }}
            onToChange={(next) => {
              setToDate(next);
              if (next && fromDate && next < fromDate) setFromDate(next);
              setPage(1);
            }}
            onClear={() => {
              setFromDate('');
              setToDate('');
              setPage(1);
            }}
          />

          <label className="admin-credit-search">
            <Search size={17} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search user name or email..."
            />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={13} /></button>}
          </label>
        </div>

        {error && <div className="admin-credit-error">{error}</div>}
        {notice && <div className="admin-credit-notice"><Check size={15} /> {notice}</div>}

        <div className="admin-credit-table-wrap">
          <table className="admin-credit-table">
            <colgroup>
              <col className="is-transaction" />
              <col className="is-user" />
              <col className="is-movement" />
              <col className="is-context" />
              <col className="is-balance" />
              <col className="is-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>User</th>
                <th>Movement</th>
                <th>Context</th>
                <th>Balance after</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6"><div className="admin-credit-table-state"><LoaderCircle size={20} className="is-spinning" /> Loading credit ledger...</div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="6"><div className="admin-credit-table-state"><Coins size={20} /> No credit movements match these filters.</div></td></tr>
              ) : rows.map((transaction) => {
                const info = typeInfo(transaction.type);
                const TypeIcon = info.icon;
                const direction = movementDirection(transaction.amount);
                return (
                  <tr key={transaction.id}>
                    <td>
                      <div className="admin-credit-transaction-cell">
                        <span className={`admin-credit-transaction-icon ${direction}`}>
                          <Coins size={17} />
                          <i />
                        </span>
                        <div>
                          <strong>Credit {shortId(transaction.id, 8)}</strong>
                          <small>{formatDate(transaction.createdAt, true)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-credit-user-cell">
                        <strong>{transaction.user?.fullName || 'Platform user'}</strong>
                        <small>{transaction.user?.email || '—'}</small>
                      </div>
                    </td>
                    <td>
                      <div className={`admin-credit-movement-cell ${direction}`}>
                        <strong>{signedAmount(transaction.amount)}</strong>
                        <small>credits</small>
                      </div>
                    </td>
                    <td>
                      <div className="admin-credit-context-cell">
                        <span className={`admin-credit-context-icon ${info.tone}`}><TypeIcon size={15} /></span>
                        <div>
                          <TypeBadge type={transaction.type} />
                          <small title={contextLabel(transaction)}>{contextLabel(transaction)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-credit-balance-cell">
                        <strong>{Number(transaction.balanceAfter || 0).toLocaleString()}</strong>
                        <small>credits</small>
                      </div>
                    </td>
                    <td>
                      <div className="admin-credit-row-actions">
                        <button type="button" onClick={() => setSelected(transaction)} title="Inspect transaction"><Eye size={15} /><span>Inspect</span></button>
                        <button type="button" className="is-adjust" onClick={() => openAdjustment(transaction.user)} title="Adjust user credits"><BadgePlus size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="admin-credit-pagination">
          <span>Showing page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} records</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /> Previous</button>
            <strong>Page {page}</strong>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>Next <ChevronRight size={15} /></button>
          </div>
        </footer>
      </section>

      <CreditDetailModal transaction={selected} onClose={() => setSelected(null)} onAdjust={openAdjustment} />
      <AdjustCreditsModal
        open={adjustOpen}
        initialUser={adjustUser}
        onClose={() => {
          setAdjustOpen(false);
          setAdjustUser(null);
        }}
        onSaved={handleAdjustmentSaved}
      />
    </div>
  );
}