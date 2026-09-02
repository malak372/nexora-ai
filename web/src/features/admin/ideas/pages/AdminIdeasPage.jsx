import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileText,
  Flag,
  Globe2,
  Lightbulb,
  MessageSquareText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  Star,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Unlock,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import { useUserExperience } from '../../../../system/user-experience';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ideas.css';
import '../styles/admin-publication-insights.css';


const ADMIN_IDEAS_AR = Object.freeze({
  'All ideas': 'كل الأفكار',
  'Published': 'منشورة',
  'Locked': 'مقفلة',
  'Unlocked': 'مفتوحة',
  'Created date': 'تاريخ الإنشاء',
  'Idea title': 'عنوان الفكرة',
  'Owner': 'المالك',
  'Domain': 'المجال',
  'Generation type': 'نوع التوليد',
  'Access': 'الوصول',
  'Publication': 'النشر',
  'Sort ideas': 'ترتيب الأفكار',
  'Idea intelligence': 'ذكاء الأفكار',
  'Ideas, without the spreadsheet feeling.': 'أفكار، بلا تعقيد جداول البيانات.',
  'Filter access states, find published work, inspect ownership and open any idea in a focused admin view.': 'صفِّ حالات الوصول، واعثر على الأفكار المنشورة، وافحص الملكية، وافتح أي فكرة ضمن عرض إداري مركّز.',
  'Live directory': 'دليل مباشر',
  'Directory': 'الدليل',
  'records': 'سجل',
  'published': 'منشورة',
  'ideas': 'فكرة',
  'platform total': 'إجمالي المنصة',
  'visible to community': 'ظاهرة للمجتمع',
  'advanced access closed': 'الوصول المتقدم مغلق',
  'advanced access available': 'الوصول المتقدم متاح',
  'IDEA DIRECTORY': 'دليل الأفكار',
  'Explore platform ideas': 'استكشاف أفكار المنصة',
  'Live administrative records': 'سجلات إدارية مباشرة',
  'Refresh': 'تحديث',
  'Export CSV': 'تصدير CSV',
  'Idea filters': 'عوامل تصفية الأفكار',
  'Search title or problem…': 'ابحث في العنوان أو المشكلة…',
  'Search ideas': 'البحث في الأفكار',
  'Clear search': 'مسح البحث',
  'Idea': 'الفكرة',
  'Generation': 'التوليد',
  'Created': 'الإنشاء',
  'Actions': 'الإجراءات',
  'Updating ideas…': 'جارٍ تحديث الأفكار…',
  'No ideas match this view': 'لا توجد أفكار تطابق هذا العرض',
  'Try another filter or search phrase.': 'جرّب عامل تصفية أو عبارة بحث أخرى.',
  'Try again': 'إعادة المحاولة',
  'Page': 'الصفحة',
  'of': 'من',
  'Previous': 'السابق',
  'Next': 'التالي',
  'Publication insights and reports': 'إحصاءات النشر والبلاغات',
  'Close publication insights': 'إغلاق إحصاءات النشر',
  'PUBLISHED IDEA': 'فكرة منشورة',
  'Publication insights': 'إحصاءات النشر',
  'Loading publication activity…': 'جارٍ تحميل نشاط النشر…',
  'ratings': 'تقييمات',
  'upvotes': 'أصوات مؤيدة',
  'downvotes': 'أصوات معارضة',
  'feedback': 'ملاحظات',
  'reports': 'بلاغات',
  'Publication snapshot': 'لقطة النشر',
  'Public copy and current community settings.': 'النسخة العامة وإعدادات المجتمع الحالية.',
  'Status': 'الحالة',
  'Visibility': 'الظهور',
  'Voting': 'التصويت',
  'Ratings': 'التقييمات',
  'Feedback': 'الملاحظات',
  'Enabled': 'مفعّل',
  'Disabled': 'معطّل',
  'Recent community feedback': 'أحدث ملاحظات المجتمع',
  'Latest written feedback visible on this publication.': 'أحدث الملاحظات المكتوبة الظاهرة على هذا المنشور.',
  'Community member': 'عضو في المجتمع',
  'No written feedback yet.': 'لا توجد ملاحظات مكتوبة بعد.',
  'Reports on this publication': 'البلاغات على هذا المنشور',
  'Review every report without leaving the idea directory.': 'راجع كل بلاغ دون مغادرة دليل الأفكار.',
  'Reporter': 'المبلّغ',
  'Response to reporter': 'الرد على المبلّغ',
  'Write the moderation response that the reporter should receive…': 'اكتب رد الإشراف الذي يجب أن يصل إلى المبلّغ…',
  'Dismiss': 'تجاهل',
  'Resolve & reply': 'حلّ ورد',
  'Reviewed by administration.': 'تمت مراجعته من الإدارة.',
  'No reports were submitted for this publication.': 'لم تُقدَّم بلاغات على هذا المنشور.',
  'Publication moderation': 'إشراف النشر',
  'Unpublishing stays out of the table and is available only after reviewing context.': 'إلغاء النشر متاح فقط بعد مراجعة السياق، وليس من الجدول مباشرة.',
  'Unpublish': 'إلغاء النشر',
  'IDEA INSPECTOR': 'فاحص الفكرة',
  'Idea details': 'تفاصيل الفكرة',
  'Close idea details': 'إغلاق تفاصيل الفكرة',
  'Untitled idea': 'فكرة بلا عنوان',
  'Not published': 'غير منشورة',
  'Loading idea details…': 'جارٍ تحميل تفاصيل الفكرة…',
  'Pipeline': 'خط المعالجة',
  'Unknown': 'غير معروف',
  'Unlock method': 'طريقة الفتح',
  'None': 'لا يوجد',
  'Region': 'المنطقة',
  'Any region': 'أي منطقة',
  'Problem statement': 'بيان المشكلة',
  'No problem statement is available for this record.': 'لا يتوفر بيان مشكلة لهذا السجل.',
  'Abstract': 'الملخص',
  'No abstract is available for this record.': 'لا يتوفر ملخص لهذا السجل.',
  'Objectives': 'الأهداف',
  'No objectives available.': 'لا تتوفر أهداف.',
  'Target users': 'المستخدمون المستهدفون',
  'No target-user information available.': 'لا تتوفر معلومات عن المستخدمين المستهدفين.',
  'Generation status': 'حالة التوليد',
  'Stage': 'المرحلة',
  'Progress': 'التقدم',
  'Started': 'بدأت',
  'Record': 'السجل',
  'Idea ID': 'معرّف الفكرة',
  'Outputs': 'المخرجات',
  'Payments': 'المدفوعات',
  'Remove this idea from community discovery and automatically notify its publisher.': 'أزل هذه الفكرة من استكشاف المجتمع وأبلغ ناشرها تلقائيًا.',
  'Unpublish idea': 'إلغاء نشر الفكرة',
  'PUBLICATION MODERATION': 'إشراف النشر',
  'Unpublish this idea?': 'إلغاء نشر هذه الفكرة؟',
  'will disappear from community discovery. The publication record and its history will stay preserved.': 'ستختفي من استكشاف المجتمع، مع الاحتفاظ بسجل النشر وتاريخه.',
  'Publisher notification is automatic': 'إشعار الناشر يتم تلقائيًا',
  'will receive an in-app admin alert containing the reason below.': 'سيتلقى تنبيهًا إداريًا داخل التطبيق يتضمن السبب أدناه.',
  'Reason for unpublishing': 'سبب إلغاء النشر',
  'Example: The publication contains information that should be corrected before it is visible to the community.': 'مثال: يحتوي المنشور على معلومات يجب تصحيحها قبل أن تظهر للمجتمع.',
  'This reason is included in the publisher alert.': 'سيتم تضمين هذا السبب في تنبيه الناشر.',
  'Keep published': 'إبقاؤها منشورة',
  'Unpublishing…': 'جارٍ إلغاء النشر…',
  'Unpublish & notify': 'إلغاء النشر والإشعار',
  'Guest session': 'جلسة ضيف',
  'Unknown owner': 'مالك غير معروف',
  'Guest idea': 'فكرة ضيف',
  'No email': 'لا يوجد بريد إلكتروني',
  'Unassigned': 'غير معيّن',
  'Idea record': 'سجل فكرة',
  'Open idea details': 'فتح تفاصيل الفكرة',
  'Completed': 'مكتمل',
  'Active': 'نشط',
  'Succeeded': 'ناجح',
  'Failed': 'فشل',
  'Cancelled': 'ملغى',
  'Rejected': 'مرفوض',
  'Running': 'قيد التشغيل',
  'Preparing': 'قيد التحضير',
  'Pending': 'قيد الانتظار',
  'Queued': 'في قائمة الانتظار',
  'Reviewing': 'قيد المراجعة',
  'Resolved': 'تم الحل',
  'Dismissed': 'تم التجاهل',
  'Public': 'عام',
  'Private': 'خاص',
  'Text Only': 'نص فقط',
  'Domains Only': 'مجالات فقط',
  'Text And Domains': 'نص ومجالات',
  'Free': 'مجاني',
  'Premium': 'بريميوم',
  'Credit': 'رصيد',
  'Please enter a clear reason of at least 3 characters.': 'يرجى إدخال سبب واضح من 3 أحرف على الأقل.',
  'Write a short response before resolving or dismissing the report.': 'اكتب ردًا قصيرًا قبل حل البلاغ أو تجاهله.',
  'Publication removed from community discovery. The publisher was notified.': 'تمت إزالة المنشور من استكشاف المجتمع وإشعار الناشر.',
  'Report resolved and reporter notified.': 'تم حل البلاغ وإشعار المبلّغ.',
  'Report dismissed and reporter notified.': 'تم تجاهل البلاغ وإشعار المبلّغ.',
  'The publication snapshot could not be refreshed. Reports are still available.': 'تعذر تحديث لقطة النشر، لكن البلاغات ما زالت متاحة.',
  'Reports could not be refreshed. Publication insights are still available.': 'تعذر تحديث البلاغات، لكن إحصاءات النشر ما زالت متاحة.',
  'Could not load ideas.': 'تعذر تحميل الأفكار.',
  'Could not load the idea details.': 'تعذر تحميل تفاصيل الفكرة.',
  'Publication insights could not be loaded.': 'تعذر تحميل إحصاءات النشر.',
  'Could not review this report.': 'تعذر مراجعة هذا البلاغ.',
  'Could not unpublish this idea.': 'تعذر إلغاء نشر هذه الفكرة.',
  'CSV export failed.': 'فشل تصدير CSV.',
  'Close': 'إغلاق',
});

