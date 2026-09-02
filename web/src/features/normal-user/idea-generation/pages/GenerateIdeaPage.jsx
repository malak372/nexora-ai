import { workspacePath } from '../../shared/utils/workspacePath';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  MapPin,
  Mic,
  MicOff,
  Search,
  ShoppingCart,
  Sparkles,
  Sprout,
  Truck,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { useUserExperience } from '../../../../system/user-experience';
import { getNormalUserSummary } from '../../dashboard/api/dashboardApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import useVoiceTyping from '../../shared/components/useVoiceTyping';
import { getActiveGenerationRun, getAvailableDomains, startIdeaGeneration } from '../api/ideaGenerationApi';
import { GENERATION_TYPES, LANGUAGE_OPTIONS } from '../constants/generation.constants';
import { saveActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import { useGenerationDraftStore } from '../store/generationDraft.store';
import { normalizeGenerationStartResponse } from '../utils/pipeline.utils';
import '../styles/generation.css';

const MAX_SELECTED_DOMAINS = 3;
const DOMAIN_PREVIEW_COUNT = 10;
const list = (value) => (Array.isArray(value) ? value : value?.data ?? value?.items ?? value?.results ?? []);

function domainIconFor(domain) {
  const name = String(domain?.name ?? domain?.displayName ?? '').toLowerCase();
  if (name.includes('educat')) return GraduationCap;
  if (name.includes('health') || name.includes('medical') || name.includes('dental')) return HeartPulse;
  if (name.includes('financ') || name.includes('bank')) return Landmark;
  if (name.includes('agric') || name.includes('farm')) return Sprout;
  if (name.includes('commerce') || name.includes('retail') || name.includes('business')) return ShoppingCart;
  if (name.includes('transport') || name.includes('mobility') || name.includes('logistic')) return Truck;
  if (name.includes('energy')) return Zap;
  if (name.includes('environment')) return Leaf;
  if (name.includes('gov')) return Building2;
  return Sparkles;
}

function DiscoveryGlobe() {
  return (
    <motion.div
      className="vx-discovery-orb"
      aria-hidden="true"
      animate={{ y: [0, -5, 0] }}
      transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <svg className="vx-discovery-orb__svg" viewBox="0 0 420 275" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="vxOrbBody" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(177 76) rotate(57) scale(151)">
            <stop stopColor="#F5FFFF" />
            <stop offset="0.20" stopColor="#C8F8F4" />
            <stop offset="0.58" stopColor="#7BDDD6" />
            <stop offset="1" stopColor="#23A7A5" />
          </radialGradient>
          <linearGradient id="vxOrbGlass" x1="150" y1="48" x2="273" y2="203" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" stopOpacity="0.86" />
            <stop offset="0.42" stopColor="white" stopOpacity="0.16" />
            <stop offset="1" stopColor="#0F9698" stopOpacity="0.18" />
          </linearGradient>
          <linearGradient id="vxOrbitPink" x1="57" y1="154" x2="360" y2="112" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F7BCD0" stopOpacity="0.12" />
            <stop offset="0.5" stopColor="#F08DB2" stopOpacity="0.78" />
            <stop offset="1" stopColor="#F7BCD0" stopOpacity="0.10" />
          </linearGradient>
          <linearGradient id="vxOrbitTeal" x1="79" y1="172" x2="350" y2="87" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6ED8D2" stopOpacity="0.10" />
            <stop offset="0.5" stopColor="#42BEBB" stopOpacity="0.62" />
            <stop offset="1" stopColor="#6ED8D2" stopOpacity="0.10" />
          </linearGradient>
          <radialGradient id="vxPinkDot" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(322 67) rotate(120) scale(13)">
            <stop stopColor="#FFDCE8" />
            <stop offset="0.44" stopColor="#FF86B1" />
            <stop offset="1" stopColor="#EE5E94" />
          </radialGradient>
          <radialGradient id="vxTealDot" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(300 47) rotate(120) scale(11)">
            <stop stopColor="#E8FFFF" />
            <stop offset="0.45" stopColor="#62D5D0" />
            <stop offset="1" stopColor="#239F9F" />
          </radialGradient>
          <filter id="vxOrbShadow" x="72" y="27" width="282" height="253" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="19" stdDeviation="14" floodColor="#159B9C" floodOpacity="0.18" />
          </filter>
          <filter id="vxBlur" x="19" y="188" width="382" height="80" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        <ellipse cx="210" cy="224" rx="130" ry="19" fill="#75DAD4" fillOpacity="0.12" filter="url(#vxBlur)" />
        <ellipse cx="210" cy="218" rx="86" ry="10" stroke="#8EDFD9" strokeOpacity="0.30" />
        <ellipse cx="210" cy="219" rx="116" ry="14" stroke="#F4A8C3" strokeOpacity="0.24" />

        <g className="vx-discovery-orb__orbits">
          <ellipse cx="210" cy="139" rx="151" ry="48" transform="rotate(-12 210 139)" stroke="url(#vxOrbitPink)" strokeWidth="1.25" />
          <ellipse cx="210" cy="139" rx="142" ry="42" transform="rotate(18 210 139)" stroke="url(#vxOrbitTeal)" strokeWidth="1.15" />
          <ellipse cx="210" cy="139" rx="111" ry="34" transform="rotate(-55 210 139)" stroke="#EFA0BC" strokeOpacity="0.34" strokeWidth="1.15" />
        </g>

        <g filter="url(#vxOrbShadow)">
          <circle cx="210" cy="128" r="78" fill="url(#vxOrbBody)" />
          <circle cx="210" cy="128" r="76" fill="url(#vxOrbGlass)" stroke="white" strokeOpacity="0.72" strokeWidth="2" />
          <ellipse cx="210" cy="128" rx="51" ry="76" stroke="white" strokeOpacity="0.22" />
          <ellipse cx="210" cy="128" rx="27" ry="76" stroke="white" strokeOpacity="0.19" />
          <ellipse cx="210" cy="128" rx="76" ry="31" stroke="white" strokeOpacity="0.20" />
          <path d="M144 101C171 114 250 111 275 92" stroke="white" strokeOpacity="0.20" />
          <path d="M145 156C180 143 246 146 275 166" stroke="white" strokeOpacity="0.18" />

          <path
            d="M160 88C176 72 198 66 219 70"
            stroke="white"
            strokeOpacity="0.26"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M159 98C171 86 184 81 196 80"
            stroke="white"
            strokeOpacity="0.13"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>

        <g className="vx-discovery-orb__particles">
          <circle cx="321" cy="66" r="9" fill="url(#vxPinkDot)" />
          <circle cx="297" cy="48" r="7" fill="url(#vxTealDot)" />
          <circle cx="342" cy="134" r="5" fill="#F57EAA" fillOpacity="0.90" />
          <circle cx="78" cy="149" r="7" fill="url(#vxPinkDot)" />
          <circle cx="95" cy="84" r="4" fill="#55C9C5" />
          <circle cx="115" cy="51" r="3" fill="#F5A1BE" />
          <circle cx="350" cy="90" r="2.7" fill="#68D5D0" />
          <circle cx="307" cy="184" r="3" fill="#F18AB0" />
          <circle cx="106" cy="192" r="3.8" fill="#62D4CF" />
          <circle cx="358" cy="175" r="6" fill="#F385AD" fillOpacity="0.72" />
          <circle cx="69" cy="118" r="2.6" fill="#F5B0C8" />
          <circle cx="332" cy="36" r="2.8" fill="#F9B8CE" />
          <circle cx="273" cy="31" r="2.4" fill="#69D2CD" />
        </g>

        <g className="vx-discovery-orb__sparkles" fill="white">
          <path d="M112 117L115 124L122 127L115 130L112 137L109 130L102 127L109 124L112 117Z" fillOpacity="0.88" />
          <path d="M311 108L313 113L318 115L313 117L311 122L309 117L304 115L309 113L311 108Z" fillOpacity="0.78" />
          <path d="M281 193L283 197L287 199L283 201L281 205L279 201L275 199L279 197L281 193Z" fillOpacity="0.65" />
        </g>
      </svg>

      <motion.span
        className="vx-discovery-orb__float vx-discovery-orb__float--search"
        animate={{ x: [0, 5, 0], y: [0, -8, 0], rotate: [-7, 3, -7] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Search size={16} />
      </motion.span>
      <motion.span
        className="vx-discovery-orb__float vx-discovery-orb__float--people"
        animate={{ x: [0, -5, 0], y: [0, 7, 0], rotate: [6, -3, 6] }}
        transition={{ duration: 6.1, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
      >
        <UsersRound size={16} />
      </motion.span>
      <motion.span
        className="vx-discovery-orb__float vx-discovery-orb__float--check"
        animate={{ x: [0, 4, 0], y: [0, -6, 0], rotate: [5, -4, 5] }}
        transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut', delay: 0.65 }}
      >
        <Check size={16} />
      </motion.span>
      <motion.span
        className="vx-discovery-orb__float vx-discovery-orb__float--spark"
        animate={{ scale: [1, 1.14, 1], rotate: [0, 14, 0], opacity: [.72, 1, .72] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles size={14} />
      </motion.span>
    </motion.div>
  );
}

function SectionHeader({ number, title, subtitle, collapsed, onToggle }) {
  return (
    <header className="vx-generate-section__header">
      <span className="vx-generate-section__number">{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <button
        type="button"
        className="vx-generate-section__collapse"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={title}
      >
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>
    </header>
  );
}

function PipelinePreview({ t }) {
  const stages = [
    ['Preparing', 'We understand your signal and set up the right discovery plan.'],
    ['Broad collection', 'We scan millions of signals across news, research, social & more.'],
    ['Community AI analysis', 'Our community AI reads, understands, and extracts key insights.'],
    ['Core idea generation', 'We synthesize the strongest patterns into core idea directions.'],
    ['Validation', 'We validate ideas with real-world evidence and opportunity signals.'],
    ['Workspace ready', 'Your validated idea lands in the pipeline with full evidence and next steps.'],
  ];

  return (
    <aside className="vx-generate-next">
      <div className="vx-generate-next__ambient" aria-hidden="true">
        <span className="vx-generate-next__ambient-dot is-1" />
        <span className="vx-generate-next__ambient-dot is-2" />
        <span className="vx-generate-next__ambient-dot is-3" />
        <span className="vx-generate-next__ambient-dot is-4" />
        <span className="vx-generate-next__ambient-ring is-1" />
        <span className="vx-generate-next__ambient-ring is-2" />
      </div>
      <DiscoveryGlobe />
      <div className="vx-generate-next__title">
        <strong>{t('What happens next')}</strong>
        <Sparkles size={15} />
      </div>
      <p>{t('Your discovery stack flows through our pipeline.')}</p>
      <div className="vx-generate-next__timeline">
        {stages.map(([title, description], index) => (
          <article key={title}>
            <span className={`vx-generate-next__icon is-${index + 1}`}>
              {index === 0 ? <Sparkles size={15} /> : index === 1 ? <Search size={15} /> : index === 2 ? <UsersRound size={15} /> : index === 3 ? <Sparkles size={15} /> : index === 4 ? <Check size={15} /> : <WalletCards size={15} />}
            </span>
            <div>
              <strong>{t(title)}</strong>
              <small>{t(description)}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="vx-generate-next__note">
        {t('This multi-step flow happens in the background — so you can focus on what matters.')}
      </div>
    </aside>
  );
}

export default function GenerateIdeaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t, language: uiLanguage } = useUserExperience();
  const { draft, updateDraft } = useGenerationDraftStore();

  const [domains, setDomains] = useState([]);
  const [loadingDomains, setLoadingDomains] = useState(true);
  const [showAllDomains, setShowAllDomains] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [error, setError] = useState('');
  const [activeRunConflictOpen, setActiveRunConflictOpen] = useState(false);
  const [accessModal, setAccessModal] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({
    signal: false,
    domains: false,
    context: false,
    review: false,
  });
  const [accessSnapshot, setAccessSnapshot] = useState({
    isPremium: false,
    creditBalance: 0,
    remainingFreeGenerations: null,
    premiumIdeaCreditCost: null,
  });

  const selectedDomainIds = useMemo(() => {
    const stored = Array.isArray(draft.domainIds) ? draft.domainIds : [];
    return stored.length ? stored : draft.domainId ? [draft.domainId] : [];
  }, [draft.domainId, draft.domainIds]);

  const selectedDomains = useMemo(
    () => selectedDomainIds
      .map((id) => domains.find((domain) => String(domain.id) === String(id)))
      .filter(Boolean),
    [domains, selectedDomainIds],
  );

  const visibleDomains = useMemo(
    () => showAllDomains ? domains : domains.slice(0, DOMAIN_PREVIEW_COUNT),
    [domains, showAllDomains],
  );

  const hiddenDomainCount = Math.max(0, domains.length - DOMAIN_PREVIEW_COUNT);

  const selectedDomainNames = useMemo(
    () => selectedDomains
      .map((domain) => String(domain.name ?? domain.displayName ?? '').trim())
      .filter(Boolean),
    [selectedDomains],
  );

  const hasSignal = Boolean(draft.description.trim());
  const hasManualDomains = selectedDomainIds.length > 0;
  const autoDetectActive = hasSignal && !hasManualDomains;
  const personalizedDiscoveryActive = !hasSignal && !hasManualDomains;

  const voiceLanguage = draft.language === 'AR'
    ? 'AR'
    : draft.language === 'EN'
      ? 'EN'
      : uiLanguage === 'ar'
        ? 'AR'
        : 'EN';

  const {
    isListening: listening,
    error: voiceError,
    toggle: toggleVoice,
  } = useVoiceTyping({
    value: draft.description,
    onChange: (description) => updateDraft({ description }),
    preferredLanguage: voiceLanguage,
    maxLength: 2000,
    disabled: submitting,
  });

  useEffect(() => {
    const problem = params.get('problem');
    if (problem && !draft.description) {
      updateDraft({ description: problem.slice(0, 2000) });
    }
  }, [draft.description, params, updateDraft]);

  useEffect(() => {
    updateDraft({
      autoDetectDomains: autoDetectActive,
      personalizedDiscovery: personalizedDiscoveryActive,
    });
  }, [autoDetectActive, personalizedDiscoveryActive, updateDraft]);

  useEffect(() => {
    let active = true;
    getAvailableDomains()
      .then((value) => {
        if (active) setDomains(list(value));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingDomains(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshGenerationAccess = async ({ force = false, openOnBlocked = false } = {}) => {
    setCheckingAccess(true);
    try {
      const [summary, pricing] = await Promise.all([
        getNormalUserSummary({ force }),
        getPaymentPricing(1, { force }),
      ]);

      const isPremium = Boolean(summary?.isPremium || summary?.accountStatus === 'PREMIUM');
      const creditBalance = Math.max(0, Number(summary?.creditBalance ?? 0));
      const remainingFreeGenerations = Math.max(0, Number(summary?.remainingFreeGenerations ?? 0));
      const premiumIdeaCreditCost = Math.max(0, Number(pricing?.premiumIdeaCreditCost ?? 0));
      const blocked = isPremium
        ? premiumIdeaCreditCost <= 0 || creditBalance < premiumIdeaCreditCost
        : remainingFreeGenerations <= 0;

      const snapshot = {
        isPremium,
        creditBalance,
        remainingFreeGenerations,
        premiumIdeaCreditCost,
      };
      setAccessSnapshot(snapshot);

      if (blocked && openOnBlocked) {
        setAccessModal(snapshot);
      }

      return { ...snapshot, blocked };
    } catch {
      return { ...accessSnapshot, blocked: false, unavailable: true };
    } finally {
      setCheckingAccess(false);
    }
  };

  useEffect(() => {
    void refreshGenerationAccess();
    // Initial access read only. The Generate button performs the mandatory fresh check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDomain = (domainId) => {
    const exists = selectedDomainIds.some((id) => String(id) === String(domainId));
    const nextDomainIds = exists
      ? selectedDomainIds.filter((id) => String(id) !== String(domainId))
      : selectedDomainIds.length < MAX_SELECTED_DOMAINS
        ? [...selectedDomainIds, domainId]
        : selectedDomainIds;

    updateDraft({
      domainIds: nextDomainIds,
      domainId: nextDomainIds[0] ?? '',
    });
  };

  const removeDomain = (domainId) => {
    const nextDomainIds = selectedDomainIds.filter((id) => String(id) !== String(domainId));
    updateDraft({ domainIds: nextDomainIds, domainId: nextDomainIds[0] ?? '' });
  };

  const clearSelectedDomains = () => {
    updateDraft({ domainIds: [], domainId: '' });
  };

  const toggleSection = (sectionKey) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const submit = async () => {
    if (submitting || checkingAccess) return;
    if (!draft.country.trim()) {
      setError(t('Choose a country before generating.'));
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      // Mandatory fresh entitlement check on every Generate click. This prevents
      // a stale navbar/dashboard balance from launching a premium request that
      // the backend will reject for insufficient credits.
      const latestAccess = await refreshGenerationAccess({ force: true, openOnBlocked: true });
      if (latestAccess.unavailable) {
        setError(t('We could not verify your current generation balance. Please try again.'));
        return;
      }
      if (latestAccess.blocked) return;

      const description = draft.description.trim();
      const noSignalAndNoDomains = !description && selectedDomainIds.length === 0;
      const textOnly = Boolean(description) && selectedDomainIds.length === 0;

      updateDraft({
        personalizedDiscovery: noSignalAndNoDomains,
        autoDetectDomains: textOnly,
      });

      const response = await startIdeaGeneration({
        ...(selectedDomainIds.length
          ? {
            domainIds: selectedDomainIds,
            domainId: selectedDomainIds[0],
            ...(selectedDomainNames.length === selectedDomainIds.length
              ? { domainNames: selectedDomainNames }
              : {}),
          }
          : {}),
        generationType: latestAccess.isPremium
          ? GENERATION_TYPES.PREMIUM_CREDIT
          : GENERATION_TYPES.NORMAL_FREE,
        ...(!noSignalAndNoDomains && description ? { description } : {}),
        country: draft.country.trim(),
        ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
        ...(draft.region.trim() ? { region: draft.region.trim() } : {}),
        language: draft.language,
        outputLanguage: description ? 'ANY' : (uiLanguage === 'ar' ? 'AR' : 'EN'),
        forceRefresh: Boolean(draft.forceRefresh),
        keywords: draft.keywords,
      });

      const result = normalizeGenerationStartResponse(response);
      if (!result.runId) throw new Error('Generation started without a run identifier.');

      saveActiveGenerationRunId(result.runId);
      navigate(workspacePath(`/normal/generation/${result.runId}`), {
        state: {
          initialRun: {
            id: result.runId,
            runId: result.runId,
            status: result.status || 'QUEUED',
            progressPercent: 0,
            currentStageKey: null,
            stages: [],
          },
        },
      });
    } catch (requestError) {
      const responseBody = requestError?.response?.data;
      const backendCode = String(
        responseBody?.code ?? responseBody?.error?.code ?? responseBody?.details?.code ?? '',
      ).toUpperCase();

      if (backendCode === 'FREE_LIMIT_REACHED' || backendCode === 'INSUFFICIENT_CREDITS') {
        const requiredCredits = Number(responseBody?.requiredCredits ?? responseBody?.details?.requiredCredits ?? accessSnapshot.premiumIdeaCreditCost ?? 0);
        const availableCredits = Number(responseBody?.availableCredits ?? responseBody?.details?.availableCredits ?? accessSnapshot.creditBalance ?? 0);
        const isPremium = backendCode === 'INSUFFICIENT_CREDITS' || accessSnapshot.isPremium;
        const snapshot = {
          ...accessSnapshot,
          isPremium,
          premiumIdeaCreditCost: requiredCredits || accessSnapshot.premiumIdeaCreditCost,
          creditBalance: availableCredits,
          remainingFreeGenerations: backendCode === 'FREE_LIMIT_REACHED' ? 0 : accessSnapshot.remainingFreeGenerations,
        };
        setAccessSnapshot(snapshot);
        setAccessModal(snapshot);
        return;
      }

      if (backendCode.startsWith('DOMAIN_SELECTION_')) {
        try {
          const refreshedDomains = await getAvailableDomains({ force: true });
          setDomains(list(refreshedDomains));
        } catch {
          // Keep the current catalogue if refresh fails.
        }
        setError(t('Your domain selection changed or is out of sync. Please reselect the domains and try again.'));
        return;
      }

      const rawBackendMessage = responseBody?.message ?? responseBody?.error?.message ?? '';
      const backendMessage = (Array.isArray(rawBackendMessage) ? rawBackendMessage.join(' ') : String(rawBackendMessage)).toLowerCase();
      const generationAlreadyRunning = backendCode === 'GENERATION_ALREADY_RUNNING'
        || backendMessage.includes('an idea-generation run is already active for this owner')
        || (requestError?.response?.status === 409 && backendMessage.includes('generation') && (backendMessage.includes('already active') || backendMessage.includes('already running')));

      if (generationAlreadyRunning) {
        setActiveRunConflictOpen(true);
        return;
      }

      if (!requestError?.response) {
        try {
          const activeRun = await getActiveGenerationRun({ force: true });
          const recoveredRunId = String(activeRun?.runId ?? activeRun?.id ?? '').trim();
          if (recoveredRunId) {
            saveActiveGenerationRunId(recoveredRunId);
            navigate(workspacePath(`/normal/generation/${recoveredRunId}`), {
              state: { initialRun: activeRun },
            });
            return;
          }
        } catch {
          // Fall through to the friendly error.
        }
      }

      setError(t("We couldn't generate your idea this time. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const countryDisplayValue = uiLanguage === 'ar' && draft.country.trim().toLocaleLowerCase('en-US') === 'palestine'
    ? t('Palestine')
    : draft.country;
  const selectedLocation = [countryDisplayValue, draft.city, draft.region].filter(Boolean).join(', ');
  const languageLabel = LANGUAGE_OPTIONS.find((item) => item.value === draft.language)?.label ?? 'Any language';
  const signalSummary = draft.description.trim()
    || (selectedDomains.length
      ? `${t('Cross-domain discovery')}: ${selectedDomains.map((domain) => t(domain.name ?? domain.displayName ?? '')).join(' + ')}`
      : t('Automatic discovery — Voxidence will find the best direction for you.'));

  const idleGenerateTitle = 'Generate Idea';
  const idleGenerateSubtitle = 'Start discovery with what you provide — Voxidence will complete the rest automatically.';

  const generateTitle = checkingAccess
    ? 'Checking generation access…'
    : submitting
      ? 'Launching intelligence…'
      : idleGenerateTitle;

  const generateSubtitle = checkingAccess
    ? 'Confirming your generation access before launch.'
    : submitting
      ? 'Your discovery pipeline is starting now.'
      : idleGenerateSubtitle;

  return (
    <main className="vx-generate-page">
      <section className="vx-generate-layout">
        <div className="vx-generate-stack">
          <section className={`vx-generate-section${collapsedSections.signal ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="1"
              title={t('Signal')}
              subtitle={t("What's the problem or opportunity you want to explore?")}
              collapsed={collapsedSections.signal}
              onToggle={() => toggleSection('signal')}
            />
            {!collapsedSections.signal ? (
              <div className="vx-generate-section__body">
                <div className="vx-signal-block">
                  <div className="vx-signal-block__heading">
                    <span className="vx-signal-block__icon"><Sparkles size={16} /></span>
                    <div>
                      <strong>{t('Write your idea, problem, or opportunity here...')}</strong>
                      <small>{t('Describe the real situation in your own words. Voxidence will understand the signal and shape the discovery path around it.')}</small>
                    </div>
                  </div>

                  <div className="vx-signal-input">
                    <textarea
                      id="vx-generation-signal"
                      value={draft.description}
                      dir={draft.description.trim() ? 'auto' : (uiLanguage === 'ar' ? 'rtl' : 'ltr')}
                      maxLength={2000}
                      aria-label={t('Write your idea, problem, or opportunity here...')}
                      onChange={(event) => updateDraft({ description: event.target.value })}
                      placeholder={t("Example: 'College students in small cities struggle to find affordable, healthy meal options delivered quickly.'")}
                    />
                    <div className="vx-signal-input__footer">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={toggleVoice}
                          disabled={submitting}
                          className={`vx-speak-button${listening ? ' is-listening' : ''}`}
                          aria-label={t(listening ? 'Listening…' : 'Speak')}
                          title={t(listening ? 'Listening…' : 'Speak')}
                        >
                          {listening ? <MicOff size={16} /> : <Mic size={16} />}
                          <span>{t(listening ? 'Listening…' : 'Speak')}</span>
                        </button>
                        {draft.description.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => updateDraft({ description: '' })}
                            disabled={submitting}
                            className="vx-speak-button"
                            aria-label={t('Clear text')}
                            title={t('Clear text')}
                          >
                            <X size={16} />
                            <span>{t('Clear text')}</span>
                          </button>
                        ) : null}
                      </div>
                      <span>{draft.description.length} / 2000</span>
                    </div>
                  </div>

                  <p className="vx-signal-optional-note">
                    <Sparkles size={12} />
                    <span><strong>{t('Optional')}</strong> · {t('You can leave this blank.')}</span>
                  </p>
                </div>
                {voiceError ? <p className="vx-inline-warning">{t(voiceError)}</p> : null}
              </div>
            ) : null}
          </section>

          <section className={`vx-generate-section${collapsedSections.domains ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="2"
              title={t('Domains')}
              subtitle={t('Choose up to 3 domains, or leave this empty and Voxidence will detect the best fit automatically.')}
              collapsed={collapsedSections.domains}
              onToggle={() => toggleSection('domains')}
            />
            {!collapsedSections.domains ? (
              <div className="vx-generate-section__body">
                <div className="vx-domain-grid">
                  {loadingDomains ? (
                    <div className="vx-domain-loading">{t('Loading domains…')}</div>
                  ) : visibleDomains.map((domain) => {
                    const isSelected = selectedDomainIds.some((id) => String(id) === String(domain.id));
                    const isBlocked = !isSelected && selectedDomainIds.length >= MAX_SELECTED_DOMAINS;
                    const DomainIcon = domainIconFor(domain);
                    return (
                      <button
                        type="button"
                        key={domain.id}
                        className={isSelected ? 'is-selected' : ''}
                        disabled={isBlocked}
                        aria-pressed={isSelected}
                        onClick={() => toggleDomain(domain.id)}
                      >
                        <span className="vx-domain-icon"><DomainIcon size={16} /></span>
                        <span>{t(domain.name ?? domain.displayName ?? '')}</span>
                      </button>
                    );
                  })}
                </div>
                {!loadingDomains && hiddenDomainCount > 0 ? (
                  <div className="vx-domain-more-row">
                    <button
                      type="button"
                      className="vx-domain-more"
                      onClick={() => setShowAllDomains((current) => !current)}
                      aria-expanded={showAllDomains}
                    >
                      <span>{showAllDomains ? t('Show less') : `${t('More')} +${hiddenDomainCount}`}</span>
                      {showAllDomains ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                ) : null}
                <div className="vx-domain-selected">
                  <div className="vx-domain-selected__head">
                    <strong>{t('Selected')} ({selectedDomainIds.length}/{MAX_SELECTED_DOMAINS})</strong>
                    {selectedDomainIds.length ? (
                      <button type="button" className="vx-domain-clear" onClick={clearSelectedDomains}>
                        {t('Clear selected')}
                      </button>
                    ) : null}
                  </div>
                  <div>
                    {selectedDomains.map((domain) => (
                      <button type="button" key={domain.id} onClick={() => removeDomain(domain.id)}>
                        {t(domain.name ?? domain.displayName ?? '')}
                        <X size={11} />
                      </button>
                    ))}
                    {!selectedDomains.length ? (
                      <span className="vx-domain-selected__auto">
                        {t('No domains selected — Voxidence will detect the best fit automatically.')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className={`vx-generate-section${collapsedSections.context ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="3"
              title={t('Context')}
              subtitle={t('Where is this happening?')}
              collapsed={collapsedSections.context}
              onToggle={() => toggleSection('context')}
            />
            {!collapsedSections.context ? (
              <div className="vx-generate-section__body vx-context-grid">
                <label>
                  <span>{t('Country')}</span>
                  <div className="vx-context-field"><MapPin size={14} /><input value={countryDisplayValue} maxLength={100} dir={countryDisplayValue.trim() ? 'auto' : (uiLanguage === 'ar' ? 'rtl' : 'ltr')} placeholder={t('Country')} onChange={(event) => updateDraft({ country: uiLanguage === 'ar' && event.target.value.trim() === t('Palestine') ? 'Palestine' : event.target.value })} /></div>
                </label>
                <label>
                  <span>{t('City')}</span>
                  <div className="vx-context-field"><Building2 size={14} /><input value={draft.city} maxLength={100} dir={draft.city.trim() ? 'auto' : (uiLanguage === 'ar' ? 'rtl' : 'ltr')} placeholder={t('City')} onChange={(event) => updateDraft({ city: event.target.value })} /></div>
                </label>
                <label>
                  <span>{t('Region (Optional)')}</span>
                  <div className="vx-context-field"><MapPin size={14} /><input value={draft.region} maxLength={100} dir={draft.region.trim() ? 'auto' : (uiLanguage === 'ar' ? 'rtl' : 'ltr')} placeholder={t('Region')} onChange={(event) => updateDraft({ region: event.target.value })} /></div>
                </label>
                <label>
                  <span>{t('Community language')}</span>
                  <div className={`vx-context-language ${languageMenuOpen ? 'is-open' : ''}`}>
                    <button type="button" onClick={() => setLanguageMenuOpen((value) => !value)}>
                      <BookOpen size={14} />
                      <span>{t(languageLabel)}</span>
                      <ChevronDown size={14} />
                    </button>
                    {languageMenuOpen ? (
                      <div className="vx-context-language__menu">
                        {LANGUAGE_OPTIONS.map((option) => (
                          <button
                            type="button"
                            key={option.value}
                            className={draft.language === option.value ? 'is-selected' : ''}
                            onClick={() => {
                              updateDraft({ language: option.value });
                              setLanguageMenuOpen(false);
                            }}
                          >
                            {t(option.label)}
                            {draft.language === option.value ? <Check size={12} /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
              </div>
            ) : null}
          </section>

          <section className={`vx-generate-section vx-generate-review${collapsedSections.review ? ' is-collapsed' : ''}`}>
            <SectionHeader
              number="4"
              title={t('Launch Review')}
              subtitle={t('Review your discovery stack before we begin.')}
              collapsed={collapsedSections.review}
              onToggle={() => toggleSection('review')}
            />
            {!collapsedSections.review ? (
              <div className="vx-generate-section__body">
                <div className="vx-review-row">
                  <article className="vx-review-row__signal">
                    <small>{t('Your signal')}</small>
                    <div className="vx-review-value">
                      <span className="vx-review-value__icon"><Search size={13} /></span>
                      <strong dir="auto">{signalSummary}</strong>
                    </div>
                  </article>
                  <article className="vx-review-row__domains">
                    <small>{t('Domains')}{selectedDomainIds.length ? ` (${selectedDomainIds.length})` : ''}</small>
                    {selectedDomains.length ? (
                      <div className="vx-review-domain-icons" aria-label={selectedDomains.map((domain) => t(domain.name ?? domain.displayName ?? '')).join(', ')}>
                        {selectedDomains.map((domain) => {
                          const DomainIcon = domainIconFor(domain);
                          return (
                            <span key={domain.id} title={t(domain.name ?? domain.displayName ?? '')}>
                              <DomainIcon size={14} />
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <strong>{t('Auto-detect')}</strong>
                    )}
                  </article>
                  <article>
                    <small>{t('Place')}</small>
                    <div className="vx-review-value">
                      <span className="vx-review-value__icon"><MapPin size={13} /></span>
                      <strong dir="auto">{selectedLocation || t('Not specified')}</strong>
                    </div>
                  </article>
                  <article>
                    <small>{t('Language')}</small>
                    <div className="vx-review-value">
                      <span className="vx-review-value__icon"><BookOpen size={13} /></span>
                      <strong>{t(languageLabel)}</strong>
                    </div>
                  </article>
                  <article className="vx-review-row__toggle">
                    <small>{t('Collect fresh evidence')}</small>
                    <label>
                      <span>{draft.forceRefresh ? t('On') : t('Off')}</span>
                      <input type="checkbox" checked={Boolean(draft.forceRefresh)} onChange={(event) => updateDraft({ forceRefresh: event.target.checked })} />
                      <i />
                    </label>
                  </article>
                </div>
                <div className="vx-review-note">
                  <Check size={15} />
                  <div>
                    <strong>{t('Voxidence chooses the best sources automatically.')}</strong>
                    <span>{t('We scan social signals, reviews, research, and more to bring you the most credible and relevant insights.')}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {error ? <div className="vx-generate-error">{Array.isArray(error) ? error.join(' ') : error}</div> : null}

          <button
            type="button"
            className="vx-generate-button"
            onClick={submit}
            disabled={submitting || checkingAccess}
            aria-busy={submitting || checkingAccess}
          >
            <Sparkles size={20} />
            <span>
              <strong>{t(generateTitle)}</strong>
              <small>{t(generateSubtitle)}</small>
            </span>
          </button>
        </div>

        <PipelinePreview t={t} />
      </section>

      {activeRunConflictOpen ? createPortal(
        <div className="vx-generate-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setActiveRunConflictOpen(false)}>
          <motion.section className="vx-generate-modal" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
            <span className="vx-generate-modal__icon"><Sparkles size={24} /></span>
            <small>{t('Generation in progress')}</small>
            <h2>{t('Another idea is already being generated.')}</h2>
            <p>{t('Voxidence is still working on your current generation. Please try later after it finishes.')}</p>
            <button type="button" onClick={() => setActiveRunConflictOpen(false)}>{t('Close')}</button>
          </motion.section>
        </div>,
        document.body,
      ) : null}

      {accessModal ? createPortal(
        <div className="vx-generate-modal-backdrop">
          <motion.section className="vx-generate-modal vx-generate-modal--credits" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
            <button type="button" className="vx-generate-modal__close" onClick={() => setAccessModal(null)}><X size={17} /></button>
            <span className="vx-generate-modal__icon"><CircleDollarSign size={24} /></span>
            <small>{t('Generation access')}</small>
            <h2>{t(accessModal.isPremium ? 'More credits are needed to generate again.' : 'Your free generations are complete.')}</h2>
            <p>{t(accessModal.isPremium ? 'The Generate button checked your live balance before starting, and there are not enough credits for this idea.' : 'You have used the free generations available on this account.')}</p>
            <div className="vx-credit-check-grid">
              <article><span>{t(accessModal.isPremium ? 'Available credits' : 'Free generations left')}</span><strong>{accessModal.isPremium ? accessModal.creditBalance : accessModal.remainingFreeGenerations}</strong></article>
              <article><span>{t(accessModal.isPremium ? 'Credits required' : 'Continue with')}</span><strong>{accessModal.isPremium ? (accessModal.premiumIdeaCreditCost ?? '—') : t('Premium')}</strong></article>
            </div>
            <div className="vx-generate-modal__actions">
              <button type="button" className="is-secondary" onClick={() => setAccessModal(null)}>{t('Close')}</button>
              <button type="button" onClick={() => navigate(workspacePath(accessModal.isPremium ? '/premium/buy-credits' : '/normal/upgrade'))}>{t(accessModal.isPremium ? 'Buy more credits' : 'Upgrade workspace')}<ArrowRight size={16} /></button>
            </div>
          </motion.section>
        </div>,
        document.body,
      ) : null}
    </main>
  );
}