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
import { motion } from 'framer-motion';
import VoxidenceMark from '../../../../components/brand/VoxidenceMark';
import { getAvailableDomains, startIdeaGeneration } from '../api/ideaGenerationApi';
import { getNormalUserSummary } from '../../dashboard/api/dashboardApi';
import { getPaymentPricing } from '../../payments/api/paymentFlowApi';
import { GENERATION_TYPES, LANGUAGE_OPTIONS } from '../constants/generation.constants';
import { useGenerationDraftStore } from '../store/generationDraft.store';
import { normalizeGenerationStartResponse } from '../utils/pipeline.utils';
import { saveActiveGenerationRunId } from '../store/activeGenerationRun.storage';
import '../styles/generation.css';

const STEPS = [['Signal', 'Describe the real problem'], ['Focus', 'Blend up to three domains'], ['Ground', 'Add local context'], ['Launch', 'Review and generate']];
const MAX_SELECTED_DOMAINS = 3;
const list = value => Array.isArray(value) ? value : value?.data ?? value?.items ?? value?.results ?? [];

export default function GenerateIdeaPage() {
  const navigate = useNavigate(); const [params] = useSearchParams(); const { draft, updateDraft, resetDraft } = useGenerationDraftStore();
  const recognitionRef = useRef(null); const [step, setStep] = useState(0); const [languageMenuOpen, setLanguageMenuOpen] = useState(false); const [domains, setDomains] = useState([]); const [loadingDomains, setLoadingDomains] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [listening, setListening] = useState(false); const [voiceError, setVoiceError] = useState(''); const [checkingEntitlement, setCheckingEntitlement] = useState(true); const [generationBlocked, setGenerationBlocked] = useState(false); const [remainingFreeGenerations, setRemainingFreeGenerations] = useState(null); const [isPremium, setIsPremium] = useState(false); const [creditBalance, setCreditBalance] = useState(0); const [premiumIdeaCreditCost, setPremiumIdeaCreditCost] = useState(null);

  /**
   * Loads the current generation allowance from the backend-backed dashboard
   * summary. The modal blocks the complete wizard when no normal generation
   * remains, preventing the user from completing a form that cannot be sent.
   */
  useEffect(() => {
    let active = true;

    Promise.all([
      getNormalUserSummary({ force: true }),
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

  useEffect(() => { const problem = params.get('problem'); if (problem && !draft.description) updateDraft({ description: problem.slice(0, 2000) }); }, [params, draft.description, updateDraft]);
  useEffect(() => { let active = true; getAvailableDomains().then(value => { if (active) setDomains(list(value)); }).catch(() => { }).finally(() => { if (active) setLoadingDomains(false); }); return () => { active = false; recognitionRef.current?.stop(); }; }, []);
  const selectedDomainIds = useMemo(() => {
    const stored = Array.isArray(draft.domainIds) ? draft.domainIds : [];
    return stored.length ? stored : draft.domainId ? [draft.domainId] : [];
  }, [draft.domainId, draft.domainIds]);
  const selectedDomains = useMemo(() => domains.filter(domain => selectedDomainIds.some(id => String(id) === String(domain.id))), [domains, selectedDomainIds]);
  const hasSignal = draft.description.trim().length >= 10;
  const canContinue = step === 0 ? hasSignal : step === 1 ? (hasSignal || selectedDomainIds.length > 0) : step === 2 ? Boolean(draft.country.trim()) : true;

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
  const toggleVoice = () => { setVoiceError(''); if (listening) { recognitionRef.current?.stop(); return; } const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SpeechRecognition) { setVoiceError('Voice typing is not supported here. Use Chrome or Edge.'); return; } const recognition = new SpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = draft.language === 'AR' ? 'ar' : draft.language === 'EN' ? 'en-US' : navigator.language || 'en-US'; let committed = draft.description; recognition.onstart = () => setListening(true); recognition.onend = () => setListening(false); recognition.onerror = e => { setListening(false); setVoiceError(e.error === 'not-allowed' ? 'Allow microphone access to use voice typing.' : 'Voice typing stopped. Please try again.'); }; recognition.onresult = event => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i += 1) { const transcript = event.results[i][0].transcript; if (event.results[i].isFinal) committed = `${committed} ${transcript}`.trim(); else interim += transcript; } updateDraft({ description: `${committed} ${interim}`.trim().slice(0, 2000) }); }; recognitionRef.current = recognition; recognition.start(); };
  const submit = async () => {
    if (generationBlocked || checkingEntitlement) return;

    setError('');
    setSubmitting(true);

    try {
      // Re-check entitlement immediately before queueing. This avoids sending a
      // stale NORMAL_FREE value when the account has already become PREMIUM.
      // The backend remains authoritative and resolves the final type again.
      let premiumForRequest = isPremium;

      try {
        const [latestSummary, latestPricing] = await Promise.all([
          getNormalUserSummary({ force: true }),
          getPaymentPricing(),
        ]);
        const latestPremium = Boolean(
          latestSummary?.isPremium || latestSummary?.accountStatus === 'PREMIUM',
        );
        const latestCredits = Number(latestSummary?.creditBalance ?? 0);
        const latestRemaining = Number(latestSummary?.remainingFreeGenerations ?? 0);
        const latestRequiredCredits = Number(latestPricing?.premiumIdeaCreditCost ?? 0);

        premiumForRequest = latestPremium;
        setIsPremium(latestPremium);
        setCreditBalance(latestCredits);
        setPremiumIdeaCreditCost(latestRequiredCredits);
        setRemainingFreeGenerations(latestRemaining);
        setGenerationBlocked(
          latestPremium
            ? latestRequiredCredits <= 0 || latestCredits < latestRequiredCredits
            : latestRemaining <= 0,
        );

        if (
          latestPremium
            ? latestRequiredCredits <= 0 || latestCredits < latestRequiredCredits
            : latestRemaining <= 0
        ) {
          return;
        }
      } catch {
        // Do not fail generation only because the summary refresh failed.
        // The generation endpoint performs the authoritative entitlement check.
      }

      const response = await startIdeaGeneration({
        ...(selectedDomainIds.length
          ? { domainIds: selectedDomainIds, domainId: selectedDomainIds[0] }
          : {}),
        generationType: premiumForRequest ? GENERATION_TYPES.PREMIUM_CREDIT : GENERATION_TYPES.NORMAL_FREE,
        ...(draft.description.trim()
          ? { description: draft.description.trim() }
          : {}),
        country: draft.country.trim(),
        ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
        ...(draft.region.trim() ? { region: draft.region.trim() } : {}),
        language: draft.language,
        forceRefresh: Boolean(draft.forceRefresh),
        keywords: draft.keywords,
      });

      const result = normalizeGenerationStartResponse(response);

      if (!result.runId) {
        throw new Error('Generation started without a run identifier.');
      }

      saveActiveGenerationRunId(result.runId);
      resetDraft();
      navigate(`/normal/generation/${result.runId}`);
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

      setError(
        responseBody?.message ||
        requestError?.message ||
        'Idea generation could not be started.',
      );
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="nx-generation-page"><section className="nx-generation-shell">
    <div className="nx-step-rail">{STEPS.map(([title, caption], index) => <div key={title} className={`nx-step ${index === step ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`}><span>{index < step ? <Check size={15} /> : index + 1}</span><div><b>{title}</b><small>{caption}</small></div>{index < STEPS.length - 1 ? <i /> : null}</div>)}</div>
    <div className="nx-generation-card">
      {step === 0 ? <section className="nx-panel nx-panel--signal"><div className="nx-panel__head"><div><span className="nx-kicker"><Sparkles size={14} />Tell us what you noticed</span><h2>What real problem should Voxidence investigate?</h2><p>Describe the frustration, who experiences it, and why current solutions are not enough.</p></div><span className="nx-private-note">Private workspace</span></div><div className="nx-speech-field"><textarea value={draft.description} maxLength={2000} onChange={e => updateDraft({ description: e.target.value })} placeholder="Example: Students in Nablus struggle to coordinate shared transport because schedules change and there is no trusted real-time matching system…" /><div className="nx-speech-field__actions"><button type="button" className={`nx-voice-button ${listening ? 'is-listening' : ''}`} onClick={toggleVoice}>{listening ? <MicOff size={20} /> : <Mic size={20} />}<span>{listening ? 'Listening…' : 'Speak to type'}</span></button><button type="button" className="nx-domain-shortcut" onClick={() => setStep(1)}><Layers3 size={19} /><span>Choose domains instead</span><ArrowRight size={16} /></button></div><small>{draft.description.length}/2000</small></div>{voiceError ? <p className="nx-inline-error">{voiceError}</p> : null}<div className="nx-signal-tips"><span>Include who is affected</span><span>Explain the repeated pain</span><span>Mention the location when relevant</span></div></section> : null}
      {step === 1 ? <section className="nx-panel nx-panel--domains"><span className="nx-kicker"><Globe2 size={14} />Opportunity focus</span><h2>Blend domains into one stronger opportunity.</h2><p>{hasSignal ? 'Your description remains the primary signal. Select up to three domains so Voxidence can combine related pains, evidence, and business opportunities.' : 'Select one to three domains. Voxidence will search for a meaningful cross-domain problem and generate one coherent business idea.'}</p><div className="nx-domain-selection-head"><div><b>{selectedDomainIds.length} of {MAX_SELECTED_DOMAINS} domains selected</b><small>Choose complementary areas rather than unrelated categories.</small></div>{selectedDomainIds.length ? <button type="button" onClick={() => updateDraft({ domainIds: [], domainId: '' })}>Clear selection</button> : null}</div><div className="nx-auto-domain"><button type="button" disabled={!hasSignal} className={`${selectedDomainIds.length === 0 && hasSignal ? 'is-selected' : ''} ${!hasSignal ? 'is-disabled' : ''}`} onClick={() => updateDraft({ domainIds: [], domainId: '' })}><Sparkles size={20} /><div><b>Auto-detect the best domain blend</b><small>{hasSignal ? 'Recommended · Voxidence resolves the strongest combination from your signal' : 'Add a description first to use automatic detection'}</small></div><Check size={17} /></button></div><div className="nx-domain-grid">{loadingDomains ? <p>Loading domains…</p> : domains.map(domain => { const isSelected = selectedDomainIds.some(id => String(id) === String(domain.id)); const isBlocked = !isSelected && selectedDomainIds.length >= MAX_SELECTED_DOMAINS; return <button type="button" key={domain.id} disabled={isBlocked} className={`${isSelected ? 'is-selected' : ''} ${isBlocked ? 'is-blocked' : ''}`} onClick={() => toggleDomain(domain.id)}><span>{domain.icon || '✦'}</span><div><b>{domain.name ?? domain.displayName}</b><small>{domain.description ?? 'Software opportunity domain'}</small></div><i>{isSelected ? <Check size={14} /> : null}</i></button>; })}</div></section> : null}
      {step === 2 ? <section className="nx-panel"><span className="nx-kicker"><MapPin size={14} />Local intelligence</span><h2>Where should the solution create impact?</h2><p>This context improves local relevance, regulation checks, and market assumptions.</p><div className="nx-location-grid"><label><span>Country *</span><input value={draft.country} maxLength={100} onChange={e => updateDraft({ country: e.target.value })} /></label><label><span>City</span><input value={draft.city} maxLength={100} onChange={e => updateDraft({ city: e.target.value })} placeholder="Nablus" /></label><label><span>Region</span><input value={draft.region} maxLength={100} onChange={e => updateDraft({ region: e.target.value })} placeholder="West Bank" /></label><label><span>Community language</span><div className={`nx-language-select ${languageMenuOpen ? 'is-open' : ''}`}><button type="button" className="nx-language-select__trigger" aria-haspopup="listbox" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen(v => !v)}><span>{LANGUAGE_OPTIONS.find(option => option.value === draft.language)?.label ?? 'Any language'}</span><ChevronDown size={18} /></button>{languageMenuOpen ? <div className="nx-language-select__menu" role="listbox">{LANGUAGE_OPTIONS.map(option => <button type="button" role="option" aria-selected={draft.language === option.value} key={option.value} className={draft.language === option.value ? 'is-selected' : ''} onClick={() => { updateDraft({ language: option.value }); setLanguageMenuOpen(false); }}>{option.label}</button>)}</div> : null}</div></label></div><div className="nx-source-note"><Sparkles size={18} /><div><b>No manual data-source selection</b><p>Voxidence's backend chooses active sources according to the resolved domain, language, location, availability, and evidence quality.</p></div></div></section> : null}
      {step === 3 ? <section className="nx-panel"><span className="nx-kicker"><Sparkles size={14} />Ready to discover</span><h2>Review the signal before launching.</h2><div className="nx-review-layout"><article className="nx-review-problem"><span>Discovery input</span><p>{draft.description || `Cross-domain discovery: ${selectedDomains.map(domain => domain.name ?? domain.displayName).join(' + ') || 'Automatic domain blend'}`}</p></article><div className="nx-review-facts"><article><span>Domain blend</span><b>{selectedDomains.length ? selectedDomains.map(domain => domain.name ?? domain.displayName).join(' + ') : 'Auto-detected by Voxidence'}</b></article><article><span>Location</span><b>{[draft.city, draft.region, draft.country].filter(Boolean).join(', ')}</b></article><article><span>Language</span><b>{LANGUAGE_OPTIONS.find(item => item.value === draft.language)?.label}</b></article><article><span>Source strategy</span><b>Backend intelligence</b></article></div></div><label className="nx-refresh-toggle"><input type="checkbox" checked={draft.forceRefresh} onChange={e => updateDraft({ forceRefresh: e.target.checked })} /><span><b>Collect fresh evidence</b><small>Turn this on only when you do not want to reuse a recent matching collection.</small></span></label><div className="nx-normal-generation-note"><VoxidenceMark className="nx-normal-generation-note__mark" size={24} /><span><b>{isPremium ? 'Premium idea generation' : 'Normal idea generation'}</b><small>{isPremium ? `This generation uses ${premiumIdeaCreditCost ?? '…'} of your ${creditBalance} credits and creates the complete advanced workspace immediately.` : 'Your available free generation creates the core validated idea. After it is ready, you can open it first and choose Direct Unlock only when you want the advanced workspace.'}</small></span></div></section> : null}
      {error ? <div className="nx-form-error">{Array.isArray(error) ? error.join(' ') : error}</div> : null}
      <footer className="nx-wizard-actions"><button type="button" className="nx-back-button" onClick={() => step === 0 ? navigate('/normal/dashboard') : setStep(v => v - 1)}><ArrowLeft size={17} />{step === 0 ? 'Back to home' : 'Previous'}</button>{step < STEPS.length - 1 ? <button type="button" className="nx-next-button" disabled={!canContinue} aria-disabled={!canContinue} onClick={() => setStep(v => v + 1)}>Continue <ArrowRight size={18} /></button> : <button type="button" className="nx-next-button" disabled={submitting || checkingEntitlement || generationBlocked} aria-busy={submitting || checkingEntitlement} onClick={submit}>{submitting ? 'Launching intelligence…' : 'Generate validated idea'} <Sparkles size={18} /></button>}</footer>
    </div>
    {generationBlocked ? (
      <div className="nx-generation-blocker" role="dialog" aria-modal="true" aria-labelledby="generation-blocker-title">
        <motion.div
          className="nx-generation-blocker__card"
          initial={{ opacity: 0, y: 28, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 170, damping: 20 }}
        >
          <motion.span
            className="nx-generation-blocker__mark"
            animate={{ rotate: [0, 4, -4, 0], scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, repeatDelay: 0.8 }}
          >
            <VoxidenceMark size={34} />
          </motion.span>

          <span className="nx-generation-blocker__eyebrow">
            <LockKeyhole size={15} />
            Generation access
          </span>

          <h2 id="generation-blocker-title">{isPremium ? 'You need more Premium credits.' : 'Your free discoveries are complete.'}</h2>
          <p>
            {isPremium
              ? 'Your existing Premium ideas and unlocked outputs remain available. Purchase more credits to create another complete evidence-based workspace.'
              : 'You have used all normal idea generations available on this account. Your existing ideas stay available, and you can upgrade to continue creating new evidence-based workspaces.'}
          </p>

          <div className="nx-generation-blocker__status">
            <span><b>{isPremium ? creditBalance : (remainingFreeGenerations ?? 0)}</b><small>{isPremium ? 'premium credits remaining' : 'free generations remaining'}</small></span>
            <i />
            <span><Crown size={18} /><small>{isPremium ? 'Buy credits to continue generating' : 'Premium generation available after upgrade'}</small></span>
          </div>

          <div className="nx-generation-blocker__actions">
            <button type="button" className="is-secondary" onClick={() => navigate('/normal/ideas')}>
              View my ideas
            </button>
            <button type="button" className="is-primary" onClick={() => navigate('/normal/credits')}>
              {isPremium ? 'Buy more credits' : 'Upgrade workspace'}
              <ArrowRight size={18} />
            </button>
          </div>

          <button type="button" className="nx-generation-blocker__home" onClick={() => navigate('/normal/dashboard')}>
            Back to dashboard
          </button>
        </motion.div>
      </div>
    ) : null}
  </section></div>;
}