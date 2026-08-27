/**
 * Four-step Voxidence idea-generation flow.
 *
 * Preserves speech recognition, multi-domain selection, draft persistence,
 * validation, submission, routing, and step order. The page also performs a
 * server-backed entitlement check before allowing a normal free generation.
 * Data sources remain backend-resolved from the request context.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Crown, Globe2, Layers3, LockKeyhole, MapPin, Mic, MicOff, Sparkles } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { useUserExperience } from '../../../../system/user-experience';
import { getActiveGenerationRun, getAvailableDomains, startIdeaGeneration } from '../api/ideaGenerationApi';
import { getNormalUserSummary } from '../../dashboard/api/dashboardApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import useAccountAccess from '../../shared/hooks/useAccountAccess';
import { GENERATION_TYPES, LANGUAGE_OPTIONS } from '../constants/generation.constants';
import { useGenerationDraftStore } from '../store/generationDraft.store';
import { normalizeGenerationStartResponse } from '../utils/pipeline.utils';
import { saveActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import '../styles/generation.css';

const STEPS = [['Signal', 'Describe what you want to explore'], ['Focus', 'Blend up to three domains'], ['Ground', 'Add local context'], ['Launch', 'Review and generate']];
const MAX_SELECTED_DOMAINS = 3;
const list = value => Array.isArray(value) ? value : value?.data ?? value?.items ?? value?.results ?? [];
const directionForText = (value) => /[\u0600-\u06FF]/.test(value || '') ? 'rtl' : (/[A-Za-z]/.test(value || '') ? 'ltr' : 'auto');

const STEP_ARTWORK = [
  {
    key: 'signal',
    label: 'Human signal',
    note: 'WHO · PAIN · WHY',
    icon: Sparkles,
    chips: ['Person', 'Friction', 'Context'],
  },
  {
    key: 'focus',
    label: 'Domain blend',
    note: 'CONNECT THE DOTS',
    icon: Layers3,
    chips: ['Domain 01', 'Domain 02', 'Domain 03'],
  },
  {
    key: 'ground',
    label: 'Local lens',
    note: 'PLACE · LANGUAGE',
    icon: MapPin,
    chips: ['Country', 'City', 'Community'],
  },
  {
    key: 'launch',
    label: 'Evidence launch',
    note: 'READY TO DISCOVER',
    icon: Globe2,
    chips: ['Signal', 'Evidence', 'Idea'],
  },
];

function StepArtwork({ step }) {
  const artwork = STEP_ARTWORK[step] ?? STEP_ARTWORK[0];
  const ArtworkIcon = artwork.icon;

  return (
    <motion.div
      className={`nx-step-art nx-step-art--${artwork.key}`}
      aria-hidden="true"
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="nx-step-art__wash nx-step-art__wash--one" />
      <span className="nx-step-art__wash nx-step-art__wash--two" />
      <span className="nx-step-art__spark nx-step-art__spark--one">✦</span>
      <span className="nx-step-art__spark nx-step-art__spark--two">✦</span>
      <div className="nx-step-art__canvas">
        <div className="nx-step-art__meta">
          <span>{String(step + 1).padStart(2, '0')}</span>
          <small>{artwork.note}</small>
        </div>
        <div className="nx-step-art__scene">
          <span className="nx-step-art__connector nx-step-art__connector--a" />
          <span className="nx-step-art__connector nx-step-art__connector--b" />
          <span className="nx-step-art__connector nx-step-art__connector--c" />
          <span className="nx-step-art__node nx-step-art__node--a" />
          <span className="nx-step-art__node nx-step-art__node--b" />
          <span className="nx-step-art__node nx-step-art__node--c" />
          <motion.span
            className="nx-step-art__core"
            animate={{ y: [0, -4, 0], rotate: [0, 2, -2, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ArtworkIcon size={27} strokeWidth={1.8} />
          </motion.span>
        </div>
        <div className="nx-step-art__footer">
          <div>
            <strong>{artwork.label}</strong>
            <small>Voxidence discovery canvas</small>
          </div>
          <span className="nx-step-art__status"><i /> LIVE</span>
        </div>
      </div>
      <div className="nx-step-art__chips">
        {artwork.chips.map((chip, index) => (
          <span key={chip} className={`nx-step-art__chip nx-step-art__chip--${index + 1}`}>
            <i />{chip}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export default function GenerateIdeaPage() {
  const { t, language: uiLanguage } = useUserExperience();
  const navigate = useNavigate(); const [params] = useSearchParams(); const { draft, updateDraft, resetDraft } = useGenerationDraftStore(); const accountAccess = useAccountAccess();
  const recognitionRef = useRef(null); const [step, setStep] = useState(0); const [languageMenuOpen, setLanguageMenuOpen] = useState(false); const [domains, setDomains] = useState([]); const [loadingDomains, setLoadingDomains] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [activeRunConflictOpen, setActiveRunConflictOpen] = useState(false); const [listening, setListening] = useState(false); const [voiceError, setVoiceError] = useState(''); const [checkingEntitlement, setCheckingEntitlement] = useState(true); const [generationBlocked, setGenerationBlocked] = useState(false); const [remainingFreeGenerations, setRemainingFreeGenerations] = useState(null); const [isPremium, setIsPremium] = useState(false); const [creditBalance, setCreditBalance] = useState(0); const [premiumIdeaCreditCost, setPremiumIdeaCreditCost] = useState(null);

  /**
   * Loads the current generation allowance from the backend-backed dashboard
   * summary. The modal blocks the complete wizard when no normal generation
   * remains, preventing the user from completing a form that cannot be sent.
   */
  useEffect(() => {
    let active = true;

    Promise.all([
      getNormalUserSummary(),
      getPaymentPricing(),
    ])
      .then(([summary, pricing]) => {
        if (!active) return;

        const premium = Boolean(summary?.isPremium || summary?.accountStatus === 'PREMIUM');
        const credits = Number(summary?.creditBalance ?? 0);
        const remaining = Number(summary?.remainingFreeGenerations ?? 0);
        const requiredCredits = Number(pricing?.premiumIdeaCreditCost ?? 0);
        setIsPremium(premium);
        setCreditBalance(credits);
        setPremiumIdeaCreditCost(requiredCredits);
        setRemainingFreeGenerations(remaining);
        setGenerationBlocked(premium ? requiredCredits <= 0 || credits < requiredCredits : remaining <= 0);
      })
      .catch(() => {
        // The generation endpoint remains authoritative. A summary failure does
        // not permanently block the user because submission errors are handled
        // below using the backend error code.
      })
      .finally(() => {
        if (active) setCheckingEntitlement(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!generationBlocked && !activeRunConflictOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeRunConflictOpen, generationBlocked]);

  useEffect(() => {
    if (accountAccess.isPremium) {
      setIsPremium(true);
      setCreditBalance(Number(accountAccess.creditBalance ?? 0));
    }
  }, [accountAccess.creditBalance, accountAccess.isPremium]);

  useEffect(() => { const problem = params.get('problem'); if (problem && !draft.description) updateDraft({ description: problem.slice(0, 2000) }); }, [params, draft.description, updateDraft]);
  useEffect(() => { let active = true; getAvailableDomains().then(value => { if (active) setDomains(list(value)); }).catch(() => { }).finally(() => { if (active) setLoadingDomains(false); }); return () => { active = false; recognitionRef.current?.stop(); }; }, []);
  const selectedDomainIds = useMemo(() => {
    const stored = Array.isArray(draft.domainIds) ? draft.domainIds : [];
    return stored.length ? stored : draft.domainId ? [draft.domainId] : [];
  }, [draft.domainId, draft.domainIds]);
  const selectedDomains = useMemo(() => domains.filter(domain => selectedDomainIds.some(id => String(id) === String(domain.id))), [domains, selectedDomainIds]);
  const hasDescriptionText = draft.description.trim().length > 0;
  const hasSignal = draft.description.trim().length >= 10;
  const canChooseDomainsInstead = !hasDescriptionText;
  const personalizedDiscovery = Boolean(draft.personalizedDiscovery);
  const canContinue = step === 0
    ? hasSignal
    : step === 1
      ? (hasSignal || selectedDomainIds.length > 0)
      : step === 2
        ? Boolean(draft.country.trim())
        : true;

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
      personalizedDiscovery: false,
    });
  };
  const chooseDomainsInstead = () => {
    if (!canChooseDomainsInstead) return;
    setError('');
    updateDraft({ personalizedDiscovery: false });
    setStep(1);
  };
  const startPersonalizedDiscovery = () => {
    if (!canChooseDomainsInstead) return;
    setError('');
    updateDraft({
      description: '',
      domainIds: [],
      domainId: '',
      personalizedDiscovery: true,
    });
    setStep(2);
  };
  const goBack = () => {
    if (step === 0) {
      navigate('/normal/dashboard');
      return;
    }
    if (step === 2 && personalizedDiscovery) {
      setStep(0);
      return;
    }
    setStep(value => value - 1);
  };
  const toggleVoice = () => { setVoiceError(''); if (listening) { recognitionRef.current?.stop(); return; } const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SpeechRecognition) { setVoiceError('Voice typing is not supported here. Use Chrome or Edge.'); return; } const recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = draft.language === 'AR' ? 'ar' : draft.language === 'EN' ? 'en-US' : navigator.language || 'en-US'; let committed = draft.description; recognition.onstart = () => setListening(true); recognition.onend = () => setListening(false); recognition.onerror = e => { setListening(false); setVoiceError(e.error === 'not-allowed' ? 'Allow microphone access to use voice typing.' : 'Voice typing stopped. Please try again.'); }; recognition.onresult = event => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i += 1) { const transcript = event.results[i][0].transcript; if (event.results[i].isFinal) committed = `${committed} ${transcript}`.trim(); else interim += transcript; } updateDraft({ description: `${committed} ${interim}`.trim().slice(0, 2000), personalizedDiscovery: false }); }; recognitionRef.current = recognition; recognition.start(); };
  const submit = async () => {
    if (generationBlocked || checkingEntitlement) return;

    setError('');
    setSubmitting(true);

    try {
      // Do not add a second summary/pricing round-trip before generation.
      // The generation endpoint is already the authoritative entitlement gate,
      // so a client-side re-check only delays the click without adding safety.
      const premiumForRequest = isPremium;

      const response = await startIdeaGeneration({
        ...(selectedDomainIds.length
          ? { domainIds: selectedDomainIds, domainId: selectedDomainIds[0] }
          : {}),
        generationType: premiumForRequest ? GENERATION_TYPES.PREMIUM_CREDIT : GENERATION_TYPES.NORMAL_FREE,
        ...(!personalizedDiscovery && draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
        country: draft.country.trim(),
        ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
        ...(draft.region.trim() ? { region: draft.region.trim() } : {}),
        language: draft.language,
        outputLanguage: uiLanguage === 'ar' ? 'AR' : 'EN',
        forceRefresh: Boolean(draft.forceRefresh),
        keywords: draft.keywords,
      });

      const result = normalizeGenerationStartResponse(response);

      if (!result.runId) {
        throw new Error('Generation started without a run identifier.');
      }

      saveActiveGenerationRunId(result.runId);
      resetDraft();
      navigate(`/normal/generation/${result.runId}`, {
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
      const backendCode =
        responseBody?.code ??
        responseBody?.error?.code ??
        responseBody?.details?.code;

      if (backendCode === 'FREE_LIMIT_REACHED') {
        setRemainingFreeGenerations(0);
        setGenerationBlocked(true);
        return;
      }

      const rawBackendMessage =
        responseBody?.message ??
        responseBody?.error?.message ??
        responseBody?.details?.message ??
        '';
      const backendMessage = (Array.isArray(rawBackendMessage)
        ? rawBackendMessage.join(' ')
        : String(rawBackendMessage)
      ).toLowerCase();
      const normalizedBackendCode = String(backendCode ?? '').toUpperCase();
      const generationAlreadyRunning =
        normalizedBackendCode === 'GENERATION_ALREADY_RUNNING' ||
        backendMessage.includes(
          'an idea-generation run is already active for this owner',
        ) ||
        (requestError?.response?.status === 409 &&
          backendMessage.includes('generation') &&
          (backendMessage.includes('already active') ||
            backendMessage.includes('already running')));

      if (generationAlreadyRunning) {
        setError('');
        setActiveRunConflictOpen(true);
        return;
      }

      /*
       * A browser/network disconnect can lose the HTTP 202 response even
       * though Nest has already created the run and the pipeline is executing.
       * In that case adopt the user's active durable run instead of showing a
       * false timeout/error and forcing a duplicate click.
       */
      const isTransportFailure = !requestError?.response;

      if (isTransportFailure) {
        try {
          const activeRun = await getActiveGenerationRun({ force: true });
          const recoveredRunId = String(
            activeRun?.runId ?? activeRun?.id ?? '',
          ).trim();

          if (recoveredRunId) {
            saveActiveGenerationRunId(recoveredRunId);
            resetDraft();
            navigate(`/normal/generation/${recoveredRunId}`, {
              state: {
                initialRun: {
                  ...activeRun,
                  id: activeRun?.id ?? recoveredRunId,
                  runId: activeRun?.runId ?? recoveredRunId,
                  status: activeRun?.status || 'QUEUED',
                  progressPercent: Number(activeRun?.progressPercent ?? 0),
                  currentStageKey: activeRun?.currentStageKey ?? null,
                  stages: Array.isArray(activeRun?.stages) ? activeRun.stages : [],
                },
              },
            });
            return;
          }
        } catch {
          // Keep the original transport error when no active run can be found.
        }
      }

      setError(
        responseBody?.message ||
        requestError?.message ||
        'Idea generation could not be started.',
      );
    } finally {
      setSubmitting(false);
    }
  };
  return <div className={`nx-generation-page ${generationBlocked ? 'is-generation-blocked' : ''}`}><section className="nx-generation-shell">
    <div className="nx-step-rail">{STEPS.map(([title, caption], index) => <div key={title} className={`nx-step ${index === step ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`}><span>{index < step ? <Check size={15} /> : index + 1}</span><div><b>{title}</b><small>{caption}</small></div>{index < STEPS.length - 1 ? <i /> : null}</div>)}</div>
    <div className="nx-generation-card">
      {step === 0 ? <section className="nx-panel nx-panel--signal"><div className="nx-panel__head"><div><span className="nx-kicker"><Sparkles size={14} />Tell us what you noticed</span><h2>What should Voxidence investigate or help you discover?</h2><p>Describe the situation, goal, workflow, idea direction, or problem you want Voxidence to explore. You do not need to know the final problem yet.</p></div><span className="nx-private-note">Private workspace</span></div><StepArtwork step={0} /><div className="nx-speech-field"><textarea value={draft.description} dir="auto" maxLength={2000} onChange={e => updateDraft({ description: e.target.value, personalizedDiscovery: false })} placeholder="Example: Students in Nablus struggle to coordinate shared transport because schedules change and there is no trusted real-time matching system…" /><div className="nx-speech-field__actions"><button type="button" className={`nx-voice-button ${listening ? 'is-listening' : ''}`} onClick={toggleVoice}>{listening ? <MicOff size={20} /> : <Mic size={20} />}<span>{listening ? 'Listening…' : 'Speak to type'}</span></button><button type="button" className="nx-domain-shortcut" disabled={!canChooseDomainsInstead} onClick={chooseDomainsInstead}><Layers3 size={19} /><span>Choose domains instead</span><ArrowRight size={16} /></button></div><small>{draft.description.length}/2000</small></div>{voiceError ? <p className="nx-inline-error">{voiceError}</p> : null}<div className="nx-personalized-discovery nx-personalized-discovery--signal"><button type="button" disabled={!canChooseDomainsInstead} onClick={startPersonalizedDiscovery}><Sparkles size={21} /><div><b>I’m not sure what my idea should be yet</b><small>Help me discover a direction from my interests and preferences</small></div><span><ArrowRight size={17} /></span></button></div><div className="nx-signal-tips"><span>Mention who or what you care about</span><span>Add goals, constraints, or pain if known</span><span>Mention the location when relevant</span></div></section> : null}
      {step === 1 ? <section className="nx-panel nx-panel--domains"><span className="nx-kicker"><Globe2 size={14} />Opportunity focus</span><h2>Blend domains into one stronger opportunity.</h2><p>{hasSignal ? 'Your description remains the discovery intent. Select up to three domains so Voxidence can search for evidence-backed problems inside that scope.' : 'Select one to three domains. Voxidence will search for a meaningful cross-domain problem and generate one coherent business idea.'}</p><StepArtwork step={1} /><div className="nx-domain-selection-head"><div><b>{`${selectedDomainIds.length} of ${MAX_SELECTED_DOMAINS} domains selected`}</b><small>Choose complementary areas rather than unrelated categories.</small></div>{selectedDomainIds.length ? <button type="button" onClick={() => updateDraft({ domainIds: [], domainId: '', personalizedDiscovery: false })}>Clear selection</button> : null}</div><div className="nx-auto-domain"><button type="button" disabled={!hasSignal} className={`${selectedDomainIds.length === 0 && hasSignal ? 'is-selected' : ''} ${!hasSignal ? 'is-disabled' : ''}`} onClick={() => updateDraft({ domainIds: [], domainId: '', personalizedDiscovery: false })}><Sparkles size={20} /><div><b>Auto-detect the best domain blend</b><small>{hasSignal ? 'Recommended · Voxidence resolves the strongest combination from your signal' : 'Add a description first to use automatic detection'}</small></div><Check size={17} /></button></div><div className="nx-domain-grid">{loadingDomains ? <p>Loading domains…</p> : domains.map(domain => { const isSelected = selectedDomainIds.some(id => String(id) === String(domain.id)); const isBlocked = !isSelected && selectedDomainIds.length >= MAX_SELECTED_DOMAINS; return <button type="button" key={domain.id} disabled={isBlocked} aria-pressed={isSelected} className={`${isSelected ? 'is-selected' : ''} ${isBlocked ? 'is-blocked' : ''}`} onClick={() => toggleDomain(domain.id)}><span>{domain.icon || '✦'}</span><div><b>{t(domain.name ?? domain.displayName ?? '')}</b><small>{t(domain.description ?? 'Software opportunity domain')}</small></div><i aria-hidden={!isSelected}>{isSelected ? <Check size={14} /> : null}</i></button>; })}</div></section> : null}
      {step === 2 ? <section className="nx-panel nx-panel--ground"><span className="nx-kicker"><MapPin size={14} />Local intelligence</span><h2>Where should the solution create impact?</h2><p>This context improves local relevance, regulation checks, and market assumptions.</p><StepArtwork step={2} /><div className="nx-location-grid"><label><span>Country *</span><input dir="auto" value={draft.country} maxLength={100} onChange={e => updateDraft({ country: e.target.value })} /></label><label><span>City</span><input dir="auto" value={draft.city} maxLength={100} onChange={e => updateDraft({ city: e.target.value })} placeholder="Nablus" /></label><label><span>Region</span><input dir="auto" value={draft.region} maxLength={100} onChange={e => updateDraft({ region: e.target.value })} placeholder="West Bank" /></label><label><span>Community language</span><div className={`nx-language-select ${languageMenuOpen ? 'is-open' : ''}`}><button type="button" className="nx-language-select__trigger" aria-haspopup="listbox" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen(v => !v)}><span>{t(LANGUAGE_OPTIONS.find(option => option.value === draft.language)?.label ?? 'Any language')}</span><ChevronDown size={18} /></button>{languageMenuOpen ? <div className="nx-language-select__menu" role="listbox">{LANGUAGE_OPTIONS.map(option => <button type="button" role="option" aria-selected={draft.language === option.value} key={option.value} className={draft.language === option.value ? 'is-selected' : ''} onClick={() => { updateDraft({ language: option.value }); setLanguageMenuOpen(false); }}>{t(option.label)}</button>)}</div> : null}</div></label></div><div className="nx-source-note"><Sparkles size={18} /><div><b>No manual data-source selection</b><p>Voxidence's backend chooses active sources according to the resolved domain, language, location, availability, and evidence quality.</p></div></div></section> : null}
      {step === 3 ? <section className="nx-panel nx-panel--launch"><span className="nx-kicker"><Sparkles size={14} />Ready to discover</span><h2>Review the signal before launching.</h2><StepArtwork step={3} /><div className="nx-review-layout"><article className="nx-review-problem"><span>Discovery input</span><p dir={directionForText(draft.description)} data-no-auto-translate={personalizedDiscovery ? undefined : true}>{personalizedDiscovery ? t('Personalized discovery based on your interests, preferences, favorites, accepted ideas, and idea history.') : (draft.description || t(`Cross-domain discovery: ${selectedDomains.map(domain => t(domain.name ?? domain.displayName ?? '')).join(' + ') || 'Automatic domain blend'}`))}</p></article><div className="nx-review-facts"><article><span>Domain blend</span><b dir={selectedDomains.length ? 'auto' : undefined} data-no-auto-translate={selectedDomains.length ? true : undefined}>{personalizedDiscovery ? t('Personalized by Voxidence') : (selectedDomains.length ? selectedDomains.map(domain => t(domain.name ?? domain.displayName ?? '')).join(' + ') : t('Auto-detected by Voxidence'))}</b></article><article><span>Location</span><b dir="auto" data-no-auto-translate="true">{[draft.city, draft.region, draft.country].filter(Boolean).join(', ')}</b></article><article><span>Language</span><b>{t(LANGUAGE_OPTIONS.find(item => item.value === draft.language)?.label ?? '')}</b></article><article><span>Source strategy</span><b>Backend intelligence</b></article></div></div><label className="nx-refresh-toggle"><input type="checkbox" checked={draft.forceRefresh} onChange={e => updateDraft({ forceRefresh: e.target.checked })} /><span><b>Collect fresh evidence</b><small>Turn this on only when you do not want to reuse a recent matching collection.</small></span></label><div className={`nx-normal-generation-note ${isPremium ? 'is-premium' : ''}`}><VoxidenceMark className="nx-normal-generation-note__mark" size={24} /><span><b>{isPremium ? 'Premium idea generation' : 'Normal idea generation'}</b><small>{isPremium ? `This generation uses ${premiumIdeaCreditCost ?? '…'} of your ${creditBalance} credits and creates the complete advanced workspace immediately.` : 'Your available free generation creates the core validated idea. After it is ready, you can open it first and choose Direct Unlock only when you want the advanced workspace.'}</small></span></div></section> : null}
      {error ? <div className="nx-form-error">{Array.isArray(error) ? error.join(' ') : error}</div> : null}
      <footer className="nx-wizard-actions"><button type="button" className="nx-back-button" onClick={goBack}><ArrowLeft size={17} />{step === 0 ? 'Back to home' : 'Previous'}</button>{step < STEPS.length - 1 ? <button type="button" className="nx-next-button" disabled={!canContinue} aria-disabled={!canContinue} onClick={() => setStep(v => v + 1)}>Continue <ArrowRight size={18} /></button> : <button type="button" className="nx-next-button" disabled={submitting || checkingEntitlement || generationBlocked} aria-busy={submitting || checkingEntitlement} onClick={submit}>{submitting ? 'Launching intelligence…' : 'Generate validated idea'} <Sparkles size={18} /></button>}</footer>
    </div>
    {activeRunConflictOpen ? createPortal(
      <div
        className="nx-active-run-conflict"
        role="presentation"
        onMouseDown={event => {
          if (event.target === event.currentTarget) {
            setActiveRunConflictOpen(false);
          }
        }}
      >
        <motion.section
          className="nx-active-run-conflict__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="active-run-conflict-title"
          aria-describedby="active-run-conflict-description"
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        >
          <span className="nx-active-run-conflict__icon" aria-hidden="true">
            <Sparkles size={25} />
          </span>
          <span className="nx-active-run-conflict__eyebrow">Generation in progress</span>
          <h2 id="active-run-conflict-title">Another idea is already being generated.</h2>
          <p id="active-run-conflict-description">
            Voxidence is still working on your current generation. Please try later after it finishes.
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => setActiveRunConflictOpen(false)}
          >
            Close
          </button>
        </motion.section>
      </div>,
      document.body,
    ) : null}
    {generationBlocked ? createPortal(
      <div
        className="nx-generation-blocker"
        role="presentation"
        aria-hidden={false}
      >
        <motion.section
          className="nx-generation-blocker__card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="generation-blocker-title"
          aria-describedby="generation-blocker-description"
          initial={{ opacity: 0, y: 22, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 190, damping: 23 }}
        >
          <div className="nx-generation-blocker__glow nx-generation-blocker__glow--mint" aria-hidden="true" />
          <div className="nx-generation-blocker__glow nx-generation-blocker__glow--rose" aria-hidden="true" />

          <header className="nx-generation-blocker__header">
            <motion.span
              className="nx-generation-blocker__mark"
              animate={{ y: [0, -4, 0], rotate: [0, 2, -2, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <VoxidenceMark size={38} />
            </motion.span>

            <div className="nx-generation-blocker__header-copy">
              <span className="nx-generation-blocker__eyebrow">
                <LockKeyhole size={14} />
                Generation access
              </span>
              <span className="nx-generation-blocker__state">
                <i />
                Generation paused
              </span>
            </div>
          </header>

          <div className="nx-generation-blocker__content">
            <h2 id="generation-blocker-title">
              {isPremium ? 'More credits are needed to generate again.' : 'Your free generations are complete.'}
            </h2>

            <p id="generation-blocker-description">
              {isPremium
                ? 'Your current ideas and unlocked workspaces remain available. Add credits whenever you are ready to create another full evidence-based idea.'
                : 'You have used the free generations available on this account. Your existing ideas stay available, and upgrading lets you continue creating new evidence-based workspaces.'}
            </p>

            <div className="nx-generation-blocker__metrics">
              <article>
                <span className="nx-generation-blocker__metric-icon">
                  <LockKeyhole size={16} />
                </span>
                <div>
                  <small>{isPremium ? 'Credit balance' : 'Free generations'}</small>
                  <strong>{isPremium ? creditBalance : (remainingFreeGenerations ?? 0)}</strong>
                  <span>{isPremium ? 'credits available' : 'remaining'}</span>
                </div>
              </article>

              <article className="is-accent">
                <span className="nx-generation-blocker__metric-icon">
                  <Crown size={16} />
                </span>
                <div>
                  <small>{isPremium ? 'Next step' : 'Continue with Premium'}</small>
                  <strong>{isPremium ? (premiumIdeaCreditCost ?? '—') : 'Premium'}</strong>
                  <span>
                    {isPremium
                      ? 'credits required per idea'
                      : 'advanced generation available after upgrade'}
                  </span>
                </div>
              </article>
            </div>

            <div className="nx-generation-blocker__note">
              <Sparkles size={16} />
              <div>
                <strong>Your work is safe.</strong>
                <span>No existing idea, unlock, publication, or workspace is removed when generation access is paused.</span>
              </div>
            </div>
          </div>

          <footer className="nx-generation-blocker__actions">
            <button
              type="button"
              className="is-secondary"
              onClick={() => navigate('/normal/ideas')}
            >
              View my ideas
            </button>

            <button
              type="button"
              className="is-primary"
              onClick={() => navigate('/normal/credits')}
            >
              {isPremium ? 'Buy more credits' : 'Upgrade workspace'}
              <ArrowRight size={17} />
            </button>
          </footer>

          <button
            type="button"
            className="nx-generation-blocker__home"
            onClick={() => navigate('/normal/dashboard')}
          >
            <ArrowLeft size={14} />
            Back to dashboard
          </button>
        </motion.section>
      </div>,
      document.body,
    ) : null}
  </section></div>;
}
