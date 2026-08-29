import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Pencil,
  Save,
  UserRoundCog,
  CalendarDays,
  Coins,
  Crown,
  KeyRound,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import { resolveMediaUrl } from '../../../../utils/mediaUrl';
import { useUserExperience } from '../../../../system/user-experience';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-users.css';
import '../styles/admin-user-modals.css';

const PAGE_SIZE = 20;

const ADMIN_USERS_AR = Object.freeze({
  'Users': 'المستخدمون',
  'Identity & access': 'الهوية والوصول',
  'Search and manage Normal/Premium customer accounts. Administrator staff are managed separately in Administrators.':
    'ابحث عن حسابات العملاء العادية والمميزة وأدِرها. تتم إدارة حسابات المشرفين بشكل منفصل من قسم المشرفين.',
  'Users directory': 'دليل المستخدمين',
  'records available': 'سجل متاح',
  'Live administrative data': 'بيانات إدارية مباشرة',
  'Live directory': 'دليل مباشر',
  'Refresh': 'تحديث',
  'Export CSV': 'تصدير CSV',
  'Total users': 'إجمالي المستخدمين',
  'Active users': 'المستخدمون النشطون',
  'Inactive users': 'المستخدمون غير النشطين',
  'Verified': 'تم التحقق',
  'Verified users': 'المستخدمون الموثقون',
  'Premium': 'مميز',
  'Premium users': 'المستخدمون المميزون',
  'Current platform snapshot': 'لقطة المنصة الحالية',
  'Filter users': 'تصفية المستخدمين',
  'All users': 'كل المستخدمين',
  'Active': 'نشط',
  'Inactive': 'غير نشط',
  'Deleted': 'محذوف',
  'Sort users': 'ترتيب المستخدمين',
  'Sort': 'ترتيب',
  'Joined date': 'تاريخ الانضمام',
  'Name': 'الاسم',
  'Email': 'البريد الإلكتروني',
  'Plan': 'الخطة',
  'User type': 'نوع المستخدم',
  'Credits': 'الرصيد',
  'Free usage': 'الاستخدام المجاني',
  'Active status': 'حالة النشاط',
  'Verification': 'التحقق',
  'Search users...': 'ابحث عن مستخدم...',
  'Search Users': 'البحث في المستخدمين',
  'User sorting controls': 'عناصر ترتيب المستخدمين',
  'User': 'المستخدم',
  'Usage': 'الاستخدام',
  'Account': 'الحساب',
  'Type': 'النوع',
  'Joined': 'الانضمام',
  'Actions': 'الإجراءات',
  'User profile': 'ملف المستخدم',
  'No matching records': 'لا توجد سجلات مطابقة',
  'No records yet': 'لا توجد سجلات بعد',
  'Try a different search phrase.': 'جرّب عبارة بحث مختلفة.',
  'There is currently nothing to display here.': 'لا يوجد شيء لعرضه حاليًا.',
  'Try again': 'إعادة المحاولة',
  'Loading users…': 'جارٍ تحميل المستخدمين…',
  'Email sent successfully': 'تم إرسال البريد الإلكتروني بنجاح',
  'Dismiss success message': 'إغلاق رسالة النجاح',
  'View user': 'عرض المستخدم',
  'View': 'عرض',
  'Edit user': 'تعديل المستخدم',
  'Edit': 'تعديل',
  'Deactivate user': 'تعطيل المستخدم',
  'Activate user': 'تفعيل المستخدم',
  'More actions': 'إجراءات إضافية',
  'More user actions': 'إجراءات إضافية للمستخدم',
  'User account': 'حساب المستخدم',
  'Send password recovery': 'إرسال رابط استعادة كلمة المرور',
  'Email a secure reset link': 'إرسال رابط آمن لإعادة التعيين بالبريد',
  'Delete user': 'حذف المستخدم',
  'Remove the customer account': 'إزالة حساب العميل',
  'Delete this user account? This action may be irreversible.': 'هل تريد حذف حساب هذا المستخدم؟ قد لا يمكن التراجع عن هذا الإجراء.',
  'Password reset email sent successfully.': 'تم إرسال رسالة إعادة تعيين كلمة المرور بنجاح.',
  'Unnamed user': 'مستخدم بلا اسم',
  'No email': 'لا يوجد بريد إلكتروني',
  'Normal': 'عادي',
  'Unverified': 'غير موثّق',
  'Not verified': 'غير موثّق',
  'credits': 'رصيد',
  'free': 'مجاني',
  'Student': 'طالب',
  'Developer': 'مطوّر',
  'Company': 'شركة',
  'Researcher': 'باحث',
  'Other': 'أخرى',
  'Page': 'الصفحة',
  'of': 'من',
  'Previous': 'السابق',
  'Next': 'التالي',
  'Account editor': 'محرر الحساب',
  'Member intelligence': 'ملف العضو',
  'Update account identity and access without leaving this workspace.': 'حدّث هوية الحساب وصلاحيات الوصول دون مغادرة مساحة العمل.',
  'A focused snapshot of identity, access and platform activity.': 'لقطة مركزة لهوية المستخدم ووصوله ونشاطه على المنصة.',
  'Close': 'إغلاق',
  'Voxidence member': 'عضو في فوكسيدنس',
  'Edit profile': 'تعديل الملف',
  'Credit balance': 'رصيد الحساب',
  'Ideas': 'الأفكار',
  'Free generations': 'التوليدات المجانية',
  'Member since': 'عضو منذ',
  'Core account details and current permissions.': 'تفاصيل الحساب الأساسية والصلاحيات الحالية.',
  'Full name': 'الاسم الكامل',
  'Email address': 'البريد الإلكتروني',
  'Role': 'الدور',
  'Account state': 'حالة الحساب',
  'Email state': 'حالة البريد',
  'Record ID': 'معرّف السجل',
  'Last updated': 'آخر تحديث',
  'Editing member': 'تعديل العضو',
  'Account inactive': 'الحساب غير نشط',
  'Account active': 'الحساب نشط',
  'Protected editor': 'محرر محمي',
  'Changes are applied through the administrative API and saved immediately.': 'تُطبّق التغييرات عبر واجهة الإدارة وتُحفظ مباشرة.',
  'PROFILE SETTINGS': 'إعدادات الملف',
  'Account configuration': 'إعدادات الحساب',
  'Live editor': 'محرر مباشر',
  'User name': 'اسم المستخدم',
  'Account plan': 'خطة الحساب',
  'Plan follows the committed credit balance automatically.': 'تتحدد الخطة تلقائيًا وفق الرصيد المعتمد في الحساب.',
  'Changing credits creates an audited ADMIN_ADJUSTMENT ledger entry.': 'يؤدي تغيير الرصيد إلى إنشاء حركة ADMIN_ADJUSTMENT موثقة في سجل الرصيد.',
  'Free generations used': 'التوليدات المجانية المستخدمة',
  'Free generation limit': 'حد التوليدات المجانية',
  'Credit adjustment reason': 'سبب تعديل الرصيد',
  'Example: Manual correction approved by support': 'مثال: تصحيح يدوي معتمد من فريق الدعم',
  'This note is stored in the credit ledger and audit log.': 'تُحفظ هذه الملاحظة في سجل الرصيد وسجل التدقيق.',
  'Email verification': 'التحقق من البريد الإلكتروني',
  'Control the verified state stored on this account.': 'تحكّم بحالة التحقق المحفوظة لهذا الحساب.',
  'Protected email': 'بريد محمي',
  'Protected role': 'دور محمي',
  'Protected': 'محمي',
  'Cancel': 'إلغاء',
  'Saving…': 'جارٍ الحفظ…',
  'Save changes': 'حفظ التغييرات',
  'Could not update this user.': 'تعذر تحديث هذا المستخدم.',
  'The requested action could not be completed.': 'تعذر إكمال الإجراء المطلوب.',
  'CSV export failed.': 'فشل تصدير ملف CSV.',
  'Free generations used must be a whole number greater than or equal to 0.': 'يجب أن يكون عدد التوليدات المجانية المستخدمة عددًا صحيحًا أكبر من أو يساوي 0.',
  'Free generation limit must be a whole number greater than or equal to 0.': 'يجب أن يكون حد التوليدات المجانية عددًا صحيحًا أكبر من أو يساوي 0.',
  'Free generations used cannot be greater than the free generation limit.': 'لا يمكن أن يتجاوز عدد التوليدات المجانية المستخدمة الحد المجاني.',
  'Credit balance must be a whole number greater than or equal to 0.': 'يجب أن يكون الرصيد عددًا صحيحًا أكبر من أو يساوي 0.',
  'Write a short reason for the credit adjustment (at least 5 characters).': 'اكتب سببًا مختصرًا لتعديل الرصيد (5 أحرف على الأقل).',
});