function translateAdminIdeas(text, isArabic) {
  if (!isArabic || text == null) return text;
  return ADMIN_IDEAS_AR[String(text)] || text;
}

const PAGE_SIZE = 20;

const FILTERS = [
  { key: 'all', label: 'All ideas', icon: Sparkles },
  { key: 'published', label: 'Published', icon: Globe2 },
  { key: 'locked', label: 'Locked', icon: LockKeyhole },
  { key: 'unlocked', label: 'Unlocked', icon: Unlock },
];


const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Created date' },
  { key: 'title', label: 'Idea title' },
  { key: 'owner', label: 'Owner' },
  { key: 'domain', label: 'Domain' },
  { key: 'generationType', label: 'Generation type' },
  { key: 'isUnlocked', label: 'Access' },
  { key: 'publication', label: 'Publication' },
];

function IdeaSortPicker({ value, order, onChange, onToggleOrder, tr }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((option) => option.key === value) || SORT_OPTIONS[0];

  return (
    <div className={`admin-ideas-sort-picker ${open ? 'is-open' : ''}`}>
      <button type="button" className="admin-ideas-sort-picker__trigger" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} />
        <span><small>{tr('Sort ideas')}</small><strong>{tr(current.label)}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="admin-ideas-sort-picker__menu">
          {SORT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.key}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => { onChange(option.key); setOpen(false); }}
            >
              <span>{tr(option.label)}</span>
              {option.key === value ? <CheckCircle2 size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="admin-ideas-sort-picker__direction" onClick={onToggleOrder}>
        {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  );
}


const nf = new Intl.NumberFormat('en-US');
const fmt = (value) => nf.format(Number(value || 0));

function getItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || {};
  const total = Number(source.total ?? payload?.total ?? count) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Number(source.totalPages ?? Math.ceil(total / Math.max(1, limit))) || 1),
  };
}

