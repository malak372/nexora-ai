/**
 * Voxidence normal-user idea workspace.
 *
 * Visual identity is provided by idea-workspace.css using the current
 * pearl, eucalyptus, and soft-rose palette. Existing API calls, permissions,
 * navigation, section order, unlock logic, publication logic, and Framer
 * Motion interactions remain unchanged.
 */
import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  Globe2,
  Layers3,
  LockKeyhole,
  Rocket,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { getIdeaWorkspaceBundle } from '../api/ideaWorkspaceApi';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { preloadAiChatWorkspace } from '../../../../routes/routePreloaders';
import { useUserExperience } from '../../../../system/user-experience';

import '../styles/idea-workspace.css';

const UNLOCK_REFRESH_INTERVAL_MS = 1200;
const UNLOCK_REFRESH_MAX_ATTEMPTS = 75;

const text = (value) => {
  if (Array.isArray(value)) return value.join('\n');
  return value || 'Not available yet.';
};

const humanizeKey = (value) =>
  String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());


const ARABIC_WORKSPACE_SECTION_TITLES = Object.freeze({
  'full abstract': 'الملخص الكامل',
  'executive summary': 'الملخص التنفيذي',
  'technology stack': 'التقنيات المستخدمة',
  'technical stack': 'التقنيات المستخدمة',
  'system architecture': 'معمارية النظام',
  'solution architecture': 'معمارية الحل',
  'database design': 'تصميم قاعدة البيانات',
  'data model': 'نموذج البيانات',
  'mvp features': 'ميزات المنتج الأولي',
  'mvp feature set': 'ميزات المنتج الأولي',
  'value proposition': 'عرض القيمة',
  'business model': 'نموذج العمل',
  'revenue model': 'نموذج الإيرادات',
  'market analysis': 'تحليل السوق',
  'competitive analysis': 'تحليل المنافسين',
  'implementation plan': 'خطة التنفيذ',
  'project plan': 'خطة المشروع',
  'roadmap': 'خارطة الطريق',
  'development roadmap': 'خارطة طريق التطوير',
  'product roadmap': 'خارطة طريق المنتج',
  'security and privacy': 'الأمان والخصوصية',
  'security privacy': 'الأمان والخصوصية',
  'api design': 'تصميم واجهات البرمجة',
  'deployment strategy': 'استراتيجية النشر',
  'testing strategy': 'استراتيجية الاختبار',
  'user flows': 'مسارات المستخدم',
  'risk assessment': 'تقييم المخاطر',
  'scalability plan': 'خطة قابلية التوسع',
  'technical requirements': 'المتطلبات التقنية',
  'functional requirements': 'المتطلبات الوظيفية',
  'non functional requirements': 'المتطلبات غير الوظيفية',
  'ui ux design': 'تصميم واجهة وتجربة المستخدم',
  'technical specifications': 'المواصفات التقنية',
  'technical specification': 'المواصفات التقنية',
  'acceptance criteria': 'معايير القبول',
  'product requirements': 'متطلبات المنتج',
  'budget estimation': 'تقدير الميزانية',
  'budget estimate': 'تقدير الميزانية',
  'cost estimation': 'تقدير التكاليف',
  'cost estimate': 'تقدير التكاليف',
  'feasibility assessment': 'تقييم الجدوى',
  'feasibility analysis': 'تحليل الجدوى',
  'implementation timeline': 'الجدول الزمني للتنفيذ',
  'project timeline': 'الجدول الزمني للمشروع',
  'development timeline': 'الجدول الزمني للتطوير',
  'market potential': 'إمكانات السوق',
  'market opportunity': 'فرصة السوق',
  'nlp executive summary': 'الملخص التنفيذي للمعالجة اللغوية',
  'natural language processing executive summary': 'الملخص التنفيذي للمعالجة اللغوية',
  'community feedback summary': 'ملخص ملاحظات المجتمع',
  'community feedback': 'ملاحظات المجتمع',
  'local regulations': 'اللوائح المحلية',
  'local regulation': 'اللوائح المحلية',
  'local regulatory requirements': 'المتطلبات التنظيمية المحلية',
  'regulatory requirements': 'المتطلبات التنظيمية',
  'regulatory compliance': 'الامتثال التنظيمي',
});