function translateAdminUsers(text, isArabic) {
  if (!isArabic || text == null) return text;
  return ADMIN_USERS_AR[String(text)] || text;
}

function localizeUserEnum(value, isArabic) {
  if (value == null) return value;
  const source = String(value);
  const readable = /^[A-Z0-9_ -]+$/.test(source)
    ? toReadableLabel(source.toLowerCase())
    : toReadableLabel(source);
  return translateAdminUsers(readable, isArabic);
}

const RESOURCE_CONFIG = {
  users: {
    title: 'Users',
    eyebrow: 'Identity & access',
    description:
      'Search and manage Normal/Premium customer accounts. Administrator staff are managed separately in Administrators.',
    icon: UsersRound,
    api: adminApi.users,
    searchable: true,
    exportable: true,
  },
  ideas: {
    title: 'Ideas',
    eyebrow: 'Idea operations',
    description: 'Inspect generated ideas, ownership, generation state and platform activity.',
    icon: Sparkles,
    api: adminApi.ideas,
    searchable: true,
    exportable: true,
  },
  payments: {
    title: 'Payments',
    eyebrow: 'Billing operations',
    description: 'Review payment activity, purposes, gateways and transaction state.',
    icon: CircleDollarSign,
    api: adminApi.payments,
    searchable: true,
    exportable: true,
  },
  credits: {
    title: 'Credits',
    eyebrow: 'Credit ledger',
    description: 'Review credit movements and administrative adjustments.',
    icon: CircleDollarSign,
    api: adminApi.credits,
    searchable: true,
    exportable: true,
  },
  domains: {
    title: 'Domains',
    eyebrow: 'Discovery configuration',
    description: 'Manage the domains available to idea discovery and generation.',
    icon: Database,
    api: adminApi.domains,
    searchable: true,
  },
  complaints: {
    title: 'Complaints',
    eyebrow: 'Trust & safety',
    description: 'Review and manage platform complaints and their resolution state.',
    icon: AlertCircle,
    api: adminApi.complaints,
    searchable: true,
    exportable: true,
  },
  contactMessages: {
    title: 'Contact messages',
    eyebrow: 'Inbox',
    description: 'Review messages submitted to the platform support inbox.',
    icon: Mail,
    api: adminApi.contactMessages,
    searchable: true,
    exportable: true,
  },
  publicationReports: {
    title: 'Publication reports',
    eyebrow: 'Trust & safety',
    description: 'Review reports submitted against published ideas and record moderation decisions.',
    icon: ShieldCheck,
    api: adminApi.publicationReports,
    searchable: true,
  },
  alerts: {
    title: 'Alerts',
    eyebrow: 'Platform communication',
    description: 'Review platform alerts and administrator communication activity.',
    icon: AlertCircle,
    api: adminApi.alerts,
    searchable: true,
  },
  dataSources: {
    title: 'Data sources',
    eyebrow: 'Collection infrastructure',
    description: 'Inspect and configure the external sources used for evidence collection.',
    icon: Database,
    api: adminApi.dataSources,
    searchable: true,
  },
  aiModels: {
    title: 'AI models',
    eyebrow: 'Model operations',
    description: 'Inspect configured AI providers, model health, priority and activation state.',
    icon: Sparkles,
    api: adminApi.aiModels,
    searchable: true,
  },
  aiMonitoring: {
    title: 'AI monitoring',
    eyebrow: 'Observability',
    description: 'Inspect AI execution logs, status, latency and operational outcomes.',
    icon: ShieldCheck,
    api: adminApi.aiMonitoring,
    searchable: true,
    exportable: true,
  },
  auditLogs: {
    title: 'Audit logs',
    eyebrow: 'Security & governance',
    description: 'Review privileged actions and administrative changes across the platform.',
    icon: FileText,
    api: adminApi.auditLogs,
    searchable: true,
    exportable: true,
  },
  authAudit: {
    title: 'Authentication audit',
    eyebrow: 'Security',
    description: 'Inspect authentication activity and account access events.',
    icon: ShieldCheck,
    api: adminApi.authAudit,
    searchable: true,
  },
  collection: {
    title: 'Collection runs',
    eyebrow: 'Evidence pipeline',
    description: 'Inspect collection jobs and the evidence ingestion pipeline.',
    icon: Database,
    api: adminApi.collection,
    searchable: true,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isPlainObject(payload)) return [];

  const candidates = [
    payload.data,
    payload.items,
    payload.results,
    payload.records,
    payload.users,
    payload.ideas,
    payload.payments,
    payload.logs,
    payload.history,
    payload.comments,
    payload.feedback,
    payload.complaints,
    payload.messages,
    payload.reports,
    payload.alerts,
    payload.sources,
    payload.models,
    payload.jobs,
  ];

  const direct = candidates.find(Array.isArray);
  if (direct) return direct;

  if (isPlainObject(payload.data)) {
    const nested = Object.values(payload.data).find(Array.isArray);
    if (nested) return nested;
  }

  return [];
}

function getMeta(payload, itemCount) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
  const total = Number(source.total ?? source.totalItems ?? payload?.total ?? itemCount) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(
    1,
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(1, limit))) || 1,
  );

  return { total, page, limit, totalPages };
}

function firstDefined(object, keys, fallback = '—') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat().format(value);

  if (typeof value === 'string') {
    const looksLikeDate = /(?:At|Date)$/i.test('value') || /^\d{4}-\d{2}-\d{2}T/.test(value);
    if (looksLikeDate) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
    }
    return value;
  }

  if (Array.isArray(value)) return value.length ? `${value.length} items` : '0 items';
  if (isPlainObject(value)) {
    return firstDefined(value, ['name', 'title', 'email', 'displayName', 'label'], 'Details');
  }
  return String(value);
}

function toReadableLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

const HIDDEN_COLUMNS = new Set([
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'metadata',
  'raw',
  'payload',
]);

function selectColumns(rows, section) {
  if (!rows.length) return [];

  /*
   * Users use a purpose-built compact layout instead of exposing every raw
   * field as its own column. This keeps the table inside the workspace without
   * horizontal scrolling while still preserving all important account data.
   */
  if (section === 'users') {
    return [
      'identity',
      'accountStatus',
      'usage',
      'accountHealth',
      'userType',
      'createdAt',
    ];
  }

  const preferredBySection = {
    ideas: ['title', 'status', 'tier', 'user', 'userEmail', 'domain', 'createdAt'],
    payments: ['user', 'userEmail', 'amount', 'currency', 'purpose', 'provider', 'status', 'createdAt'],
    credits: ['user', 'userEmail', 'amount', 'type', 'reason', 'balanceAfter', 'createdAt'],
    domains: ['name', 'title', 'slug', 'isActive', 'createdAt'],
    complaints: ['subject', 'type', 'status', 'priority', 'user', 'createdAt'],
    contactMessages: ['name', 'email', 'subject', 'status', 'createdAt'],
    publicationReports: ['reason', 'status', 'reporter', 'publication', 'createdAt'],
    dataSources: ['name', 'sourceType', 'type', 'isActive', 'healthStatus', 'updatedAt'],
    aiModels: ['displayName', 'modelName', 'provider', 'healthStatus', 'priority', 'isActive', 'isDefault'],
    aiMonitoring: ['operation', 'provider', 'model', 'status', 'latencyMs', 'createdAt'],
    auditLogs: ['action', 'actor', 'targetType', 'targetId', 'createdAt'],
    authAudit: ['email', 'action', 'status', 'ipAddress', 'createdAt'],
    collection: ['status', 'sourceType', 'domain', 'postsCount', 'commentsCount', 'createdAt'],
  };

  const existingKeys = [...new Set(rows.flatMap((row) => (isPlainObject(row) ? Object.keys(row) : [])))];
  const preferred = (preferredBySection[section] || []).filter((key) => existingKeys.includes(key));
  const remainder = existingKeys.filter(
    (key) => !preferred.includes(key) && !HIDDEN_COLUMNS.has(key) && key !== 'id',
  );

  return [...preferred, ...remainder].slice(0, section === 'users' ? 9 : 8);
}