function formatDate(value, withTime = false, isArabic = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const locale = isArabic ? 'ar-JO' : 'en-US';
  return withTime
    ? date.toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(value) {
  return String(value || '—')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getOwner(idea) {
  return idea?.user?.fullName || idea?.user?.email || idea?.userEmail || (idea?.guestSession ? 'Guest session' : 'Unknown owner');
}

function getOwnerMeta(idea) {
  return idea?.user?.email || (idea?.guestSession ? 'Guest idea' : 'No email');
}

function getDomain(idea) {
  return idea?.domain?.name || idea?.domain || 'Unassigned';
}

function firstWords(value, count = 2) {
  return String(value || '').trim().split(/\s+/).slice(0, count).join(' ');
}

function isPublished(idea) {
  return String(idea?.publication?.status || '').toUpperCase() === 'PUBLISHED';
}

function statusTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (['COMPLETED', 'PUBLISHED', 'ACTIVE', 'SUCCEEDED'].includes(normalized)) return 'is-success';
  if (['FAILED', 'CANCELLED', 'REJECTED'].includes(normalized)) return 'is-danger';
  if (['RUNNING', 'PREPARING', 'PENDING', 'QUEUED'].includes(normalized)) return 'is-warning';
  return 'is-neutral';
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'mint', delay = 0 }) {
  return (
    <article className={`admin-ideas-metric admin-ideas-metric--${tone}`} style={{ '--delay': `${delay}ms` }}>
      <span className="admin-ideas-metric__icon"><Icon size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{fmt(value)}</strong>
        <span>{hint}</span>
      </div>
      <i aria-hidden="true" />
    </article>
  );
}