const normalizeWorkspaceSectionTitle = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');

const localizeWorkspaceSectionTitle = (section, language, t) => {
  const rawTitle = section?.title || humanizeKey(section?.key);

  if (language !== 'ar') return rawTitle;

  const candidates = [
    rawTitle,
    section?.key,
    humanizeKey(section?.key),
  ];

  for (const candidate of candidates) {
    const translated = ARABIC_WORKSPACE_SECTION_TITLES[
      normalizeWorkspaceSectionTitle(candidate)
    ];
    if (translated) return translated;
  }

  return t(rawTitle);
};

/**
 * Converts backend generation enums into user-facing product labels.
 * The API value remains unchanged so permissions and business logic are safe.
 */
const formatGenerationType = (generationType) => {
  const labels = {
    NORMAL_FREE: 'Free generation',
    PREMIUM_CREDIT: 'Premium generation',
    GUEST: 'Guest generation',
  };

  return labels[generationType] || humanizeKey(generationType) || 'AI generated';
};

function WorkspaceContent({ value }) {
  if (Array.isArray(value)) {
    return (
      <ul className="workspace-list">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>
            <span className="workspace-list__icon">
              <CheckCircle2 size={17} />
            </span>
            <span className="workspace-list__index">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="workspace-list__copy">{String(item)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <div className="workspace-structured">
        {Object.entries(value).map(([key, item], index) => (
          <section key={key}>
            <div className="workspace-structured__header">
              <span className="workspace-structured__number">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="workspace-structured__label">
                {humanizeKey(key)}
              </span>
            </div>
            <p>
              {Array.isArray(item)
                ? item.join(' · ')
                : typeof item === 'object' && item !== null
                  ? JSON.stringify(item, null, 2)
                  : String(item)}
            </p>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="workspace-paragraphs">
      {text(value)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => (
          <article key={`${line}-${index}`}>
            <span className="workspace-paragraphs__marker">
              <Sparkles size={15} />
            </span>
            <p>{line}</p>
          </article>
        ))}
    </div>
  );
}

function WorkspaceLoadingState({ t }) {
  return (
    <section className="workspace-state workspace-state--loading">
      <span className="workspace-state__orb">
        <WandSparkles size={24} />
      </span>
      <div>
        <h1>{t('Preparing your idea workspace')}</h1>
        <p>{t('Organizing the core brief and available execution outputs.')}</p>
      </div>
      <span className="workspace-state__progress" aria-hidden="true">
        <i />
      </span>
    </section>
  );
}

function WorkspaceSectionArtwork({ section, index, label }) {
  const Icon = section?.icon || FileText;
  const tone = ['mint', 'rose', 'sky', 'pearl'][index % 4];

  return (
    <div
      className={`workspace-section-art workspace-section-art--${tone}`}
      aria-hidden="true"
    >
      <span className="workspace-section-art__grid" />
      <span className="workspace-section-art__orbit workspace-section-art__orbit--one" />
      <span className="workspace-section-art__orbit workspace-section-art__orbit--two" />
      <span className="workspace-section-art__line workspace-section-art__line--one" />
      <span className="workspace-section-art__line workspace-section-art__line--two" />

      <span className="workspace-section-art__node workspace-section-art__node--a">
        <Sparkles size={13} />
      </span>
      <span className="workspace-section-art__node workspace-section-art__node--b">
        <CheckCircle2 size={13} />
      </span>
      <span className="workspace-section-art__node workspace-section-art__node--c">
        <Rocket size={13} />
      </span>

      <span className="workspace-section-art__core">
        <Icon size={28} />
      </span>

      <span className="workspace-section-art__label">
        <Sparkles size={11} />
        {label}
      </span>
    </div>
  );
}

export default function IdeaWorkspacePage() {
  const shouldReduceMotion = useReducedMotion();
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isPremium } = useAccountAccess();
  const { t, language } = useUserExperience();

  const routeIdeaSeed = location.state?.ideaSeed ?? null;
  const [idea, setIdea] = useState(() => routeIdeaSeed);
  const [outputs, setOutputs] = useState([]);
  const [activeKey, setActiveKey] = useState('overview');
  const [loading, setLoading] = useState(() => !routeIdeaSeed);
  const [error, setError] = useState('');
  const [unlockProcessing, setUnlockProcessing] = useState(
    Boolean(location.state?.unlockProcessing),
  );
  const unlockRefreshAttemptsRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { idea: loadedIdea, outputs: loadedOutputs } =
          await getIdeaWorkspaceBundle(ideaId, {
            forceRefresh: Boolean(location.state?.forceRefresh),
          });

        if (!mounted) return;

        setIdea(loadedIdea);
        setOutputs(loadedIdea?.isUnlocked ? loadedOutputs : []);
        if (loadedIdea?.isUnlocked) {
          setUnlockProcessing(false);
        }
      } catch (requestError) {
        if (mounted && !routeIdeaSeed) setError(requestError.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [ideaId, location.state?.forceRefresh, routeIdeaSeed]);

  useEffect(() => {
    if (!isPremium || !ideaId || !idea?.isUnlocked) return undefined;

    const timerId = window.setTimeout(() => {
      preloadAiChatWorkspace(ideaId);
    }, 120);

    return () => window.clearTimeout(timerId);
  }, [idea?.isUnlocked, ideaId, isPremium]);

  useEffect(() => {
    if (!unlockProcessing || !ideaId || idea?.isUnlocked) return undefined;

    let cancelled = false;
    let timerId = null;

    const refreshUnlockState = async () => {
      if (cancelled) return;

      if (unlockRefreshAttemptsRef.current >= UNLOCK_REFRESH_MAX_ATTEMPTS) {
        setUnlockProcessing(false);
        return;
      }

      unlockRefreshAttemptsRef.current += 1;

      try {
        const { idea: latestIdea, outputs: latestOutputs } =
          await getIdeaWorkspaceBundle(ideaId, { forceRefresh: true });

        if (cancelled) return;

        if (latestIdea) {
          setIdea(latestIdea);
        }

        if (latestIdea?.isUnlocked) {
          setOutputs(Array.isArray(latestOutputs) ? latestOutputs : []);
          setUnlockProcessing(false);
          return;
        }
      } catch {
        // A transient refresh failure should not throw the user out of the
        // workspace. The next lightweight poll will retry automatically.
      }

      if (!cancelled) {
        timerId = window.setTimeout(
          refreshUnlockState,
          UNLOCK_REFRESH_INTERVAL_MS,
        );
      }
    };

    timerId = window.setTimeout(refreshUnlockState, 250);

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [ideaId, idea?.isUnlocked, unlockProcessing]);

  const sections = useMemo(() => {
    if (!idea) return [];

    return [
      {
        key: 'overview',
        title: 'Overview',
        caption: 'The complete idea narrative',
        icon: FileText,
        content:
          idea.fullAbstract ||
          idea.partialAbstract ||
          idea.limitedAbstract,
      },
      {
        key: 'problem',
        title: 'Problem',
        caption: 'The validated need behind the idea',
        icon: Layers3,
        content: idea.problemStatement,
      },
      {
        key: 'objectives',
        title: 'Objectives',
        caption: 'What the solution is designed to achieve',
        icon: Rocket,
        content: idea.objectives,
      },
      {
        key: 'users',
        title: 'Target users',
        caption: 'The audience this opportunity serves',
        icon: Globe2,
        content: idea.targetUsers,
      },
      ...outputs.map((output) => ({
        key: output.outputKey,
        title: output.title,
        caption: 'Advanced execution output',
        icon: Sparkles,
        content: output.content || output.structuredContent,
        preserveTitle: Boolean(output.title),
      })),
    ];
  }, [idea, outputs]);

  const current =
    sections.find((section) => section.key === activeKey) ?? sections[0];
  const currentIndex = Math.max(
    0,
    sections.findIndex((section) => section.key === current?.key),
  );
  const coreJourneySections = sections.slice(0, Math.min(4, sections.length));

  if (loading) return <WorkspaceLoadingState t={t} />;

  if (error || !idea) {
    return (
      <section className="workspace-state">
        <span className="workspace-state__orb workspace-state__orb--error">
          <LockKeyhole size={24} />
        </span>
        <div>
          <h1>{t('Idea unavailable')}</h1>
          <p>{error || (language === 'ar' ? 'تعذر تحميل مساحة العمل هذه.' : 'This workspace could not be loaded.')}</p>
        </div>
        <button type="button" onClick={() => navigate(workspacePath('/normal/ideas'))}>
          <ArrowLeft size={17} />
          {t('Back to My ideas')}
        </button>
      </section>
    );
  }

  const createdDate = idea.createdAt
    ? new Date(idea.createdAt).toLocaleDateString(language === 'ar' ? 'ar' : 'en', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    : t('Not available');

  return (
    <motion.main
      className="idea-workspace"
      initial={shouldReduceMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
    >
      <button
        className="workspace-back"
        type="button"
        onClick={() => navigate(workspacePath('/normal/ideas'))}
      >
        <ArrowLeft size={17} />
        <span>{t('My ideas')}</span>
      </button>

      <motion.section
        className="workspace-hero"
        initial={
          shouldReduceMotion
            ? undefined
            : { opacity: 0, y: 24, scale: 0.985 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: 0.68,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="workspace-hero__orb workspace-hero__orb--one" />
        <div className="workspace-hero__orb workspace-hero__orb--two" />
        <div className="workspace-hero__grid" aria-hidden="true" />
        <div className="workspace-hero__content">
          <span className="workspace-eyebrow">
            <Sparkles size={14} />
            {t('Private idea workspace')}
          </span>

          <h1 dir="auto" data-idea-content="true">{idea.title}</h1>

          <p>
            <span dir="auto" data-idea-content="true">{idea.domain?.name || t('General innovation')}</span>
            <span aria-hidden="true">·</span>
            <span dir="auto" data-idea-content="true">{idea.selectedRegion || t('Global scope')}</span>
          </p>

          <div className="workspace-hero__status">
            <span className={idea.isUnlocked ? 'is-unlocked' : 'is-core'}>
              {idea.isUnlocked ? (
                <CheckCircle2 size={14} />
              ) : (
                <LockKeyhole size={14} />
              )}
              {idea.isUnlocked
                ? t('Advanced workspace')
                : unlockProcessing
                  ? t('Preparing advanced workspace')
                  : t('Core workspace')}
            </span>

            <span>
              <CalendarDays size={14} />
              {t('Created')} {createdDate}
            </span>
          </div>
        </div>

        {unlockProcessing && !idea.isUnlocked ? (
          <div
            className="workspace-unlock-progress"
            role="status"
            aria-live="polite"
          >
            <WandSparkles size={18} />
            <span>
              <strong>{t('Preparing advanced outputs…')}</strong>
              <small>
                {t('Your payment is confirmed. You can stay on this page while the advanced workspace finishes in the background.')}
              </small>
            </span>
          </div>
        ) : null}

        <div className="workspace-actions">
          {!idea.isUnlocked && !unlockProcessing ? (
            <button
              className="workspace-primary"
              type="button"
              onClick={() => navigate(workspacePath(`/normal/ideas/${ideaId}/unlock`))}
            >
              <LockKeyhole size={17} />
              <span>
                <strong>{t(isPremium ? 'Unlock idea' : 'Direct unlock')}</strong>
                <small>{t('Open advanced outputs')}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : idea.isUnlocked ? (
            <button
              type="button"
              onClick={() =>
                navigate(workspacePath(`/normal/ideas/${ideaId}/business-model`))
              }
            >
              <BriefcaseBusiness size={17} />
              <span>
                <strong>{t('Business model')}</strong>
                <small>{t('Shape the strategy')}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : null}

          {isPremium && idea.isUnlocked ? (
            <button
              className="workspace-premium-chat"
              type="button"
              onMouseEnter={() => preloadAiChatWorkspace(ideaId)}
              onFocus={() => preloadAiChatWorkspace(ideaId)}
              onPointerDown={() => preloadAiChatWorkspace(ideaId)}
              onClick={() =>
                navigate(workspacePath(`/normal/ideas/${ideaId}/chat`), {
                  state: {
                    chatOrigin: 'owned-idea',
                    returnTo: workspacePath(`/normal/ideas/${ideaId}`),
                    returnLabel: 'Idea workspace',
                    ideaTitle: idea?.title,
                    ideaSeed: idea,
                  },
                })
              }
            >
              <Bot size={17} />
              <span>
                <strong>{t('AI Chat')}</strong>
                <small>{t('Discuss this idea')}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() =>
              navigate(workspacePath(`/normal/ideas/${ideaId}/publish`), {
                state: {
                  returnTo: workspacePath(`/normal/ideas/${ideaId}`),
                  returnLabel: 'Idea workspace',
                  workspaceReturnTo: location.state?.returnTo || workspacePath('/normal/ideas'),
                  workspaceReturnLabel:
                    location.state?.returnLabel || 'My ideas',
                  publicationOrigin: 'idea-workspace',
                  // Publication Studio paints immediately from the workspace
                  // data already on screen and refreshes quietly in background.
                  ideaSeed: idea,
                },
              })
            }
          >
            <Globe2 size={17} />
            <span>
              <strong>
                {String(idea.publication?.status ?? '').toUpperCase() === 'PUBLISHED'
                  ? t('Edit publication')
                  : (language === 'ar' ? 'نشر الفكرة' : 'Publish idea')}
              </strong>
              <small>
                {String(idea.publication?.status ?? '').toUpperCase() === 'PUBLISHED'
                  ? t('Update the public story')
                  : t('Prepare the public story')}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
      </motion.section>

      <motion.section
        className="workspace-summary-grid"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.25 }}
        transition={{ duration: 0.5 }}
      >
        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <Rocket size={20} />
          </span>
          <div>
            <span>{t('Generation type')}</span>
            <strong>{t(formatGenerationType(idea.generationType))}</strong>
          </div>
        </motion.article>

        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <span>{t('Workspace access')}</span>
            <strong>{t(idea.isUnlocked ? 'Unlocked' : 'Core access')}</strong>
          </div>
        </motion.article>

        <motion.article
          whileHover={shouldReduceMotion ? undefined : { y: -5, scale: 1.01 }}
          transition={{ duration: 0.18 }}
        >
          <span className="workspace-summary-grid__icon">
            <CalendarDays size={20} />
          </span>
          <div>
            <span>{t('Created')}</span>
            <strong>{createdDate}</strong>
          </div>
        </motion.article>
      </motion.section>

      <motion.section
        className="workspace-storyline"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5 }}
        aria-label={t('Core idea journey')}
      >
        <div className="workspace-storyline__intro">
          <span className="workspace-storyline__spark">
            <Sparkles size={17} />
          </span>
          <div>
            <span>{t('IDEA JOURNEY')}</span>
            <strong>{t('Explore the story visually')}</strong>
          </div>
        </div>

        <div className="workspace-storyline__track">
          {coreJourneySections.map((section, index) => {
            const Icon = section.icon || FileText;
            const isActive = current?.key === section.key;

            return (
              <button
                key={section.key}
                className={isActive ? 'is-active' : ''}
                type="button"
                onClick={() => setActiveKey(section.key)}
              >
                <span className="workspace-storyline__node">
                  <Icon size={17} />
                </span>
                <span>
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <strong dir="auto">
                    {localizeWorkspaceSectionTitle(section, language, t)}
                  </strong>
                </span>
              </button>
            );
          })}
        </div>

        {sections.length > 4 ? (
          <div className="workspace-storyline__advanced">
            <WandSparkles size={15} />
            <span>
              <strong>{t(`${sections.length - 4} advanced outputs`)}</strong>
              <small>{t('Continue the journey in the document navigator.')}</small>
            </span>
          </div>
        ) : null}
      </motion.section>

      <motion.section
        className="workspace-body"
        initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.12 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <aside aria-label={t('Idea document sections')}>
          <div className="workspace-nav__intro">
            <span><FileText size={16} /></span>
            <div>
              <strong>{t('Idea document')}</strong>
              <small>{t(`${sections.length} sections available`)}</small>
            </div>
          </div>

          <div className="workspace-nav__progress" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(
                  8,
                  ((currentIndex + 1) / Math.max(sections.length, 1)) * 100,
                )}%`,
              }}
            />
          </div>

          <div className="workspace-nav__list">
            {sections.map((section, index) => {
              const Icon = section.icon || FileText;
              const isActive = activeKey === section.key;

              return (
                <motion.button
                  key={section.key}
                  className={isActive ? 'is-active' : ''}
                  type="button"
                  onClick={() => setActiveKey(section.key)}
                  whileHover={
                    shouldReduceMotion
                      ? undefined
                      : { x: 4 }
                  }
                  whileTap={
                    shouldReduceMotion
                      ? undefined
                      : { scale: 0.985 }
                  }
                >
                  <span className="workspace-nav__number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="workspace-nav__icon">
                    <Icon size={16} />
                  </span>
                  <span className="workspace-nav__copy">
                    <strong dir="auto">
                      {localizeWorkspaceSectionTitle(section, language, t)}
                    </strong>
                    <small>{t(section.caption)}</small>
                  </span>
                  <ChevronRight
                    className="workspace-nav__arrow"
                    size={15}
                  />
                </motion.button>
              );
            })}
          </div>
        </aside>

        <motion.article
          className="workspace-document"
          initial={shouldReduceMotion ? undefined : { opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.55 }}
        >
          <div className="workspace-document__header">
            <div className="workspace-document__heading">
              <span>{t('Idea document')}</span>
              <h2 dir="auto">
                {localizeWorkspaceSectionTitle(current, language, t)}
              </h2>
              <p>{t(current.caption)}</p>

              <div className="workspace-document__chapter">
                <span>
                  {language === 'ar' ? `الفصل ${String(currentIndex + 1).padStart(2, '0')}` : `Chapter ${String(currentIndex + 1).padStart(2, '0')}`}
                </span>
                <i aria-hidden="true" />
                <span>
                  {t(currentIndex < 4 ? 'Core narrative' : 'Execution output')}
                </span>
              </div>
            </div>

            <div className="workspace-document__visual">
              <WorkspaceSectionArtwork section={current} index={currentIndex} label={t('Idea signal')} />
              <span className="workspace-document__badge">
                {String(currentIndex + 1).padStart(2, '0')}
              </span>
            </div>
          </div>

          <motion.div
            className="workspace-copy"
            key={current.key}
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div data-idea-content="true" dir="auto"><WorkspaceContent value={current.content} /></div>
          </motion.div>
        </motion.article>
      </motion.section>
    </motion.main>
  );
}