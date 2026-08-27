import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Banknote,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Clock3,
  CreditCard,
  Download,
  Eye,
  ExternalLink,
  FileText,
  KeyRound,
  Layers3,
  LoaderCircle,
  Mail,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-payments.css';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { key: 'all', label: 'All payments' },
  { key: 'SUCCEEDED', label: 'Succeeded' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'REFUNDED', label: 'Refunded' },
];

const PURPOSE_OPTIONS = [
  { key: 'all', label: 'All purposes' },
  { key: 'BUY_CREDITS', label: 'Buy credits' },
  { key: 'DIRECT_UNLOCK', label: 'Direct unlock' },
  { key: 'ACCEPT_PUBLICATION', label: 'Accept publication' },
  { key: 'UNLOCK_PUBLICATION_ADVANCED', label: 'Publication advanced' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Payment date' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'paymentPurpose', label: 'Purpose' },
  { key: 'creditsAmount', label: 'Credits amount' },
];

const STATUS_META = {
  SUCCEEDED: { label: 'Succeeded', className: 'is-succeeded', icon: CheckCircle2 },
  PENDING: { label: 'Pending', className: 'is-pending', icon: Clock3 },
  FAILED: { label: 'Failed', className: 'is-failed', icon: XCircle },
  REFUNDED: { label: 'Refunded', className: 'is-refunded', icon: RotateCcw },
};

const PURPOSE_META = {
  BUY_CREDITS: { label: 'Buy credits', icon: Coins, tone: 'is-credits' },
  DIRECT_UNLOCK: { label: 'Direct unlock', icon: KeyRound, tone: 'is-unlock' },
  ACCEPT_PUBLICATION: { label: 'Accept publication', icon: BadgeCheck, tone: 'is-accept' },
  UNLOCK_PUBLICATION_ADVANCED: { label: 'Publication advanced', icon: Layers3, tone: 'is-advanced' },
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.payments)) return payload.payments;
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

function formatMoney(value, currency = 'USD') {
  const number = Number(value || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(number) ? number : 0);
  } catch {
    return `${Number.isFinite(number) ? number.toFixed(2) : '0.00'} ${currency || 'USD'}`;
  }
}

function shortId(value, length = 8) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length <= length + 2 ? text : `${text.slice(0, length)}…`;
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusInfo(status) {
  const key = String(status || '').toUpperCase();
  return STATUS_META[key] || { label: titleCase(key || 'Unknown'), className: 'is-pending', icon: Clock3 };
}

function purposeInfo(purpose) {
  const key = String(purpose || '').toUpperCase();
  return PURPOSE_META[key] || { label: titleCase(key || 'Payment'), icon: FileText, tone: 'is-generic' };
}