function normalizeSummary(summary, rows, section) {
  const source = isPlainObject(summary?.data) ? summary.data : summary;

  if (isPlainObject(source)) {
    const entries = Object.entries(source)
      .filter(([, value]) => typeof value === 'number')
      .slice(0, 8)
      .map(([key, value]) => ({ label: toReadableLabel(key), value }));
    if (entries.length) return entries;
  }

  if (section === 'users') {
    const active = rows.filter((item) => item?.isActive !== false).length;
    const verified = rows.filter((item) => item?.isVerified === true || item?.emailVerified === true).length;
    const premium = rows.filter(
      (item) => String(item?.accountStatus || item?.plan || item?.tier || '').toUpperCase() === 'PREMIUM',
    ).length;
    return [
      { label: 'Total users', value: rows.length },
      { label: 'Active users', value: active },
      { label: 'Verified', value: verified },
      { label: 'Premium', value: premium },
    ];
  }

  return [{ label: `Loaded ${RESOURCE_CONFIG[section]?.title || 'records'}`, value: rows.length }];
}

function statusClass(value) {
  const normalized = String(value ?? '').toUpperCase();
  if (['ACTIVE', 'SUCCEEDED', 'COMPLETED', 'VERIFIED', 'HEALTHY', 'RESOLVED'].includes(normalized)) return 'is-success';
  if (['FAILED', 'INACTIVE', 'BLOCKED', 'BANNED', 'REJECTED', 'UNHEALTHY'].includes(normalized)) return 'is-danger';
  if (['PENDING', 'RUNNING', 'QUEUED', 'OPEN', 'REVIEWING'].includes(normalized)) return 'is-warning';
  return '';
}

function CellValue({ value, column }) {
  if (typeof value === 'boolean') {
    return (
      <span className={`admin-status ${value ? 'is-success' : 'is-danger'}`}>
        {value ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
        {value ? 'Yes' : 'No'}
      </span>
    );
  }

  const rendered = formatValue(value);
  const isStatus = /status|state|health|role|tier/i.test(column);

  if (isStatus) {
    return <span className={`admin-status ${statusClass(rendered)}`}>{rendered}</span>;
  }

  return <span title={typeof rendered === 'string' ? rendered : undefined}>{rendered}</span>;
}


/**
 * User directory sorting.
 *
 * The backend already supports these fields. Keeping the mapping explicit
 * prevents a display-only column name from accidentally becoming an invalid
 * Prisma orderBy field.
 */
const USER_STATUS_OPTIONS = [
  { key: '', label: 'All users', icon: UsersRound },
  { key: 'ACTIVE', label: 'Active', icon: UserCheck },
  { key: 'INACTIVE', label: 'Inactive', icon: Ban },
  { key: 'DELETED', label: 'Deleted', icon: Trash2 },
];

const USER_SORT_OPTIONS = [
  { key: 'createdAt', label: 'Joined date' },
  { key: 'fullName', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'accountStatus', label: 'Plan' },
  { key: 'userType', label: 'User type' },
  { key: 'creditBalance', label: 'Credits' },
  { key: 'freeGenerationsUsed', label: 'Free usage' },
  { key: 'isActive', label: 'Active status' },
  { key: 'isVerified', label: 'Verification' },
];

const USER_COLUMN_SORT_FIELD = {
  identity: 'fullName',
  accountStatus: 'accountStatus',
  usage: 'creditBalance',
  accountHealth: 'isActive',
  userType: 'userType',
  createdAt: 'createdAt',
};

function UserAvatar({ user, name, className = 'admin-user-identity-cell__avatar' }) {
  const avatarPath = firstDefined(
    user,
    ['avatarUrl', 'profileImageUrl', 'profileImage', 'avatar'],
    '',
  );
  const avatarUrl = resolveMediaUrl(String(avatarPath || '').trim());
  const initial = String(name || 'U').trim().charAt(0).toUpperCase() || 'U';

  return (
    <span className={className}>
      <span className="admin-user-avatar__fallback">{initial}</span>
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      ) : null}
    </span>
  );
}