function IdeasSkeleton() {
  return (
    <div className="admin-ideas-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="admin-ideas-skeleton__row" key={index}>
          <span /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

function DetailBlock({ icon: Icon, label, children, className = '' }) {
  return (
    <section className={`admin-idea-detail-block ${className}`}>
      <header><span><Icon size={16} /></span><h4>{label}</h4></header>
      <div>{children}</div>
    </section>
  );
}


const IDEA_CARD_TONES = ['mint', 'sage', 'teal', 'rose'];

function getIdeaCardTone(index) {
  return IDEA_CARD_TONES[index % IDEA_CARD_TONES.length];
}

export default function AdminIdeasPage() {
  const { isArabic } = useUserExperience();
  const tr = useCallback((text) => translateAdminIdeas(text, isArabic), [isArabic]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [moderationTarget, setModerationTarget] = useState(null);
  const [moderationReason, setModerationReason] = useState('');
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationError, setModerationError] = useState('');
  const [notice, setNotice] = useState('');
  const [insightTarget, setInsightTarget] = useState(null);
  const [insightReports, setInsightReports] = useState([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [reportReplies, setReportReplies] = useState({});
  const [reportBusyId, setReportBusyId] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: PAGE_SIZE,
      sortBy,
      sortOrder,
    };
    if (search) params.search = search;
    if (activeFilter === 'locked') params.isUnlocked = 'false';
    if (activeFilter === 'unlocked') params.isUnlocked = 'true';
    return params;
  }, [activeFilter, page, search, sortBy, sortOrder]);

  const summaryParams = useMemo(() => ({}), []);

  const load = useCallback(async ({ quiet = false, force = false } = {}) => {
    const requestId = ++requestIdRef.current;

    if (quiet) setRefreshing(true);
    else setLoading(true);

    setError('');

    setSummaryLoading(true);

    const listPromise = activeFilter === 'published'
      ? (force
        ? adminApi.ideas.publishedListFresh(queryParams)
        : adminApi.ideas.publishedList(queryParams))
      : (force
        ? adminApi.ideas.listFresh(queryParams)
        : adminApi.ideas.list(queryParams));

    const summaryPromise = force
      ? adminApi.ideas.summaryFresh(summaryParams)
      : adminApi.ideas.summary(summaryParams);

    summaryPromise
      .then((payload) => {
        if (requestId === requestIdRef.current) setSummary(payload);
      })
      .catch(() => {
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setSummaryLoading(false);
      });

    try {
      const listPayload = await listPromise;
      if (requestId !== requestIdRef.current) return;

      const nextRows = getItems(listPayload);
      setRows(nextRows);
      setMeta(getMeta(listPayload, nextRows.length));
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;

      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load ideas.'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeFilter, queryParams, summaryParams]);

  useEffect(() => {
    load();
  }, [load]);

  const chooseFilter = (key) => {
    if (key === activeFilter) return;
    setActiveFilter(key);
    setPage(1);
  };


  const applySort = (field) => {
    if (field === sortBy) {
      setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder(field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };


  const openIdea = async (idea) => {
    const id = idea?.id;
    if (!id) return;
    setSelected(idea);
    setDetailError('');
    setDetailLoading(true);
    try {
      const payload = await adminApi.ideas.quickDetail(id);
      const detail = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
      if (detail && typeof detail === 'object') setSelected({ ...idea, ...detail });
    } catch (requestError) {
      setDetailError(getApiErrorMessage(requestError, 'Could not load the idea details.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeIdea = () => {
    setSelected(null);
    setDetailError('');
    setDetailLoading(false);
  };

  useEffect(() => {
    if (!selected) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeIdea();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selected]);

  const summarySource = summary?.data && typeof summary.data === 'object' ? summary.data : summary || {};
  const totalIdeas = summarySource.totalIdeas ?? meta.total;
  const publishedIdeas = summarySource.publications?.publishedIdeas ?? 0;
  const lockedIdeas = summarySource.access?.lockedIdeas ?? 0;
  const unlockedIdeas = summarySource.access?.unlockedIdeas ?? 0;

  const requestUnpublish = (idea) => {
    const publicationId = idea?.publication?.id;
    if (!publicationId) return;
    setModerationTarget(idea);
    setModerationReason('');
    setModerationError('');
  };

  const closeModeration = () => {
    if (moderationLoading) return;
    setModerationTarget(null);
    setModerationReason('');
    setModerationError('');
  };

  const confirmUnpublish = async () => {
    const reason = moderationReason.trim();
    const publicationId = moderationTarget?.publication?.id;
    if (!publicationId) return;
    if (reason.length < 3) {
      setModerationError('Please enter a clear reason of at least 3 characters.');
      return;
    }

    setModerationLoading(true);
    setModerationError('');
    try {
      await adminApi.publications.unpublish(publicationId, reason);
      setNotice('Publication removed from community discovery. The publisher was notified.');
      if (selected?.id === moderationTarget?.id) closeIdea();
      if (insightTarget?.id === moderationTarget?.id) {
        setInsightTarget(null);
        setInsightReports([]);
      }
      setModerationTarget(null);
      setModerationReason('');
      await load({ quiet: true, force: true });
      window.setTimeout(() => setNotice(''), 4200);
    } catch (requestError) {
      setModerationError(getApiErrorMessage(requestError, 'Could not unpublish this idea.'));
    } finally {
      setModerationLoading(false);
    }
  };

  const openPublicationInsights = async (idea) => {
    const publicationId = idea?.publication?.id;
    if (!publicationId || !idea?.id) return;


    setInsightTarget(idea);
    setInsightReports([]);
    setInsightError('');
    setInsightLoading(true);

    const [insightResult, reportsResult] = await Promise.allSettled([
      adminApi.ideas.publicationInsights(idea.id),
      adminApi.publicationReports.listForPublication(publicationId, {
        page: 1,
        limit: 20,
      }),
    ]);

    if (insightResult.status === 'fulfilled') {
      const payload = insightResult.value;
      const detail =
        payload?.data && !Array.isArray(payload.data)
          ? payload.data
          : payload;

      if (detail && typeof detail === 'object') {
        setInsightTarget((current) => ({
          ...(current || idea),
          ...detail,
        }));
      }
    }

    if (reportsResult.status === 'fulfilled') {
      setInsightReports(getItems(reportsResult.value));
    }

    if (
      insightResult.status === 'rejected' &&
      reportsResult.status === 'rejected'
    ) {
      setInsightError(
        getApiErrorMessage(
          insightResult.reason || reportsResult.reason,
          'Publication insights could not be loaded.',
        ),
      );
    } else if (insightResult.status === 'rejected') {
      setInsightError('The publication snapshot could not be refreshed. Reports are still available.');
    } else if (reportsResult.status === 'rejected') {
      setInsightError('Reports could not be refreshed. Publication insights are still available.');
    }

    setInsightLoading(false);
  };

  const closePublicationInsights = useCallback(() => {
    if (reportBusyId) return;

    setInsightTarget(null);
    setInsightReports([]);
    setInsightError('');
    setReportReplies({});
  }, [reportBusyId]);

  const reviewInsightReport = async (report, status) => {
    const reply = String(reportReplies[report.id] || '').trim();

    if (reply.length < 3) {
      setInsightError('Write a short response before resolving or dismissing the report.');
      return;
    }

    setReportBusyId(report.id);
    setInsightError('');

    try {
      const result = await adminApi.publicationReports.review(report.id, {
        status,
        adminNote: reply,
        reporterMessage: reply,
        moderationAction: 'NONE',
      });

      setInsightReports((current) =>
        current.map((item) =>
          item.id === report.id
            ? {
              ...item,
              status: result?.report?.status || status,
              adminNote: result?.report?.adminNote || reply,
              reviewedAt: result?.report?.reviewedAt || new Date().toISOString(),
            }
            : item,
        ),
      );

      setReportReplies((current) => ({ ...current, [report.id]: '' }));
      setNotice(`Report ${status.toLowerCase()} and reporter notified.`);
      window.setTimeout(() => setNotice(''), 3500);
    } catch (requestError) {
      setInsightError(
        getApiErrorMessage(requestError, 'Could not review this report.'),
      );
    } finally {
      setReportBusyId('');
    }
  };

  useEffect(() => {
    if (!insightTarget) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closePublicationInsights();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [insightTarget, closePublicationInsights]);

  const handleExport = async () => {
    try {
      setRefreshing(true);
      if (activeFilter === 'published') await adminApi.ideas.exportPublishedCsv({ search });
      else await adminApi.ideas.exportCsv({ ...queryParams, page: undefined, limit: undefined });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'CSV export failed.'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="admin-page admin-ideas-page">
      <section className="admin-ideas-hero">
        <div className="admin-ideas-hero__copy">
          <div className="admin-hero__eyebrow"><Sparkles size={14} /> {tr('Idea intelligence')}</div>
          <h2>{tr('Ideas')}</h2>
          <p>{tr('Filter access states, find published work, inspect ownership and open any idea in a focused admin view.')}</p>
          <div className="admin-ideas-hero__chips">
            <span><i /> {tr('Live directory')}</span>
            <span><Lightbulb size={13} /> {fmt(meta.total)} {tr('records')}</span>
            <span><Globe2 size={13} /> {summaryLoading ? '…' : `${fmt(publishedIdeas)} ${tr('published')}`}</span>
          </div>
        </div>
        <div className="admin-ideas-hero__visual" aria-hidden="true">
          <div className="admin-ideas-visual-stage">
            <span className="admin-ideas-visual-stage__halo admin-ideas-visual-stage__halo--one" />
            <span className="admin-ideas-visual-stage__halo admin-ideas-visual-stage__halo--two" />
            <span className="admin-ideas-visual-stage__glow" />

            <div className="admin-ideas-float-card admin-ideas-float-card--records">
              <span><FileText size={15} /></span>
              <div><small>{tr('Directory')}</small><strong>{fmt(meta.total)} {tr('records')}</strong></div>
            </div>

            <div className="admin-ideas-float-card admin-ideas-float-card--published">
              <span><Globe2 size={15} /></span>
              <div><small>{tr('Published')}</small><strong>{fmt(publishedIdeas)}</strong></div>
            </div>

            <div className="admin-ideas-float-card admin-ideas-float-card--locked">
              <span><LockKeyhole size={15} /></span>
              <div><small>{tr('Locked')}</small><strong>{fmt(lockedIdeas)}</strong></div>
            </div>

            <div className="admin-ideas-float-card admin-ideas-float-card--unlocked">
              <span><Unlock size={15} /></span>
              <div><small>{tr('Unlocked')}</small><strong>{fmt(unlockedIdeas)}</strong></div>
            </div>

            <div className="admin-ideas-orbit">
              <span className="admin-ideas-orbit__ring" />
              <span className="admin-ideas-orbit__ring admin-ideas-orbit__ring--two" />
              <span className="admin-ideas-orbit__ring admin-ideas-orbit__ring--three" />
              <div className="admin-ideas-orbit__core">
                <span className="admin-ideas-orbit__bulb"><Lightbulb size={25} /></span>
                <strong>{fmt(totalIdeas)}</strong>
                <small>{tr('ideas')}</small>
              </div>
              <span className="admin-ideas-orbit__track admin-ideas-orbit__track--one"><i className="admin-ideas-orbit__node" /></span>
              <span className="admin-ideas-orbit__track admin-ideas-orbit__track--two"><i className="admin-ideas-orbit__node" /></span>
              <span className="admin-ideas-orbit__track admin-ideas-orbit__track--three"><i className="admin-ideas-orbit__node" /></span>
            </div>

            <div className="admin-ideas-stage-base">
              <span />
            </div>
          </div>
        </div>
      </section>

      <section className="admin-ideas-metrics">
        <MetricCard icon={Sparkles} label={tr('All ideas')} value={totalIdeas} hint={tr('platform total')} tone="mint" delay={0} />
        <MetricCard icon={Globe2} label={tr('Published')} value={publishedIdeas} hint={tr('visible to community')} tone="aqua" delay={45} />
        <MetricCard icon={LockKeyhole} label={tr('Locked')} value={lockedIdeas} hint={tr('advanced access closed')} tone="rose" delay={90} />
        <MetricCard icon={Unlock} label={tr('Unlocked')} value={unlockedIdeas} hint={tr('advanced access available')} tone="sage" delay={135} />
      </section>

      <section className="admin-ideas-workspace">
        <header className="admin-ideas-workspace__head">
          <div>
            <span className="admin-ideas-workspace__kicker">{tr('IDEA DIRECTORY')}</span>
            <h3>{tr('Explore platform ideas')}</h3>
            <p>{meta.total ? (isArabic ? `${fmt(meta.total)} فكرة مطابقة` : `${fmt(meta.total)} matching ideas`) : tr('Live administrative records')}</p>
          </div>
          <div className="admin-toolbar">
            <button className="admin-btn" type="button" onClick={() => load({ quiet: true, force: true })} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> {tr('Refresh')}
            </button>
            <button className="admin-btn" type="button" onClick={handleExport} disabled={refreshing}>
              <Download size={14} /> {tr('Export CSV')}
            </button>
          </div>
        </header>

        {notice ? (
          <div className="admin-ideas-notice"><BadgeCheck size={17} /><span>{tr(notice)}</span></div>
        ) : null}

        <div className="admin-ideas-controls">
          <div className="admin-ideas-filters" role="tablist" aria-label={tr('Idea filters')}>
            {FILTERS.map(({ key, label, icon: FilterIcon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeFilter === key}
                className={activeFilter === key ? 'is-active' : ''}
                onClick={() => chooseFilter(key)}
              >
                <FilterIcon size={14} />
                <span>{tr(label)}</span>
              </button>
            ))}
          </div>

          <div className="admin-ideas-control-right">
            <IdeaSortPicker
              value={sortBy}
              order={sortOrder}
              onChange={(field) => {
                setSortBy(field);
                setSortOrder(field === 'createdAt' ? 'desc' : 'asc');
                setPage(1);
              }}
              tr={tr}
              onToggleOrder={() => {
                setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc'));
                setPage(1);
              }}
            />

            <label className="admin-ideas-search">
              <Search size={16} />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={tr('Search title or problem…')}
                aria-label={tr('Search ideas')}
              />
              {searchInput ? <button type="button" onClick={() => setSearchInput('')} aria-label={tr('Clear search')}><X size={14} /></button> : null}
            </label>
          </div>
        </div>

        {error ? (
          <div className="admin-ideas-error"><AlertCircle size={18} /><span>{tr(error)}</span><button type="button" onClick={() => load()}>{tr('Try again')}</button></div>
        ) : null}

        {loading && rows.length === 0 && !error ? <IdeasSkeleton /> : rows.length ? (
          <div className={`admin-ideas-card-section ${loading ? 'is-updating' : ''}`}>
            {loading ? <div className="admin-ideas-inline-loader"><LoaderCircle size={15} className="admin-spin" /> {tr('Updating ideas…')}</div> : null}

            <div className="admin-ideas-column-bar" role="group" aria-label={isArabic ? 'أعمدة الأفكار القابلة للترتيب' : 'Sortable idea columns'}>
              {[
                ['title', 'Idea'],
                ['owner', 'Owner'],
                ['domain', 'Domain'],
                ['generationType', 'Generation'],
                ['isUnlocked', 'Access'],
                ['publication', 'Publication'],
                ['createdAt', 'Created'],
              ].map(([field, label]) => {
                const active = sortBy === field;
                const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <button
                    key={field}
                    type="button"
                    className={`admin-ideas-column-bar__item ${active ? 'is-active' : ''}`}
                    onClick={() => applySort(field)}
                  >
                    <span>{tr(label)}</span>
                    <Icon size={12} />
                  </button>
                );
              })}
              <div className="admin-ideas-column-bar__item is-static"><span>{tr('Actions')}</span></div>
            </div>

            <div className="admin-ideas-card-grid">
              {rows.map((idea, index) => {
                const runStatus = idea?.generationRun?.status;
                const tone = getIdeaCardTone(index);
                return (
                  <article
                    key={idea.id}
                    className={`admin-idea-card admin-idea-card--${tone}`}
                    onClick={() => openIdea(idea)}
                    tabIndex={0}
                    onKeyDown={(event) => { if (event.key === 'Enter') openIdea(idea); }}
                  >
                    <div className="admin-idea-card__hero">
                      <div className="admin-idea-card__lead">
                        <span className="admin-idea-card__mark"><Lightbulb size={18} /></span>
                        <div className="admin-idea-card__title-wrap">
                          <h4 data-idea-content="true" dir="auto">{idea.title || tr('Untitled idea')}</h4>
                          <small><i className={`admin-idea-status-dot ${statusTone(runStatus)}`} />{tr(runStatus ? titleCase(runStatus) : 'Idea record')}</small>
                        </div>
                      </div>

                      <div className="admin-idea-card__owner">
                        <span className="admin-idea-card__owner-avatar">{String(getOwner(idea)).charAt(0).toUpperCase()}</span>
                        <div>
                          <label>{tr('Owner')}</label>
                          <strong data-idea-content="true" dir="auto">{tr(getOwner(idea))}</strong>
                          <small data-idea-content="true" dir="auto">{tr(getOwnerMeta(idea))}</small>
                        </div>
                      </div>
                    </div>

                    <div className="admin-idea-card__meta-grid">
                      <div>
                        <span>{tr('Domain')}</span>
                        <strong className="admin-idea-chip admin-idea-chip--soft" data-idea-content="true" dir="auto">{firstWords(tr(getDomain(idea)), 2)}</strong>
                      </div>
                      <div>
                        <span>{tr('Generation')}</span>
                        <strong className="admin-idea-chip admin-idea-chip--soft">{tr(titleCase(idea.generationType))}</strong>
                      </div>
                      <div>
                        <span>{tr('Access')}</span>
                        <strong className={`admin-idea-chip ${idea.isUnlocked ? 'admin-idea-chip--success' : 'admin-idea-chip--danger'}`}>
                          {idea.isUnlocked ? <Unlock size={12} /> : <LockKeyhole size={12} />}
                          {tr(idea.isUnlocked ? 'Unlocked' : 'Locked')}
                        </strong>
                      </div>
                      <div>
                        <span>{tr('Publication')}</span>
                        <strong className={`admin-idea-chip ${isPublished(idea) ? 'admin-idea-chip--success' : 'admin-idea-chip--soft'}`}>
                          {isPublished(idea) ? <Globe2 size={12} /> : <FileText size={12} />}
                          {tr(isPublished(idea) ? 'Published' : 'Not published')}
                        </strong>
                      </div>
                      <div>
                        <span>{tr('Created')}</span>
                        <strong className="admin-idea-card__date"><CalendarDays size={13} /> {formatDate(idea.createdAt, false, isArabic)}</strong>
                      </div>
                    </div>

                    <div className="admin-idea-card__footer">
                      <span>{tr('Actions')}</span>
                      <div className="admin-idea-card__actions">
                        {isPublished(idea) ? (
                          <button
                            type="button"
                            className="admin-idea-insights-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              openPublicationInsights(idea);
                            }}
                            title={tr('Publication insights and reports')}
                            aria-label={tr('Publication insights')}
                          >
                            <Sparkles size={15} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="admin-idea-open-btn admin-idea-open-btn--modern"
                          onClick={(event) => { event.stopPropagation(); openIdea(idea); }}
                          title={tr('Open idea details')}
                          aria-label={isArabic ? `فتح تفاصيل ${idea.title || 'الفكرة'}` : `Open ${idea.title || 'idea'} details`}
                        >
                          <Eye size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : !error ? (
          <div className="admin-ideas-empty"><Search size={24} /><strong>{tr('No ideas match this view')}</strong><span>{tr('Try another filter or search phrase.')}</span></div>
        ) : null}

        {!loading && meta.totalPages > 1 ? (
          <footer className="admin-ideas-pagination">
            <span>{tr('Page')} {meta.page} {tr('of')} {meta.totalPages} · {fmt(meta.total)} {tr('records')}</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> {tr('Previous')}</button>
              <button type="button" disabled={page >= meta.totalPages} onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}>{tr('Next')} <ChevronRight size={15} /></button>
            </div>
          </footer>
        ) : null}
      </section>

      {insightTarget ? createPortal(
        <div
          className="admin-publication-insights-backdrop"
          role="presentation"
          onMouseDown={closePublicationInsights}
        >
          <aside
            className="admin-publication-insights-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={tr('Publication insights and reports')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="admin-publication-insights-drawer__header">
              <div>
                <span><Globe2 size={14} /> {tr('PUBLISHED IDEA')}</span>
                <h3 data-idea-content="true" dir="auto">{insightTarget?.publication?.publicTitle || insightTarget?.title || tr('Publication insights')}</h3>
                <p data-idea-content="true" dir="auto">{tr(getOwner(insightTarget))} · {tr(getDomain(insightTarget))}</p>
              </div>
              <button type="button" onClick={closePublicationInsights} aria-label={tr('Close publication insights')}>
                <X size={18} />
              </button>
            </header>

            {insightLoading ? (
              <div className="admin-publication-insights-loading">
                <LoaderCircle className="admin-spin" size={20} />
                {tr('Loading publication activity…')}
              </div>
            ) : null}

            {insightError ? (
              <div className="admin-publication-insights-error">
                <AlertCircle size={16} />
                <span>{tr(insightError)}</span>
              </div>
            ) : null}

            {!insightLoading ? (
              <div className="admin-publication-insights-drawer__body">
                <section className="admin-publication-signal-strip">
                  <div>
                    <Star size={16} />
                    <strong>{Number(insightTarget?.publication?.averageRating || 0).toFixed(1)}</strong>
                    <span>{fmt(insightTarget?.publication?.ratingsCount)} {tr('ratings')}</span>
                  </div>
                  <div>
                    <ThumbsUp size={16} />
                    <strong>{fmt(insightTarget?.publication?.upvotesCount)}</strong>
                    <span>{tr('upvotes')}</span>
                  </div>
                  <div>
                    <ThumbsDown size={16} />
                    <strong>{fmt(insightTarget?.publication?.downvotesCount)}</strong>
                    <span>{tr('downvotes')}</span>
                  </div>
                  <div>
                    <MessageSquareText size={16} />
                    <strong>{fmt(insightTarget?.publication?.feedbackCount)}</strong>
                    <span>{tr('feedback')}</span>
                  </div>
                  <div>
                    <Flag size={16} />
                    <strong>{fmt(insightReports.length)}</strong>
                    <span>{tr('reports')}</span>
                  </div>
                </section>

                <section className="admin-publication-insights-section">
                  <header>
                    <div>
                      <span><FileText size={15} /></span>
                      <div>
                        <h4>{tr('Publication snapshot')}</h4>
                        <p>{tr('Public copy and current community settings.')}</p>
                      </div>
                    </div>
                  </header>

                  <dl className="admin-publication-snapshot">
                    <div><dt>{tr('Status')}</dt><dd>{tr(titleCase(insightTarget?.publication?.status))}</dd></div>
                    <div><dt>{tr('Visibility')}</dt><dd>{tr(titleCase(insightTarget?.publication?.visibility))}</dd></div>
                    <div><dt>{tr('Published')}</dt><dd>{formatDate(insightTarget?.publication?.publishedAt, true, isArabic)}</dd></div>
                    <div><dt>{tr('Voting')}</dt><dd>{tr(insightTarget?.publication?.allowVoting ? 'Enabled' : 'Disabled')}</dd></div>
                    <div><dt>{tr('Ratings')}</dt><dd>{tr(insightTarget?.publication?.allowRatings ? 'Enabled' : 'Disabled')}</dd></div>
                    <div><dt>{tr('Feedback')}</dt><dd>{tr(insightTarget?.publication?.allowFeedback ? 'Enabled' : 'Disabled')}</dd></div>
                  </dl>

                  {insightTarget?.publication?.publicAbstract ? (
                    <p className="admin-publication-public-copy" data-idea-content="true" dir="auto">
                      {insightTarget.publication.publicAbstract}
                    </p>
                  ) : null}
                </section>

                <section className="admin-publication-insights-section">
                  <header>
                    <div>
                      <span><MessageSquareText size={15} /></span>
                      <div>
                        <h4>{tr('Recent community feedback')}</h4>
                        <p>{tr('Latest written feedback visible on this publication.')}</p>
                      </div>
                    </div>
                    <strong>{fmt(insightTarget?.publication?.feedback?.length)}</strong>
                  </header>

                  <div className="admin-publication-feedback-list">
                    {Array.isArray(insightTarget?.publication?.feedback) && insightTarget.publication.feedback.length ? (
                      insightTarget.publication.feedback.slice(0, 6).map((item) => (
                        <article key={item.id}>
                          <div>
                            <strong data-idea-content="true" dir="auto">{item?.user?.fullName || tr('Community member')}</strong>
                            <time>{formatDate(item.updatedAt || item.createdAt, true, isArabic)}</time>
                          </div>
                          <p data-idea-content="true" dir="auto">{item.comment}</p>
                        </article>
                      ))
                    ) : (
                      <p className="admin-publication-insights-empty">{tr('No written feedback yet.')}</p>
                    )}
                  </div>
                </section>

                <section className="admin-publication-insights-section admin-publication-reports-section">
                  <header>
                    <div>
                      <span><Flag size={15} /></span>
                      <div>
                        <h4>{tr('Reports on this publication')}</h4>
                        <p>{tr('Review every report without leaving the idea directory.')}</p>
                      </div>
                    </div>
                    <strong>{fmt(insightReports.length)}</strong>
                  </header>

                  <div className="admin-publication-report-list">
                    {insightReports.length ? insightReports.map((report) => (
                      <article key={report.id} className={`admin-publication-report is-${String(report.status || '').toLowerCase()}`}>
                        <div className="admin-publication-report__top">
                          <div>
                            <span className="admin-publication-report__status">{tr(titleCase(report.status))}</span>
                            <strong>{tr(titleCase(report.reason))}</strong>
                            <small><bdi data-idea-content="true" dir="auto">{report?.reporter?.fullName || report?.reporter?.email || tr('Reporter')}</bdi> · {formatDate(report.createdAt, true, isArabic)}</small>
                          </div>
                        </div>

                        {report.details ? <p className="admin-publication-report__details" data-idea-content="true" dir="auto">{report.details}</p> : null}

                        {['PENDING', 'REVIEWING'].includes(String(report.status || '').toUpperCase()) ? (
                          <div className="admin-publication-report__reply">
                            <label>
                              <span>{tr('Response to reporter')}</span>
                              <textarea
                                value={reportReplies[report.id] || ''}
                                onChange={(event) =>
                                  setReportReplies((current) => ({
                                    ...current,
                                    [report.id]: event.target.value,
                                  }))
                                }
                                placeholder={tr('Write the moderation response that the reporter should receive…')}
                                maxLength={1000}
                              />
                            </label>

                            <div>
                              <button
                                type="button"
                                className="is-secondary"
                                disabled={reportBusyId === report.id}
                                onClick={() => reviewInsightReport(report, 'DISMISSED')}
                              >
                                {tr('Dismiss')}
                              </button>
                              <button
                                type="button"
                                className="is-primary"
                                disabled={reportBusyId === report.id}
                                onClick={() => reviewInsightReport(report, 'RESOLVED')}
                              >
                                {reportBusyId === report.id ? <LoaderCircle size={14} className="admin-spin" /> : <Send size={14} />}
                                {tr('Resolve & reply')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="admin-publication-report__reviewed">
                            <BadgeCheck size={14} />
                            <span data-idea-content={Boolean(report.adminNote)} dir="auto">{report.adminNote || tr('Reviewed by administration.')}</span>
                          </div>
                        )}
                      </article>
                    )) : (
                      <p className="admin-publication-insights-empty">{tr('No reports were submitted for this publication.')}</p>
                    )}
                  </div>
                </section>

                {isPublished(insightTarget) && insightTarget?.publication?.id ? (
                  <section className="admin-publication-moderation-footer">
                    <div>
                      <ShieldAlert size={17} />
                      <div>
                        <strong>{tr('Publication moderation')}</strong>
                        <span>{tr('Unpublishing stays out of the table and is available only after reviewing context.')}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => requestUnpublish(insightTarget)}>
                      <ShieldAlert size={14} />
                      {tr('Unpublish')}
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>,
        document.body,
      ) : null}

      {selected ? createPortal(
        <div className="admin-idea-drawer-backdrop" role="presentation" onMouseDown={closeIdea}>
          <aside className="admin-idea-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-idea-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="admin-idea-modal__topbar">
              <div>
                <span><Sparkles size={13} /> {tr('IDEA INSPECTOR')}</span>
                <h3 id="admin-idea-modal-title" data-idea-content="true" dir="auto">{selected.title || tr('Idea details')}</h3>
              </div>
              <button type="button" onClick={closeIdea} aria-label={tr('Close idea details')}><X size={18} /></button>
            </header>

            <div className="admin-idea-modal__body">
              <section className="admin-idea-modal__hero">
                <div className="admin-idea-modal__mark"><Lightbulb size={24} /></div>
                <div className="admin-idea-modal__hero-copy">
                  <small data-idea-content="true" dir="auto">{tr(getDomain(selected))}</small>
                  <h4 data-idea-content="true" dir="auto">{selected.title || tr('Untitled idea')}</h4>
                  <div className="admin-idea-modal__chips">
                    <span className={selected.isUnlocked ? 'is-success' : 'is-danger'}>{selected.isUnlocked ? <Unlock size={12} /> : <LockKeyhole size={12} />}{tr(selected.isUnlocked ? 'Unlocked' : 'Locked')}</span>
                    <span className={isPublished(selected) ? 'is-success' : ''}><Globe2 size={12} />{tr(isPublished(selected) ? 'Published' : 'Not published')}</span>
                    <span><Sparkles size={12} />{tr(titleCase(selected.generationType))}</span>
                  </div>
                </div>
                <div className="admin-idea-modal__owner"><span><UserRound size={15} /></span><div><small>{tr('Owner')}</small><strong data-idea-content="true" dir="auto">{tr(getOwner(selected))}</strong><p data-idea-content="true" dir="auto">{tr(getOwnerMeta(selected))}</p></div></div>
              </section>

              {detailLoading ? (
                <div className="admin-idea-detail-loading"><LoaderCircle size={22} className="admin-spin" /><span>{tr('Loading idea details…')}</span></div>
              ) : null}
              {detailError ? <div className="admin-ideas-error"><AlertCircle size={17} /><span>{tr(detailError)}</span></div> : null}

              <div className="admin-idea-modal__quick-grid">
                <article><span><BadgeCheck size={16} /></span><div><small>{tr('Pipeline')}</small><strong className={statusTone(selected?.generationRun?.status)}>{tr(titleCase(selected?.generationRun?.status || 'Unknown'))}</strong></div></article>
                <article><span><Clock3 size={16} /></span><div><small>{tr('Created')}</small><strong>{formatDate(selected.createdAt, true, isArabic)}</strong></div></article>
                <article><span><CircleDollarSign size={16} /></span><div><small>{tr('Unlock method')}</small><strong>{tr(titleCase(selected.unlockMethod || 'None'))}</strong></div></article>
                <article><span><Globe2 size={16} /></span><div><small>{tr('Region')}</small><strong data-idea-content="true" dir="auto">{selected.selectedRegion || selected?.collectionJob?.region || tr('Any region')}</strong></div></article>
              </div>

              <div className="admin-idea-modal__content-grid">
                <div className="admin-idea-modal__main">
                  <DetailBlock icon={FileText} label={tr('Problem statement')}>
                    <p data-idea-content={Boolean(selected.problemStatement)} dir="auto">{selected.problemStatement || tr('No problem statement is available for this record.')}</p>
                  </DetailBlock>
                  <DetailBlock icon={Sparkles} label={tr('Abstract')}>
                    <p data-idea-content={Boolean(selected.fullAbstract || selected.partialAbstract || selected.limitedAbstract)} dir="auto">{selected.fullAbstract || selected.partialAbstract || selected.limitedAbstract || tr('No abstract is available for this record.')}</p>
                  </DetailBlock>
                  <DetailBlock icon={BadgeCheck} label={tr('Objectives')}>
                    {Array.isArray(selected.objectives) ? <ul data-idea-content="true" dir="auto">{selected.objectives.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p data-idea-content={Boolean(selected.objectives)} dir="auto">{selected.objectives || tr('No objectives available.')}</p>}
                  </DetailBlock>
                  <DetailBlock icon={UserRound} label={tr('Target users')}>
                    {Array.isArray(selected.targetUsers) ? <div className="admin-idea-tags" data-idea-content="true" dir="auto">{selected.targetUsers.map((item) => <span key={item}>{item}</span>)}</div> : <p data-idea-content={Boolean(selected.targetUsers)} dir="auto">{selected.targetUsers || tr('No target-user information available.')}</p>}
                  </DetailBlock>
                </div>

                <aside className="admin-idea-modal__aside">
                  <DetailBlock icon={Sparkles} label={tr('Generation status')} className="is-compact">
                    <dl>
                      <div><dt>{tr('Stage')}</dt><dd>{tr(titleCase(selected?.generationRun?.currentStageKey || '—'))}</dd></div>
                      <div><dt>{tr('Progress')}</dt><dd>{Number(selected?.generationRun?.progressPercent || 0)}%</dd></div>
                      <div><dt>{tr('Started')}</dt><dd>{formatDate(selected?.generationRun?.startedAt, true, isArabic)}</dd></div>
                      <div><dt>{tr('Completed')}</dt><dd>{formatDate(selected?.generationRun?.completedAt, true, isArabic)}</dd></div>
                    </dl>
                  </DetailBlock>
                  <DetailBlock icon={Globe2} label={tr('Publication')} className="is-compact">
                    <dl>
                      <div><dt>{tr('Status')}</dt><dd>{tr(titleCase(selected?.publication?.status || 'Not published'))}</dd></div>
                      <div><dt>{tr('Visibility')}</dt><dd>{tr(titleCase(selected?.publication?.visibility || '—'))}</dd></div>
                      <div><dt>{tr('Published')}</dt><dd>{formatDate(selected?.publication?.publishedAt, true, isArabic)}</dd></div>
                    </dl>
                  </DetailBlock>
                  <DetailBlock icon={FileText} label={tr('Record')} className="is-compact">
                    <dl>
                      <div><dt>{tr('Idea ID')}</dt><dd className="is-code" data-idea-content="true" dir="ltr">{selected.id || '—'}</dd></div>
                      <div><dt>{tr('Outputs')}</dt><dd>{fmt(selected?._count?.generatedOutputs)}</dd></div>
                      <div><dt>{tr('Payments')}</dt><dd>{fmt(selected?._count?.payments)}</dd></div>
                    </dl>
                  </DetailBlock>
                </aside>
              </div>

              {isPublished(selected) && selected?.publication?.id ? (
                <section className="admin-idea-moderation-strip">
                  <div>
                    <span><ShieldAlert size={16} /></span>
                    <div><strong>{tr('Publication moderation')}</strong><p>{tr('Remove this idea from community discovery and automatically notify its publisher.')}</p></div>
                  </div>
                  <button type="button" onClick={() => requestUnpublish(selected)}><ShieldAlert size={15} /> {tr('Unpublish idea')}</button>
                </section>
              ) : null}
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}

      {moderationTarget ? createPortal(
        <div className="admin-idea-confirm-layer" role="presentation" onMouseDown={closeModeration}>
          <section className="admin-idea-confirm" role="dialog" aria-modal="true" aria-labelledby="unpublish-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-idea-confirm__icon"><ShieldAlert size={22} /></div>
            <button className="admin-idea-confirm__close" type="button" onClick={closeModeration} aria-label={tr('Close')}><X size={17} /></button>
            <span className="admin-idea-confirm__eyebrow">{tr('PUBLICATION MODERATION')}</span>
            <h3 id="unpublish-title">{tr('Unpublish this idea?')}</h3>
            <p className="admin-idea-confirm__lead">
              <strong data-idea-content="true" dir="auto">{moderationTarget.title || tr('Untitled idea')}</strong> {tr('will disappear from community discovery. The publication record and its history will stay preserved.')}
            </p>

            <div className="admin-idea-confirm__notify">
              <BellRing size={17} />
              <div><strong>{tr('Publisher notification is automatic')}</strong><span><bdi data-idea-content="true" dir="auto">{tr(getOwnerMeta(moderationTarget))}</bdi> {tr('will receive an in-app admin alert containing the reason below.')}</span></div>
            </div>

            <label className="admin-idea-confirm__field">
              <span>{tr('Reason for unpublishing')}</span>
              <textarea
                value={moderationReason}
                onChange={(event) => { setModerationReason(event.target.value); if (moderationError) setModerationError(''); }}
                placeholder={tr('Example: The publication contains information that should be corrected before it is visible to the community.')}
                maxLength={1000}
                autoFocus
              />
              <small>{moderationReason.trim().length}/1000 · {tr('This reason is included in the publisher alert.')}</small>
            </label>

            {moderationError ? <div className="admin-idea-confirm__error"><AlertCircle size={15} /> {tr(moderationError)}</div> : null}

            <footer className="admin-idea-confirm__actions">
              <button type="button" className="is-secondary" onClick={closeModeration} disabled={moderationLoading}>{tr('Keep published')}</button>
              <button type="button" className="is-danger" onClick={confirmUnpublish} disabled={moderationLoading || moderationReason.trim().length < 3}>
                {moderationLoading ? <LoaderCircle size={15} className="admin-spin" /> : <ShieldAlert size={15} />}
                {tr(moderationLoading ? 'Unpublishing…' : 'Unpublish & notify')}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}