function dateBoundaryIso(value, endOfDay = false) {
  if (!value) return undefined;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [year, month, day] = parts;
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function statusCount(summary, key) {
  const mapping = {
    SUCCEEDED: 'successfulPayments',
    PENDING: 'pendingPayments',
    FAILED: 'failedPayments',
    REFUNDED: 'refundedPayments',
  };
  return Number(summary?.[mapping[key]] || 0);
}

function MetricCard({ icon: Icon, label, value, hint, tone = '', money = false, currency = 'USD' }) {
  return (
    <article className={`admin-payment-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-payment-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{money ? formatMoney(value, currency) : Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function StatusBadge({ status }) {
  const meta = statusInfo(status);
  const Icon = meta.icon;
  return (
    <span className={`admin-payment-status ${meta.className}`}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = SlidersHorizontal, counts = {} }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-payment-picker ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="admin-payment-picker__trigger"
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon size={15} />
        <span><small>{label}</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-payment-picker__menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === value}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {counts[option.key] !== undefined && <em>{Number(counts[option.key] || 0).toLocaleString()}</em>}
              {option.key === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
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
    <div className={`admin-payment-sort ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="admin-payment-sort__trigger" onClick={() => setOpen((state) => !state)}>
        <SlidersHorizontal size={15} />
        <span><small>Sort payments</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-payment-sort__menu" role="listbox">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === sortBy}
              className={option.key === sortBy ? 'is-active' : ''}
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

      <button
        type="button"
        className="admin-payment-sort__direction"
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
    <div className={`admin-payment-date-range ${active ? 'is-active' : ''}`}>
      <span className="admin-payment-date-range__icon" aria-hidden="true"><CalendarRange size={16} /></span>
      <label className="admin-payment-date-range__field">
        <small>From</small>
        <input
          type="date"
          value={fromDate}
          max={toDate || undefined}
          onChange={(event) => onFromChange(event.target.value)}
          aria-label="Payments from date"
        />
      </label>
      <span className="admin-payment-date-range__divider" aria-hidden="true" />
      <label className="admin-payment-date-range__field">
        <small>To</small>
        <input
          type="date"
          value={toDate}
          min={fromDate || undefined}
          onChange={(event) => onToChange(event.target.value)}
          aria-label="Payments to date"
        />
      </label>
      {active && (
        <button type="button" className="admin-payment-date-range__clear" onClick={onClear} aria-label="Clear date range">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono = false, wide = false, icon: Icon }) {
  return (
    <div className={`admin-payment-detail-item ${wide ? 'is-wide' : ''}`}>
      {Icon && <span className="admin-payment-detail-item__icon"><Icon size={14} /></span>}
      <div>
        <small>{label}</small>
        <strong className={mono ? 'is-mono' : ''}>{value || '—'}</strong>
      </div>
    </div>
  );
}

function PaymentModal({ payment, onClose }) {
  useEffect(() => {
    if (!payment) return undefined;
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
  }, [payment, onClose]);

  if (!payment) return null;

  const purpose = purposeInfo(payment.paymentPurpose);
  const PurposeIcon = purpose.icon;
  const amount = formatMoney(payment.amount, payment.currency);
  const customerName = payment.user?.fullName || 'Platform user';
  const customerEmail = payment.user?.email || '—';
  const status = String(payment.status || '').toUpperCase();
  const eventDate = status === 'SUCCEEDED'
    ? payment.paidAt
    : status === 'FAILED'
      ? payment.failedAt
      : status === 'REFUNDED'
        ? payment.refundedAt
        : null;

  return createPortal(
    <div className="admin-payment-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="admin-payment-modal" role="dialog" aria-modal="true" aria-label="Payment details">
        <header className="admin-payment-modal__head">
          <div className="admin-payment-modal__identity">
            <span className="admin-payment-modal__mark"><ReceiptText size={21} /></span>
            <div>
              <small>PAYMENT RECORD</small>
              <h3>{amount}</h3>
              <p>Transaction {shortId(payment.transactionReference || payment.id, 12)}</p>
            </div>
          </div>
          <button type="button" className="admin-payment-modal__close" onClick={onClose} aria-label="Close payment details">
            <X size={18} />
          </button>
        </header>

        <div className="admin-payment-modal__body">
          <aside className="admin-payment-modal__summary">
            <div className="admin-payment-modal__status-card">
              <span className={`admin-payment-modal__status-icon ${purpose.tone}`}><PurposeIcon size={17} /></span>
              <div>
                <small>PAYMENT PURPOSE</small>
                <strong>{purpose.label}</strong>
                <StatusBadge status={payment.status} />
              </div>
            </div>

            <div className="admin-payment-customer-card">
              <span><UserRound size={18} /></span>
              <div>
                <small>Customer</small>
                <strong>{customerName}</strong>
                <p><Mail size={12} /> {customerEmail}</p>
              </div>
            </div>

            <div className="admin-payment-amount-card">
              <small>Charged amount</small>
              <strong>{amount}</strong>
              <p>{payment.currency || 'USD'} via {titleCase(payment.paymentMethodKey || 'card')}</p>
            </div>

            <div className="admin-payment-readonly-note">
              <ShieldCheck size={16} />
              <div>
                <strong>Read-only financial record</strong>
                <span>Payment history is preserved for billing integrity and auditability.</span>
              </div>
            </div>
          </aside>

          <main className="admin-payment-modal__details">
            <div className="admin-payment-modal__section-head">
              <span><FileText size={17} /></span>
              <div>
                <small>TRANSACTION DETAILS</small>
                <h4>Payment, gateway and entitlement context</h4>
              </div>
            </div>

            <div className="admin-payment-detail-grid">
              <DetailItem label="Payment ID" value={payment.id} mono wide />
              <DetailItem label="Transaction reference" value={payment.transactionReference} mono wide />
              <DetailItem label="Status" value={statusInfo(payment.status).label} icon={statusInfo(payment.status).icon} />
              <DetailItem label="Purpose" value={purpose.label} icon={PurposeIcon} />
              <DetailItem label="Payment method" value={titleCase(payment.paymentMethodKey)} icon={CreditCard} />
              <DetailItem label="Provider" value={titleCase(payment.providerKey)} icon={ExternalLink} />
              <DetailItem label="Created" value={formatDate(payment.createdAt)} />
              <DetailItem label="Updated" value={formatDate(payment.updatedAt)} />
              {eventDate && <DetailItem label={`${statusInfo(status).label} at`} value={formatDate(eventDate)} wide />}
              {payment.providerPaymentId && <DetailItem label="Provider payment ID" value={payment.providerPaymentId} mono wide />}
              {payment.providerSessionId && <DetailItem label="Provider session ID" value={payment.providerSessionId} mono wide />}
            </div>

            {(payment.creditsAmount > 0 || payment.bonusCreditsAmount > 0 || payment.activatesPremium) && (
              <section className="admin-payment-modal__subsection">
                <div className="admin-payment-modal__subsection-title">
                  <WalletCards size={15} />
                  <span>Entitlement delivered</span>
                </div>
                <div className="admin-payment-mini-grid">
                  {payment.creditsAmount > 0 && (
                    <DetailItem label="Credits purchased" value={Number(payment.creditsAmount).toLocaleString()} />
                  )}
                  {payment.bonusCreditsAmount > 0 && (
                    <DetailItem label="Bonus credits" value={Number(payment.bonusCreditsAmount).toLocaleString()} />
                  )}
                  {payment.creditPriceAtPurchase != null && (
                    <DetailItem label="Credit unit price" value={formatMoney(payment.creditPriceAtPurchase, payment.currency)} />
                  )}
                  {payment.activatesPremium && (
                    <DetailItem label="Premium activation" value="Included" />
                  )}
                  {payment.premiumActivationFeeAtPurchase != null && (
                    <DetailItem label="Premium activation fee" value={formatMoney(payment.premiumActivationFeeAtPurchase, payment.currency)} />
                  )}
                </div>
              </section>
            )}

            {(payment.idea || payment.publicationId) && (
              <section className="admin-payment-modal__subsection">
                <div className="admin-payment-modal__subsection-title">
                  <Sparkles size={15} />
                  <span>Related content</span>
                </div>
                <div className="admin-payment-mini-grid">
                  {payment.idea && <DetailItem label="Idea" value={payment.idea.title || payment.idea.id} wide />}
                  {payment.publicationId && <DetailItem label="Publication ID" value={payment.publicationId} mono wide />}
                </div>
              </section>
            )}

            {payment.failureReason && (
              <section className="admin-payment-failure-box">
                <XCircle size={17} />
                <div>
                  <strong>Failure reason</strong>
                  <p>{payment.failureReason}</p>
                </div>
              </section>
            )}

            {payment.invoice && (
              <section className="admin-payment-modal__subsection">
                <div className="admin-payment-modal__subsection-title">
                  <FileText size={15} />
                  <span>Invoice</span>
                </div>
                <div className="admin-payment-mini-grid">
                  <DetailItem label="Invoice number" value={payment.invoice.invoiceNumber} mono />
                  <DetailItem label="Invoice status" value={titleCase(payment.invoice.status)} />
                </div>
              </section>
            )}
          </main>
        </div>

        <footer className="admin-payment-modal__footer">
          <span><ShieldCheck size={14} /> Financial activity is view-only from the operations console.</span>
          <button type="button" onClick={onClose}><X size={14} /> Close record</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminPaymentsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [charts, setCharts] = useState({});
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [purpose, setPurpose] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const dateQuery = useMemo(() => ({
    fromDate: dateBoundaryIso(fromDate, false),
    toDate: dateBoundaryIso(toDate, true),
  }), [fromDate, toDate]);

  const query = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
    status: status === 'all' ? undefined : status,
    paymentPurpose: purpose === 'all' ? undefined : purpose,
    sortBy,
    sortOrder,
    ...dateQuery,
  }), [page, search, status, purpose, sortBy, sortOrder, dateQuery]);

  const load = useCallback(async ({ fresh = false } = {}) => {
    if (fresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const listFn = fresh && adminApi.payments.listFresh
        ? adminApi.payments.listFresh
        : adminApi.payments.list;
      const summaryRequest = fresh && adminApi.payments.summaryFresh
        ? adminApi.payments.summaryFresh(dateQuery)
        : adminApi.payments.summary(dateQuery);
      const chartsRequest = fresh && adminApi.payments.chartsFresh
        ? adminApi.payments.chartsFresh(dateQuery)
        : adminApi.payments.charts(dateQuery);

      const listPayload = await listFn(query);
      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));

      if (!fresh) {
        setLoading(false);

        void Promise.allSettled([summaryRequest, chartsRequest]).then(
          ([summaryResult, chartsResult]) => {
            if (summaryResult.status === 'fulfilled') {
              setSummary(unwrapObject(summaryResult.value));
            }
            if (chartsResult.status === 'fulfilled') {
              setCharts(unwrapObject(chartsResult.value));
            }
          },
        );
      } else {
        const [summaryPayload, chartsPayload] = await Promise.all([
          summaryRequest.catch(() => ({})),
          chartsRequest.catch(() => ({})),
        ]);
        setSummary(unwrapObject(summaryPayload));
        setCharts(unwrapObject(chartsPayload));
      }
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load payment activity.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateQuery, query]);

  useEffect(() => {
    load();
  }, [load]);

  const statusCounts = useMemo(() => ({
    all: Number(summary.totalPayments || 0),
    SUCCEEDED: statusCount(summary, 'SUCCEEDED'),
    PENDING: statusCount(summary, 'PENDING'),
    FAILED: statusCount(summary, 'FAILED'),
    REFUNDED: statusCount(summary, 'REFUNDED'),
  }), [summary]);

  const purposeCounts = useMemo(() => {
    const counts = { all: Number(summary.totalPayments || 0) };
    const items = Array.isArray(charts.paymentsByPurpose) ? charts.paymentsByPurpose : [];
    items.forEach((item) => {
      const key = item.paymentPurpose || item.label;
      if (key) counts[key] = Number(item.count || 0);
    });
    return counts;
  }, [charts, summary.totalPayments]);

  const exportPayments = useCallback(async () => {
    setExporting(true);
    setError('');
    try {
      await adminApi.payments.exportCsv({
        search: search || undefined,
        status: status === 'all' ? undefined : status,
        paymentPurpose: purpose === 'all' ? undefined : purpose,
        sortBy,
        sortOrder,
        ...dateQuery,
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to export payments.'));
    } finally {
      setExporting(false);
    }
  }, [dateQuery, purpose, search, sortBy, sortOrder, status]);

  const startIndex = meta.total === 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
  const endIndex = Math.min(meta.total, meta.page * meta.limit);

  return (
    <div className="admin-page admin-payment-page">
      <section className="admin-payment-hero">
        <div className="admin-payment-hero__content">
          <span className="admin-payment-hero__eyebrow"><CircleDollarSign size={15} /> BILLING OPERATIONS</span>
          <h1>Payment <span>operations</span></h1>
          <p>Monitor transaction health, revenue, purchase purpose and gateway activity without exposing financial records to destructive actions.</p>

          <div className="admin-payment-hero__trust" aria-label="Payment workspace capabilities">
            <span><ShieldCheck size={14} /> Audit-safe ledger</span>
            <span><CreditCard size={14} /> Gateway visibility</span>
            <span><ReceiptText size={14} /> Transaction records</span>
          </div>
        </div>

        <div className="admin-payment-hero__scene" aria-hidden="true">
          <span className="admin-payment-scene-line admin-payment-scene-line--one" />
          <span className="admin-payment-scene-line admin-payment-scene-line--two" />
          <span className="admin-payment-scene-node admin-payment-scene-node--one" />
          <span className="admin-payment-scene-node admin-payment-scene-node--two" />
          <span className="admin-payment-scene-node admin-payment-scene-node--three" />

          <div className="admin-payment-hero-card">
            <div className="admin-payment-hero-card__top">
              <span className="admin-payment-hero-card__chip" />
              <WalletCards size={21} />
            </div>
            <span className="admin-payment-hero-card__number">•••• &nbsp; 2048 &nbsp; •••• &nbsp; 7281</span>
            <div className="admin-payment-hero-card__bottom">
              <span><small>PAYMENT FLOW</small><strong>Voxidence</strong></span>
              <span className="admin-payment-hero-card__badge"><Check size={14} /> Verified</span>
            </div>
          </div>

          <div className="admin-payment-hero-receipt">
            <span className="admin-payment-hero-receipt__icon"><ReceiptText size={18} /></span>
            <div><small>TRANSACTION</small><strong>Secure record</strong></div>
            <CheckCircle2 size={16} />
          </div>

          <div className="admin-payment-hero-coins">
            <span><Coins size={18} /></span>
            <div><small>REVENUE</small><strong>Tracked</strong></div>
          </div>

          <span className="admin-payment-scene-platform admin-payment-scene-platform--one" />
          <span className="admin-payment-scene-platform admin-payment-scene-platform--two" />
        </div>
      </section>

      <section className="admin-payment-panel">
        <header className="admin-payment-panel__head">
          <div>
            <span className="admin-payment-panel__kicker"><Banknote size={13} /> Payment ledger</span>
            <h3>Payment activity</h3>
            <p>{Number(summary.totalPayments || meta.total || 0).toLocaleString()} transactions recorded</p>
          </div>
          <div className="admin-payment-panel__actions">
            <span className="admin-payment-live"><i /> Live billing</span>
            <button type="button" className="admin-payment-action" onClick={() => load({ fresh: true })} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} /> Refresh
            </button>
            <button type="button" className="admin-payment-action" onClick={exportPayments} disabled={exporting}>
              {exporting ? <LoaderCircle size={15} className="is-spinning" /> : <Download size={15} />} Export CSV
            </button>
          </div>
        </header>

        <div className="admin-payment-metrics">
          <MetricCard
            icon={Banknote}
            label="Successful revenue"
            value={summary.totalRevenue}
            hint="Captured payment value"
            money
            tone="is-primary"
          />
          <MetricCard
            icon={CheckCircle2}
            label="Successful"
            value={summary.successfulPayments}
            hint={`${Number(summary.totalPayments || 0) ? Math.round((Number(summary.successfulPayments || 0) / Number(summary.totalPayments || 1)) * 100) : 0}% success rate`}
            tone="is-success"
          />
          <MetricCard
            icon={Clock3}
            label="Pending"
            value={summary.pendingPayments}
            hint="Awaiting final confirmation"
            tone="is-pending"
          />
          <MetricCard
            icon={XCircle}
            label="Failed"
            value={summary.failedPayments}
            hint={`${Number(summary.refundedPayments || 0).toLocaleString()} refunded`}
            tone="is-failed"
          />
        </div>

        <div className="admin-payment-status-tabs" role="tablist" aria-label="Payment status filters">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={status === option.key}
              className={status === option.key ? 'is-active' : ''}
              onClick={() => {
                setStatus(option.key);
                setPage(1);
              }}
            >
              <span>{option.label}</span>
              <em>{Number(statusCounts[option.key] || 0).toLocaleString()}</em>
            </button>
          ))}
        </div>

        <div className="admin-payment-controls">
          <SelectMenu
            label="Payment purpose"
            value={purpose}
            options={PURPOSE_OPTIONS}
            counts={purposeCounts}
            onChange={(next) => {
              setPurpose(next);
              setPage(1);
            }}
            icon={SlidersHorizontal}
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

          <label className="admin-payment-search">
            <Search size={17} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search customer name or email..."
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput('')} aria-label="Clear payment search"><X size={13} /></button>
            )}
          </label>
        </div>

        {error && <div className="admin-payment-error"><XCircle size={15} /> {error}</div>}

        <div className="admin-payment-table-shell">
          <table className="admin-payment-table">
            <colgroup>
              <col className="col-transaction" />
              <col className="col-customer" />
              <col className="col-payment" />
              <col className="col-purpose" />
              <col className="col-gateway" />
              <col className="col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Customer</th>
                <th>Payment</th>
                <th>Purpose</th>
                <th>Gateway</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="admin-payment-table-state"><td colSpan="6"><LoaderCircle size={18} className="is-spinning" /> Loading payment activity...</td></tr>
              ) : rows.length === 0 ? (
                <tr className="admin-payment-table-state"><td colSpan="6"><CircleDollarSign size={18} /> No payments match these filters.</td></tr>
              ) : rows.map((payment) => {
                const purposeMeta = purposeInfo(payment.paymentPurpose);
                const PurposeIcon = purposeMeta.icon;
                return (
                  <tr key={payment.id}>
                    <td>
                      <div className="admin-payment-transaction-cell">
                        <span className="admin-payment-row-icon">
                          <ReceiptText size={16} />
                          <i className={`admin-payment-row-icon__status ${statusInfo(payment.status).className}`} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>Payment {shortId(payment.id)}</strong>
                          <small>{payment.transactionReference ? `Ref ${shortId(payment.transactionReference, 11)}` : 'Internal reference'}</small>
                          <span className="admin-payment-transaction-date">{formatDate(payment.createdAt, true)}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-payment-customer-cell">
                        <strong>{payment.user?.fullName || 'Platform user'}</strong>
                        <small>{payment.user?.email || '—'}</small>
                      </div>
                    </td>
                    <td>
                      <div className="admin-payment-value-cell">
                        <strong>{formatMoney(payment.amount, payment.currency)}</strong>
                        <StatusBadge status={payment.status} />
                      </div>
                    </td>
                    <td>
                      <div className="admin-payment-purpose-cell">
                        <span className={`admin-payment-purpose-symbol ${purposeMeta.tone}`}><PurposeIcon size={13} /></span>
                        <div>
                          <strong>{purposeMeta.label}</strong>
                          <small>{payment.idea?.title || (payment.creditsAmount > 0 ? `${Number(payment.creditsAmount).toLocaleString()} credits` : 'Platform billing')}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-payment-gateway-cell">
                        <strong><CreditCard size={13} /> {titleCase(payment.paymentMethodKey)}</strong>
                        <small>{titleCase(payment.providerKey)}</small>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="admin-payment-inspect" onClick={() => setSelected(payment)}>
                        <Eye size={14} /> Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="admin-payment-pagination">
          <span>{meta.total ? `Showing ${startIndex}-${endIndex} of ${meta.total.toLocaleString()}` : 'No payment records'}</span>
          <div>
            <button type="button" disabled={meta.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft size={14} /> Previous
            </button>
            <em>Page {meta.page} of {meta.totalPages}</em>
            <button type="button" disabled={meta.page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      </section>

      <PaymentModal payment={selected} onClose={() => setSelected(null)} />
    </div>
  );
}