function AdminUserStatusPicker({ value, onChange, tr = (text) => text }) {
  const [open, setOpen] = useState(false);
  const current = USER_STATUS_OPTIONS.find((option) => option.key === value) || USER_STATUS_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <div className={`admin-user-status-filter ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="admin-user-status-filter__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <CurrentIcon size={14} />
        <span>
          <small>{tr('Filter users')}</small>
          <strong>{tr(current.label)}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="admin-user-status-filter__menu">
          {USER_STATUS_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                type="button"
                key={option.key || 'ALL'}
                className={option.key === value ? 'is-active' : ''}
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
              >
                <OptionIcon size={14} />
                <span>{tr(option.label)}</span>
                {option.key === value ? <CheckCircle2 size={13} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AdminSortPicker({ options, value, order, onChange, onToggleOrder, label = 'Sort', tr = (text) => text }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.key === value) || options[0];

  return (
    <div className={`admin-modern-sort ${open ? 'is-open' : ''}`}>
      <button type="button" className="admin-modern-sort__trigger" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} />
        <span><small>{tr(label)}</small><strong>{tr(current?.label || 'Sort')}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="admin-modern-sort__menu">
          {options.map((option) => (
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
      <button type="button" className="admin-modern-sort__direction" onClick={onToggleOrder}>
        {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  );
}

function EmptyState({ search, tr = (text) => text }) {
  return (
    <div className="admin-resource-empty">
      <Search size={26} />
      <strong>{tr(search ? 'No matching records' : 'No records yet')}</strong>
      <span>{tr(search ? 'Try a different search phrase.' : 'There is currently nothing to display here.')}</span>
    </div>
  );
}

export default function AdminResourcePage({ section }) {
  const config = RESOURCE_CONFIG[section] || RESOURCE_CONFIG.users;
  const Icon = config.icon;
  const { isArabic } = useUserExperience();
  const tr = useCallback(
    (text) => (section === 'users' ? translateAdminUsers(text, isArabic) : text),
    [isArabic, section],
  );

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [userSortBy, setUserSortBy] = useState('createdAt');
  const [userSortOrder, setUserSortOrder] = useState('desc');
  const [userStatus, setUserStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [openUserActionMenu, setOpenUserActionMenu] = useState(null);
  const [selected, setSelected] = useState(null);
  const [userModalMode, setUserModalMode] = useState('view');
  const [userForm, setUserForm] = useState({
    fullName: '',
    userType: 'OTHER',
    accountStatus: 'NORMAL',
    creditBalance: 0,
    freeGenerationsUsed: 0,
    freeGenerationLimit: 3,
    isVerified: false,
    creditReason: '',
  });
  const [savingUser, setSavingUser] = useState(false);
  const [modalError, setModalError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!notice) return undefined;

    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!openUserActionMenu) return undefined;

    const closeMenu = () => setOpenUserActionMenu(null);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openUserActionMenu]);

  const loadData = useCallback(
    async ({ quiet = false, fresh = false } = {}) => {
      const requestId = ++requestIdRef.current;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const params = {
          page,
          limit: PAGE_SIZE,
          ...(search ? { search } : {}),
          ...(section === 'users'
            ? {
              sortBy: userSortBy,
              sortOrder: userSortOrder,
              ...(userStatus === 'ACTIVE' ? { isActive: true } : {}),
              ...(userStatus === 'INACTIVE' ? { isActive: false } : {}),
              ...(userStatus === 'DELETED' ? { deletedOnly: true } : {}),
            }
            : {}),
        };

        // Paint the directory as soon as the list arrives. Summary cards are supportive
        // UI and should never hold the whole page behind several aggregate DB queries.
        const listLoader = fresh && config.api?.listFresh ? config.api.listFresh : config.api?.list;
        const listPayload = listLoader ? await listLoader(params) : [];
        if (requestId !== requestIdRef.current) return;

        const nextRows = getItems(listPayload);
        setRows(nextRows);
        setMeta(getMeta(listPayload, nextRows.length));
        if (!quiet) setLoading(false);

        if (config.api?.summary) {
          const summaryParams = { ...params };
          delete summaryParams.page;
          delete summaryParams.limit;
          const summaryLoader = fresh && config.api?.summaryFresh ? config.api.summaryFresh : config.api.summary;
          summaryLoader(summaryParams)
            .then((summaryPayload) => {
              if (requestId === requestIdRef.current) setSummary(summaryPayload);
            })
            .catch(() => null);
        }
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return;
        setRows([]);
        setError(getApiErrorMessage(requestError, `Could not load ${config.title.toLowerCase()}.`));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [config, page, search, section, userSortBy, userSortOrder, userStatus],
  );

  useEffect(() => {
    setPage(1);
    setSearchInput('');
    setSearch('');
    setSelected(null);
    setUserModalMode('view');
    setModalError('');
    setNotice('');
    if (section === 'users') {
      setUserSortBy('createdAt');
      setUserSortOrder('desc');
      setUserStatus('');
    }
  }, [section]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const columns = useMemo(() => selectColumns(rows, section), [rows, section]);
  const stats = useMemo(() => normalizeSummary(summary, rows, section), [summary, rows, section]);
  const selectedIsDeleted = Boolean(selected?.deletedAt);


  const applyUserSort = (field) => {
    if (section !== 'users') return;
    setPage(1);
    if (field === userSortBy) {
      setUserSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setUserSortBy(field);
    setUserSortOrder(field === 'createdAt' ? 'desc' : 'asc');
  };

  const handleExport = async () => {
    if (!config.api?.exportCsv) return;
    try {
      setRefreshing(true);
      await config.api.exportCsv({
        ...(search ? { search } : {}),
        ...(section === 'users'
          ? {
            sortBy: userSortBy,
            sortOrder: userSortOrder,
            ...(userStatus === 'ACTIVE' ? { isActive: true } : {}),
            ...(userStatus === 'INACTIVE' ? { isActive: false } : {}),
            ...(userStatus === 'DELETED' ? { deletedOnly: true } : {}),
          }
          : {}),
      });
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'CSV export failed.'));
    } finally {
      setRefreshing(false);
    }
  };

  const runMutation = async (id, operation, successMessage = '') => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (successMessage) {
        setNotice(result?.message || successMessage);
      }
      await loadData({ quiet: true });
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, 'The requested action could not be completed.'));
    } finally {
      setBusyId(null);
    }
  };

  const makeUserForm = (user = {}) => ({
    fullName: String(firstDefined(user, ['fullName', 'name', 'displayName'], '') || ''),
    userType: String(firstDefined(user, ['userType', 'type'], 'OTHER') || 'OTHER').toUpperCase(),
    accountStatus: String(firstDefined(user, ['accountStatus', 'plan', 'tier'], 'NORMAL') || 'NORMAL').toUpperCase(),
    creditBalance: Number(firstDefined(user, ['creditBalance', 'credits'], 0) ?? 0),
    freeGenerationsUsed: Number(firstDefined(user, ['freeGenerationsUsed'], 0) ?? 0),
    freeGenerationLimit: Number(firstDefined(user, ['freeGenerationLimit'], 3) ?? 3),
    isVerified: Boolean(user?.isVerified ?? user?.emailVerified),
    creditReason: '',
  });

  const openUserModal = async (item, mode = 'view') => {
    const id = item?.id || item?.userId;
    setSelected(item);
    setUserModalMode(mode);
    setModalError('');
    setUserForm(makeUserForm(item));

    if (!id || !config.api?.detail) return;
    try {
      const detailPayload = await config.api.detail(id);
      const detail = isPlainObject(detailPayload?.data) ? detailPayload.data : detailPayload;
      if (isPlainObject(detail)) {
        const merged = { ...item, ...detail };
        setSelected(merged);
        setUserForm(makeUserForm(merged));
      }
    } catch {
      // Keep the row snapshot if the detail endpoint is unavailable.
    }
  };

  const closeUserModal = () => {
    if (savingUser) return;
    setSelected(null);
    setModalError('');
  };

  const handleSaveUser = async () => {
    const id = selected?.id || selected?.userId;
    if (!id || !config.api?.update) return;

    const nextFreeUsed = Number(userForm.freeGenerationsUsed);
    const nextFreeLimit = Number(userForm.freeGenerationLimit);
    const nextCreditBalance = Number(userForm.creditBalance);
    const currentCreditBalance = Number(firstDefined(selected, ['creditBalance', 'credits'], 0) ?? 0);
    const creditDelta = nextCreditBalance - currentCreditBalance;

    if (!Number.isInteger(nextFreeUsed) || nextFreeUsed < 0) {
      setModalError('Free generations used must be a whole number greater than or equal to 0.');
      return;
    }

    if (!Number.isInteger(nextFreeLimit) || nextFreeLimit < 0) {
      setModalError('Free generation limit must be a whole number greater than or equal to 0.');
      return;
    }

    if (nextFreeUsed > nextFreeLimit) {
      setModalError('Free generations used cannot be greater than the free generation limit.');
      return;
    }

    if (!Number.isInteger(nextCreditBalance) || nextCreditBalance < 0) {
      setModalError('Credit balance must be a whole number greater than or equal to 0.');
      return;
    }

    if (creditDelta !== 0 && userForm.creditReason.trim().length < 5) {
      setModalError('Write a short reason for the credit adjustment (at least 5 characters).');
      return;
    }

    setSavingUser(true);
    setModalError('');

    try {
      /*
       * Profile / free-generation counters are updated through the user API.
       * Credits intentionally go through the audited credit-ledger endpoint,
       * never through a raw user balance update.
       */
      await config.api.update(id, {
        fullName: userForm.fullName.trim(),
        userType: userForm.userType,
        freeGenerationsUsed: nextFreeUsed,
        freeGenerationLimit: nextFreeLimit,
        isVerified: Boolean(userForm.isVerified),
      });

      let creditResult = null;
      if (creditDelta !== 0) {
        creditResult = await adminApi.credits.adjust({
          userId: id,
          amount: creditDelta,
          description: userForm.creditReason.trim(),
        });
      }

      await loadData({ quiet: true });

      const updatedFromCredit = creditResult?.user || creditResult?.data?.user || {};
      const nextSelected = {
        ...(selected || {}),
        ...updatedFromCredit,
        fullName: userForm.fullName.trim(),
        userType: userForm.userType,
        freeGenerationsUsed: nextFreeUsed,
        freeGenerationLimit: nextFreeLimit,
        isVerified: Boolean(userForm.isVerified),
        creditBalance: creditDelta !== 0
          ? Number(updatedFromCredit?.creditBalance ?? nextCreditBalance)
          : currentCreditBalance,
        accountStatus: String(
          updatedFromCredit?.accountStatus ||
          (nextCreditBalance > 0 ? 'PREMIUM' : 'NORMAL'),
        ).toUpperCase(),
      };

      setSelected(nextSelected);
      setUserForm(makeUserForm(nextSelected));
      setUserModalMode('view');
    } catch (saveError) {
      setModalError(getApiErrorMessage(saveError, 'Could not update this user.'));
    } finally {
      setSavingUser(false);
    }
  };


  const getUserPlan = (user) =>
    String(firstDefined(user, ['accountStatus', 'plan', 'tier'], 'NORMAL') || 'NORMAL').toUpperCase();

  const renderUserActions = (item) => {
    if (section !== 'users') return null;

    const id = item?.id || item?.userId;
    if (!id) return null;

    const isDeleted = Boolean(item?.deletedAt);
    const active =
      !isDeleted &&
      item?.isActive !== false &&
      String(item?.status || '').toUpperCase() !== 'INACTIVE';

    const menuOpen = openUserActionMenu?.id === id;

    const openMoreMenu = (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const menuWidth = 228;
      const estimatedHeight = 154;
      const viewportPadding = 12;
      const gap = 8;

      let left = rect.right - menuWidth;
      left = Math.max(
        viewportPadding,
        Math.min(left, window.innerWidth - menuWidth - viewportPadding),
      );

      let top = rect.bottom + gap;
      if (top + estimatedHeight > window.innerHeight - viewportPadding) {
        top = Math.max(
          viewportPadding,
          rect.top - estimatedHeight - gap,
        );
      }

      setOpenUserActionMenu((current) =>
        current?.id === id
          ? null
          : {
            id,
            item,
            top,
            left,
          },
      );
    };

    return (
      <div
        className="admin-row-actions admin-row-actions--compact"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="admin-user-action-btn is-primary-action"
          title={tr('View user')}
          aria-label={tr('View user')}
          onClick={() => {
            setOpenUserActionMenu(null);
            openUserModal(item, 'view');
          }}
        >
          <Eye size={14} />
          <span>{tr('View')}</span>
        </button>

        {!isDeleted && config.api?.update ? (
          <button
            type="button"
            className="admin-user-action-btn"
            title={tr('Edit user')}
            aria-label={tr('Edit user')}
            onClick={() => {
              setOpenUserActionMenu(null);
              openUserModal(item, 'edit');
            }}
          >
            <Pencil size={14} />
            <span>{tr('Edit')}</span>
          </button>
        ) : null}

        {!isDeleted && config.api?.status ? (
          <button
            type="button"
            className={`admin-user-action-icon ${active ? 'is-deactivate' : 'is-activate'}`}
            title={tr(active ? 'Deactivate user' : 'Activate user')}
            aria-label={tr(active ? 'Deactivate user' : 'Activate user')}
            disabled={busyId === id}
            onClick={() => {
              setOpenUserActionMenu(null);
              runMutation(id, () => config.api.status(id, !active));
            }}
          >
            {busyId === id ? (
              <LoaderCircle className="admin-spin" size={14} />
            ) : active ? (
              <Ban size={14} />
            ) : (
              <UserCheck size={14} />
            )}
          </button>
        ) : null}

        {!isDeleted ? (
          <button
            type="button"
            className={`admin-user-more__trigger ${menuOpen ? 'is-active' : ''}`}
            title={tr('More actions')}
            aria-label={tr('More user actions')}
            aria-expanded={menuOpen}
            onClick={openMoreMenu}
          >
            <MoreHorizontal size={16} />
          </button>
        ) : (
          <span className="admin-user-deleted-action">{tr('Deleted')}</span>
        )}
      </div>
    );
  };


  const renderUserCell = (item, column) => {
    if (section !== 'users') {
      return <CellValue value={item?.[column]} column={column} />;
    }

    if (column === 'identity') {
      const name = String(
        firstDefined(item, ['fullName', 'name', 'displayName'], 'Unnamed user') ||
        'Unnamed user',
      );
      const localizedName = name === 'Unnamed user' ? tr(name) : name;
      const email = String(firstDefined(item, ['email'], '') || '');

      return (
        <div className="admin-user-identity-cell">
          <UserAvatar user={item} name={localizedName} />
          <div>
            <strong>{localizedName}</strong>
            <small>{email || tr('No email')}</small>
          </div>
        </div>
      );
    }

    if (column === 'accountStatus') {
      const plan = getUserPlan(item);
      return (
        <span className={`admin-user-plan-badge is-${plan.toLowerCase()}`}>
          <Crown size={11} />
          {localizeUserEnum(plan, isArabic)}
        </span>
      );
    }

    if (column === 'usage') {
      return (
        <div className="admin-user-usage-cell">
          <span className="admin-user-credit-cell">
            <Coins size={11} />
            <strong>{Number(item?.creditBalance || 0).toLocaleString()}</strong>
            <small>{tr('credits')}</small>
          </span>
          <span className="admin-user-free-cell">
            <strong>{Number(item?.freeGenerationsUsed || 0)}</strong>
            <small>/ {Number(item?.freeGenerationLimit ?? 3)} {tr('free')}</small>
          </span>
        </div>
      );
    }

    if (column === 'accountHealth') {
      const isDeleted = Boolean(item?.deletedAt);
      const active = !isDeleted && item?.isActive !== false;
      const verified = Boolean(item?.isVerified ?? item?.emailVerified);

      return (
        <div className="admin-user-health-cell">
          <span className={isDeleted ? 'is-muted' : active ? 'is-positive' : 'is-negative'}>
            {isDeleted ? <Trash2 size={12} /> : active ? <BadgeCheck size={12} /> : <XCircle size={12} />}
            {tr(isDeleted ? 'Deleted' : active ? 'Active' : 'Inactive')}
          </span>
          <span className={verified ? 'is-positive' : 'is-muted'}>
            {verified ? <BadgeCheck size={12} /> : <XCircle size={12} />}
            {tr(verified ? 'Verified' : 'Unverified')}
          </span>
        </div>
      );
    }

    if (column === 'userType') {
      return (
        <span className="admin-user-type-cell">
          {localizeUserEnum(item?.userType || 'OTHER', isArabic)}
        </span>
      );
    }

    if (column === 'createdAt') {
      const value = item?.createdAt;
      if (!value) return <span className="admin-user-date-cell">—</span>;
      const date = new Date(value);
      return (
        <span className="admin-user-date-cell">
          {Number.isNaN(date.getTime())
            ? String(value)
            : date.toLocaleDateString(isArabic ? 'ar-JO' : undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
        </span>
      );
    }

    return <CellValue value={item?.[column]} column={column} />;
  };


  return (
    <div className={`admin-page admin-resource-page ${section === 'users' ? 'admin-users-page' : ''}`}>
      <section className={`admin-hero ${section === 'users' ? 'admin-hero--users' : ''}`}>
        <div className={section === 'users' ? 'admin-users-hero__copy' : undefined}>
          <div className="admin-hero__eyebrow">
            <Icon size={14} />
            {tr(config.eyebrow)}
          </div>
          <h2>{tr(config.title)}</h2>
          <p>{tr(config.description)}</p>
          {section === 'users' && (
            <span className="admin-users-hero__rule" aria-hidden="true">
              <i />
              <i />
            </span>
          )}
        </div>

        {section === 'users' && (
          <div className="admin-users-hero__visual" aria-hidden="true">
            <span className="admin-users-hero__orbit admin-users-hero__orbit--one" />
            <span className="admin-users-hero__orbit admin-users-hero__orbit--two" />
            <span className="admin-users-hero__node admin-users-hero__node--one"><UserCheck size={18} /></span>
            <span className="admin-users-hero__node admin-users-hero__node--two"><UsersRound size={17} /></span>
            <span className="admin-users-hero__node admin-users-hero__node--three"><BadgeCheck size={16} /></span>

            <div className="admin-users-hero__directory-card">
              <span className="admin-users-hero__directory-row">
                <span><UserCheck size={15} /></span><i /><i />
              </span>
              <span className="admin-users-hero__directory-row">
                <span><UsersRound size={15} /></span><i /><i />
              </span>
              <span className="admin-users-hero__directory-row">
                <span><BadgeCheck size={15} /></span><i /><i />
              </span>
            </div>

            <span className="admin-users-hero__profile"><UsersRound size={34} /></span>
            <span className="admin-users-hero__shield"><ShieldCheck size={25} /></span>
            <span className="admin-users-hero__platform" />
          </div>
        )}
      </section>

      <section className={`admin-panel ${section === 'users' ? 'admin-panel--users' : ''}`}>
        <div className="admin-panel__head">
          <div>
            <h3>{section === 'users' ? tr('Users directory') : `${config.title} directory`}</h3>
            <p>{meta.total
              ? `${meta.total.toLocaleString(isArabic ? 'ar-JO' : undefined)} ${tr('records available')}`
              : tr('Live administrative data')}</p>
          </div>

          <div className="admin-toolbar">
            {section === 'users' && (
              <span className="admin-users-live-chip"><i /> {tr('Live directory')}</span>
            )}
            <button
              type="button"
              className="admin-btn"
              disabled={refreshing}
              onClick={() => loadData({ quiet: true, fresh: true })}
            >
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} />
              {tr('Refresh')}
            </button>
            {config.exportable && config.api?.exportCsv && (
              <button type="button" className="admin-btn" onClick={handleExport} disabled={refreshing}>
                <Download size={14} />
                {tr('Export CSV')}
              </button>
            )}
          </div>
        </div>

        {!loading && !error && stats.length > 0 && (
          <div className={section === 'users' ? 'admin-user-overview' : 'admin-resource-stats'}>
            <div className={section === 'users' ? 'admin-user-overview__primary' : 'admin-stat-grid'}>
              {stats.slice(0, 4).map((stat, index) => {
                if (section !== 'users') {
                  return (
                    <article className="admin-stat" key={stat.label}>
                      <span className="admin-stat__icon"><Icon size={18} /></span>
                      <strong>{Number(stat.value || 0).toLocaleString()}</strong>
                      <small>{stat.label}</small>
                    </article>
                  );
                }

                const label = String(stat.label || '');
                const inactive = /inactive|deleted|blocked|banned/i.test(label);
                const active = !inactive && /active/i.test(label);
                const verified = /verified/i.test(label);
                const premium = /premium/i.test(label);
                const tone = inactive
                  ? 'inactive'
                  : active
                    ? 'active'
                    : verified
                      ? 'verified'
                      : premium
                        ? 'premium'
                        : 'total';
                const displayLabel = tone === 'inactive'
                  ? 'Inactive users'
                  : tone === 'active'
                    ? 'Active users'
                    : tone === 'verified'
                      ? 'Verified users'
                      : tone === 'premium'
                        ? 'Premium users'
                        : 'Total users';

                return (
                  <article
                    className={`admin-user-stat admin-user-stat--${tone} ${index === 0 ? 'is-featured' : ''}`}
                    key={stat.label}
                  >
                    <span className="admin-user-stat__glow" aria-hidden="true" />
                    <span className="admin-user-stat__icon">
                      {inactive
                        ? <Ban size={22} />
                        : active
                          ? <UserCheck size={22} />
                          : verified
                            ? <ShieldCheck size={22} />
                            : premium
                              ? <Crown size={22} />
                              : <UsersRound size={22} />}
                    </span>
                    <span className="admin-user-stat__copy">
                      <small>{tr(displayLabel)}</small>
                      <strong>{Number(stat.value || 0).toLocaleString(isArabic ? 'ar-JO' : undefined)}</strong>
                      <span>{tr('Current platform snapshot')}</span>
                    </span>
                    <span className="admin-user-stat__signal" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <div className={`admin-filterbar ${section === 'users' ? 'admin-users-filterbar' : ''}`}>
          {section === 'users' && (
            <AdminUserStatusPicker
              value={userStatus}
              tr={tr}
              onChange={(value) => {
                setPage(1);
                setUserStatus(value);
              }}
            />
          )}
          {section === 'users' && (
            <AdminSortPicker
              options={USER_SORT_OPTIONS}
              value={userSortBy}
              order={userSortOrder}
              label="Sort users"
              tr={tr}
              onChange={(field) => {
                setPage(1);
                setUserSortBy(field);
                setUserSortOrder(field === 'createdAt' ? 'desc' : 'asc');
              }}
              onToggleOrder={() => {
                setPage(1);
                setUserSortOrder((value) => value === 'asc' ? 'desc' : 'asc');
              }}
            />
          )}
          {config.searchable && (
            <label className="admin-searchbox">
              <Search size={15} />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={section === 'users' ? tr('Search users...') : `Search ${config.title.toLowerCase()}...`}
                aria-label={section === 'users' ? tr('Search Users') : `Search ${config.title}`}
              />
            </label>
          )}
        </div>

        {notice && section === 'users' && (
          <div className="admin-users-success-toast" role="status" aria-live="polite">
            <span className="admin-users-success-toast__icon">
              <CheckCircle2 size={18} />
            </span>
            <div className="admin-users-success-toast__content">
              <strong>{tr('Email sent successfully')}</strong>
              <span>{tr(notice)}</span>
            </div>
            <button
              type="button"
              className="admin-users-success-toast__close"
              onClick={() => setNotice('')}
              aria-label={tr('Dismiss success message')}
            >
              <XCircle size={17} />
            </button>
          </div>
        )}

        {error && (
          <div className="admin-resource-error">
            <AlertCircle size={18} />
            <span>{tr(error)}</span>
            <button type="button" className="admin-btn" onClick={() => loadData()}>{tr('Try again')}</button>
          </div>
        )}

        {loading ? (
          <div className="admin-resource-loading">
            <LoaderCircle size={25} className="admin-spin" />
            <strong>{section === 'users' ? tr('Loading users…') : `Loading ${config.title.toLowerCase()}…`}</strong>
          </div>
        ) : !error && rows.length === 0 ? (
          <EmptyState search={search} tr={tr} />
        ) : !error ? (
          <>
            {section === 'users' ? (
              <div className="admin-users-cards-shell">
                <div className="admin-users-card-sortbar" aria-label={tr('User sorting controls')}>
                  {columns.map((column) => {
                    const field = USER_COLUMN_SORT_FIELD[column];
                    const active = Boolean(field && userSortBy === field);
                    const SortIcon = !active ? ArrowUpDown : userSortOrder === 'asc' ? ArrowUp : ArrowDown;
                    const label = tr({
                      identity: 'User',
                      accountStatus: 'Plan',
                      usage: 'Usage',
                      accountHealth: 'Account',
                      userType: 'Type',
                      createdAt: 'Joined',
                    }[column] || toReadableLabel(column));

                    return (
                      <button
                        type="button"
                        key={column}
                        className={`admin-users-card-sortbar__item ${active ? 'is-active' : ''}`}
                        onClick={() => field && applyUserSort(field)}
                        disabled={!field}
                        aria-pressed={active}
                        title={field ? `${tr('Sort')} · ${label}` : label}
                      >
                        <span>{label}</span>
                        {field ? <SortIcon size={12} /> : null}
                      </button>
                    );
                  })}
                  <span className="admin-users-card-sortbar__item admin-users-card-sortbar__item--actions">{tr('Actions')}</span>
                </div>

                <div className="admin-users-card-grid">
                  {rows.map((item, index) => {
                    const rowId = item?.id || item?.userId || `${page}-${index}`;
                    return (
                      <article
                        key={rowId}
                        className="admin-user-directory-card"
                        onClick={() => openUserModal(item, 'view')}
                      >
                        <div className="admin-user-directory-card__profile">
                          {renderUserCell(item, 'identity')}
                          <span className="admin-user-directory-card__profile-chip">{tr('User profile')}</span>
                        </div>

                        <div className="admin-user-directory-card__details">
                          <div className="admin-user-directory-card__detail">
                            <span className="admin-user-directory-card__label">{tr('Plan')}</span>
                            {renderUserCell(item, 'accountStatus')}
                          </div>
                          <div className="admin-user-directory-card__detail">
                            <span className="admin-user-directory-card__label">{tr('Usage')}</span>
                            {renderUserCell(item, 'usage')}
                          </div>
                          <div className="admin-user-directory-card__detail">
                            <span className="admin-user-directory-card__label">{tr('Account')}</span>
                            {renderUserCell(item, 'accountHealth')}
                          </div>
                          <div className="admin-user-directory-card__detail">
                            <span className="admin-user-directory-card__label">{tr('Type')}</span>
                            {renderUserCell(item, 'userType')}
                          </div>
                          <div className="admin-user-directory-card__detail">
                            <span className="admin-user-directory-card__label">{tr('Joined')}</span>
                            {renderUserCell(item, 'createdAt')}
                          </div>
                          <div className="admin-user-directory-card__detail admin-user-directory-card__detail--actions">
                            <span className="admin-user-directory-card__label">{tr('Actions')}</span>
                            {renderUserActions(item)}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{toReadableLabel(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item, index) => {
                      const rowId = item?.id || item?.userId || item?.ideaId || item?.paymentId || `${page}-${index}`;
                      return (
                        <tr key={rowId} onClick={() => setSelected(item)}>
                          {columns.map((column) => (
                            <td key={`${rowId}-${column}`}>
                              <CellValue value={item?.[column]} column={column} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="admin-resource-pagination">
              <span>{tr('Page')} {meta.page} {tr('of')} {meta.totalPages}</span>
              <div>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft size={14} /> {tr('Previous')}
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={page >= meta.totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  {tr('Next')} <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {section === 'users' && openUserActionMenu && typeof document !== 'undefined' && createPortal(
        <div
          className={`admin-user-actions-popover ${isArabic ? 'is-rtl' : ''}`}
          role="menu"
          aria-label={tr('More user actions')}
          style={{
            top: `${openUserActionMenu.top}px`,
            left: `${openUserActionMenu.left}px`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="admin-user-actions-popover__head">
            <UserAvatar
              user={openUserActionMenu.item}
              name={firstDefined(
                openUserActionMenu.item,
                ['fullName', 'name', 'displayName', 'email'],
                'U',
              )}
              className="admin-user-actions-popover__avatar"
            />
            <span>
              <small>{tr('More actions')}</small>
              <strong>
                {firstDefined(
                  openUserActionMenu.item,
                  ['fullName', 'name', 'displayName'],
                  tr('User account'),
                )}
              </strong>
            </span>
          </div>

          <div className="admin-user-actions-popover__body">
            {config.api?.resetPassword ? (
              <button
                type="button"
                role="menuitem"
                disabled={busyId === openUserActionMenu.id}
                onClick={() => {
                  const id = openUserActionMenu.id;
                  setOpenUserActionMenu(null);
                  runMutation(
                    id,
                    () => config.api.resetPassword(id),
                    tr('Password reset email sent successfully.'),
                  );
                }}
              >
                <span className="admin-user-actions-popover__icon">
                  <Mail size={14} />
                </span>
                <span>
                  <strong>{tr('Send password recovery')}</strong>
                  <small>{tr('Email a secure reset link')}</small>
                </span>
              </button>
            ) : null}

            {config.api?.remove ? (
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={busyId === openUserActionMenu.id}
                onClick={() => {
                  const id = openUserActionMenu.id;
                  setOpenUserActionMenu(null);
                  if (
                    window.confirm(
                      tr('Delete this user account? This action may be irreversible.'),
                    )
                  ) {
                    runMutation(id, () => config.api.remove(id));
                  }
                }}
              >
                <span className="admin-user-actions-popover__icon">
                  <Trash2 size={14} />
                </span>
                <span>
                  <strong>{tr('Delete user')}</strong>
                  <small>{tr('Remove the customer account')}</small>
                </span>
              </button>
            ) : null}
          </div>
        </div>,
        document.body,
      )}

      {selected && section === 'users' && createPortal(
        <div className={`admin-user-modal-layer ${isArabic ? 'is-rtl' : ''}`} role="presentation" onMouseDown={closeUserModal}>
          <section
            className={`admin-user-modal admin-user-modal--${userModalMode}`}
            role="dialog"
            aria-modal="true"
            aria-label={tr(userModalMode === 'edit' ? 'Edit user' : 'User profile')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-user-modal__glow" aria-hidden="true" />
            <header className="admin-user-modal__header">
              <div className="admin-user-modal__heading">
                <span className="admin-user-modal__eyebrow">
                  {userModalMode === 'edit' ? <UserRoundCog size={14} /> : <Sparkles size={14} />}
                  {tr(userModalMode === 'edit' ? 'Account editor' : 'Member intelligence')}
                </span>
                <h3>{tr(userModalMode === 'edit' ? 'Edit user' : 'User profile')}</h3>
                <p>{tr(userModalMode === 'edit' ? 'Update account identity and access without leaving this workspace.' : 'A focused snapshot of identity, access and platform activity.')}</p>
              </div>
              <button className="admin-user-modal__close" type="button" onClick={closeUserModal} aria-label={tr('Close')} disabled={savingUser}>
                <XCircle size={20} />
              </button>
            </header>

            {userModalMode === 'view' ? (
              <div className="admin-user-modal__content admin-user-view">
                <section className="admin-user-view__hero">
                  <div className="admin-user-view__avatar-wrap">
                    <UserAvatar
                      user={selected}
                      name={firstDefined(selected, ['name', 'fullName', 'displayName', 'email'], 'U')}
                      className="admin-user-view__avatar"
                    />
                    <i className={selectedIsDeleted || selected?.isActive === false ? 'is-offline' : ''} />
                  </div>
                  <div className="admin-user-view__identity">
                    <small>{tr('Voxidence member')}</small>
                    <h4>{firstDefined(selected, ['name', 'fullName', 'displayName'], tr('Unnamed user'))}</h4>
                    <p><Mail size={13} /> {firstDefined(selected, ['email'], tr('No email'))}</p>
                    <div className="admin-user-view__chips">
                      <span>{localizeUserEnum(firstDefined(selected, ['role'], 'User'), isArabic)}</span>
                      <span>{localizeUserEnum(firstDefined(selected, ['plan', 'tier', 'accountPlan'], 'Normal'), isArabic)}</span>
                      <span className={selectedIsDeleted || selected?.isActive === false ? 'is-danger' : 'is-success'}>{tr(selectedIsDeleted ? 'Deleted' : selected?.isActive === false ? 'Inactive' : 'Active')}</span>
                      <span className={(selected?.isVerified || selected?.emailVerified) ? 'is-success' : ''}>{tr((selected?.isVerified || selected?.emailVerified) ? 'Verified' : 'Unverified')}</span>
                    </div>
                  </div>
                  {!selectedIsDeleted ? (
                    <button type="button" className="admin-user-view__edit-cta" onClick={() => setUserModalMode('edit')}>
                      <Pencil size={15} /> {tr('Edit profile')}
                    </button>
                  ) : null}
                </section>

                <section className="admin-user-view__metrics">
                  <article><span><Coins size={17} /></span><div><small>{tr('Credit balance')}</small><strong>{Number(firstDefined(selected, ['creditBalance', 'credits'], 0) || 0).toLocaleString(isArabic ? 'ar-JO' : undefined)}</strong></div></article>
                  <article><span><Sparkles size={17} /></span><div><small>{tr('Ideas')}</small><strong>{Number(firstDefined(selected, ['ideasCount', 'generatedIdeasCount', '_count.ideas'], 0) || 0).toLocaleString(isArabic ? 'ar-JO' : undefined)}</strong></div></article>
                  <article><span><KeyRound size={17} /></span><div><small>{tr('Free generations')}</small><strong>{Number(firstDefined(selected, ['freeGenerationsUsed'], 0) || 0)} / {Number(firstDefined(selected, ['freeGenerationLimit'], 3) || 3)}</strong></div></article>
                  <article><span><CalendarDays size={17} /></span><div><small>{tr('Member since')}</small><strong>{(() => { const d = new Date(selected?.createdAt); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(isArabic ? 'ar-JO' : undefined, { month: 'short', year: 'numeric' }); })()}</strong></div></article>
                </section>

                <section className="admin-user-view__details-card">
                  <div className="admin-user-view__section-title">
                    <span><ShieldCheck size={16} /></span>
                    <div><h5>{tr('Identity & access')}</h5><p>{tr('Core account details and current permissions.')}</p></div>
                  </div>
                  <div className="admin-user-view__detail-grid">
                    <div><small>{tr('Full name')}</small><strong>{firstDefined(selected, ['name', 'fullName', 'displayName'], '—')}</strong></div>
                    <div><small>{tr('Email address')}</small><strong>{firstDefined(selected, ['email'], '—')}</strong></div>
                    <div><small>{tr('User type')}</small><strong>{localizeUserEnum(firstDefined(selected, ['userType', 'type'], '—'), isArabic)}</strong></div>
                    <div><small>{tr('Role')}</small><strong>{localizeUserEnum(firstDefined(selected, ['role'], '—'), isArabic)}</strong></div>
                    <div><small>{tr('Account state')}</small><strong>{tr(selected?.isActive === false ? 'Inactive' : 'Active')}</strong></div>
                    <div><small>{tr('Email state')}</small><strong>{tr((selected?.isVerified || selected?.emailVerified) ? 'Verified' : 'Not verified')}</strong></div>
                    <div className="is-wide"><small>{tr('Record ID')}</small><strong className="is-code">{selected?.id || selected?.userId || '—'}</strong></div>
                    <div><small>{tr('Last updated')}</small><strong>{selected?.updatedAt ? new Date(selected.updatedAt).toLocaleString(isArabic ? 'ar-JO' : undefined) : '—'}</strong></div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="admin-user-modal__content admin-user-edit">
                <aside className="admin-user-edit__profile">
                  <div className="admin-user-edit__avatar">{String(firstDefined(selected, ['name', 'fullName', 'displayName', 'email'], 'U')).trim().charAt(0).toUpperCase()}</div>
                  <span className="admin-user-edit__kicker">{tr('Editing member')}</span>
                  <h4>{firstDefined(selected, ['name', 'fullName', 'displayName'], tr('User'))}</h4>
                  <p>{firstDefined(selected, ['email'], tr('No email'))}</p>
                  <div className="admin-user-edit__status"><i className={selected?.isActive === false ? 'is-off' : ''} /> {tr(selected?.isActive === false ? 'Account inactive' : 'Account active')}</div>
                  <div className="admin-user-edit__note"><ShieldCheck size={16} /><span><strong>{tr('Protected editor')}</strong><small>{tr('Changes are applied through the administrative API and saved immediately.')}</small></span></div>
                </aside>

                <div className="admin-user-edit__workspace">
                  <div className="admin-user-edit__workspace-head">
                    <div><small>{tr('PROFILE SETTINGS')}</small><h4>{tr('Account configuration')}</h4></div>
                    <span><Sparkles size={13} /> {tr('Live editor')}</span>
                  </div>
                  {modalError && <div className="admin-user-edit__error"><AlertCircle size={15} /> {tr(modalError)}</div>}
                  <div className="admin-user-edit__form">
                    <label className="admin-user-edit__field admin-user-edit__field--wide">
                      <span>{tr('Full name')}</span>
                      <input value={userForm.fullName} onChange={(e) => setUserForm((v) => ({ ...v, fullName: e.target.value }))} maxLength={120} placeholder={tr('User name')} autoFocus />
                    </label>
                    <label className="admin-user-edit__field">
                      <span>{tr('User type')}</span>
                      <select value={userForm.userType} onChange={(e) => setUserForm((v) => ({ ...v, userType: e.target.value }))}>
                        {['STUDENT', 'DEVELOPER', 'COMPANY', 'RESEARCHER', 'OTHER'].map((value) => <option key={value} value={value}>{localizeUserEnum(value, isArabic)}</option>)}
                      </select>
                    </label>
                    <div className="admin-user-edit__plan-card">
                      <span>{tr('Account plan')}</span>
                      <div>
                        <strong className={`admin-user-plan-badge is-${String(userForm.accountStatus || 'NORMAL').toLowerCase()}`}>
                          <Crown size={14} />
                          {localizeUserEnum(userForm.accountStatus, isArabic)}
                        </strong>
                        <small>{tr('Plan follows the committed credit balance automatically.')}</small>
                      </div>
                    </div>

                    <label className="admin-user-edit__field">
                      <span>{tr('Credit balance')}</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={userForm.creditBalance}
                        onChange={(e) => {
                          const value = e.target.value;
                          setUserForm((v) => ({
                            ...v,
                            creditBalance: value,
                            accountStatus: Number(value) > 0 ? 'PREMIUM' : 'NORMAL',
                          }));
                        }}
                      />
                      <small>{tr('Changing credits creates an audited ADMIN_ADJUSTMENT ledger entry.')}</small>
                    </label>

                    <label className="admin-user-edit__field">
                      <span>{tr('Free generations used')}</span>
                      <input
                        type="number"
                        min="0"
                        max={Number(userForm.freeGenerationLimit || 0)}
                        step="1"
                        value={userForm.freeGenerationsUsed}
                        onChange={(e) => setUserForm((v) => ({ ...v, freeGenerationsUsed: e.target.value }))}
                      />
                    </label>

                    <label className="admin-user-edit__field">
                      <span>{tr('Free generation limit')}</span>
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        step="1"
                        value={userForm.freeGenerationLimit}
                        onChange={(e) => setUserForm((v) => ({ ...v, freeGenerationLimit: e.target.value }))}
                      />
                    </label>

                    {Number(userForm.creditBalance) !== Number(firstDefined(selected, ['creditBalance', 'credits'], 0) ?? 0) ? (
                      <label className="admin-user-edit__field admin-user-edit__field--wide admin-user-edit__credit-reason">
                        <span>{tr('Credit adjustment reason')}</span>
                        <input
                          value={userForm.creditReason}
                          onChange={(e) => setUserForm((v) => ({ ...v, creditReason: e.target.value }))}
                          maxLength={500}
                          placeholder={tr('Example: Manual correction approved by support')}
                        />
                        <small>{tr('This note is stored in the credit ledger and audit log.')}</small>
                      </label>
                    ) : null}
                    <label className="admin-user-edit__switch">
                      <span><strong>{tr('Email verification')}</strong><small>{tr('Control the verified state stored on this account.')}</small></span>
                      <input type="checkbox" checked={userForm.isVerified} onChange={(e) => setUserForm((v) => ({ ...v, isVerified: e.target.checked }))} />
                      <i />
                    </label>
                    <div className="admin-user-edit__locked admin-user-edit__field--wide"><Mail size={16} /><span><small>{tr('Protected email')}</small><strong>{firstDefined(selected, ['email'], '—')}</strong></span><em>{tr('Protected')}</em></div>
                    <div className="admin-user-edit__locked admin-user-edit__field--wide"><ShieldCheck size={16} /><span><small>{tr('Protected role')}</small><strong>{localizeUserEnum(firstDefined(selected, ['role'], 'USER'), isArabic)}</strong></span><em>{tr('Protected')}</em></div>
                  </div>
                  <div className="admin-user-edit__actions">
                    <button type="button" className="admin-user-edit__cancel" onClick={() => setUserModalMode('view')} disabled={savingUser}>{tr('Cancel')}</button>
                    <button type="button" className="admin-user-edit__save" onClick={handleSaveUser} disabled={
                      savingUser ||
                      !userForm.fullName.trim() ||
                      Number(userForm.freeGenerationsUsed) < 0 ||
                      Number(userForm.freeGenerationLimit) < Number(userForm.freeGenerationsUsed) ||
                      Number(userForm.creditBalance) < 0
                    }>
                      {savingUser ? <LoaderCircle size={16} className="admin-spin" /> : <Save size={16} />}
                      {tr(savingUser ? 'Saving…' : 'Save changes')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>,
        document.body,
      )}

      {selected && section !== 'users' && (
        <div className="admin-resource-modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="admin-resource-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><small>Record inspector</small><h3>{firstDefined(selected, ['name', 'fullName', 'title', 'email', 'displayName'], config.title)}</h3></div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close"><XCircle size={19} /></button>
            </header>
            <div className="admin-resource-modal__body">
              {Object.entries(selected).filter(([key]) => !HIDDEN_COLUMNS.has(key)).map(([key, value]) => (
                <div className="admin-resource-detail" key={key}><span>{toReadableLabel(key)}</span><strong>{formatValue(value)}</strong></div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}