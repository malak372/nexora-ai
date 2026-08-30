/**
 * Template-aware business-model studio.
 *
 * Each template receives its own visual structure instead of forcing every
 * model into the traditional nine-block Business Model Canvas.
 *
 * Supported layouts:
 * - Business Model Canvas
 * - Lean Canvas
 * - SaaS Business Model
 * - Marketplace Model
 * - Social Impact Canvas
 * - Value Proposition Canvas
 * - Balanced fallback layout for future templates
 *
 * @author Malak
 */

import { workspacePath } from '../../shared/utils/workspacePath';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  LoaderCircle,
  Printer,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  generateBusinessModel,
  getBusinessModelTemplates,
  getCurrentBusinessModel,
} from '../api/businessModelsApi';
import { getIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
import { getDiscoveryById } from '../../discoveries/api/discoveriesApi';
import { useUserExperience } from '../../../../system/user-experience';
import '../styles/business-model.css';

const TEMPLATE_LAYOUTS = {
  'business-model-canvas': {
    label: 'Business Model Canvas',
    className: 'is-bmc',
    order: [
      'keyPartners',
      'keyActivities',
      'keyResources',
      'valuePropositions',
      'customerRelationships',
      'channels',
      'customerSegments',
      'costStructure',
      'revenueStreams',
    ],
    areas: {
      keyPartners: 'partners',
      keyActivities: 'activities',
      keyResources: 'resources',
      valuePropositions: 'value',
      customerRelationships: 'relationships',
      channels: 'channels',
      customerSegments: 'segments',
      costStructure: 'costs',
      revenueStreams: 'revenue',
    },
  },

  'lean-canvas': {
    label: 'Lean Canvas',
    className: 'is-lean',
    order: [
      'problem',
      'solution',
      'keyMetrics',
      'uniqueValueProposition',
      'unfairAdvantage',
      'channels',
      'customerSegments',
      'costStructure',
      'revenueStreams',
    ],
    areas: {
      problem: 'problem',
      solution: 'solution',
      keyMetrics: 'metrics',
      uniqueValueProposition: 'value',
      unfairAdvantage: 'advantage',
      channels: 'channels',
      customerSegments: 'segments',
      costStructure: 'costs',
      revenueStreams: 'revenue',
    },
  },

  'saas-model': {
    label: 'SaaS Business Model',
    className: 'is-saas',
    order: [
      'targetSegments',
      'coreWorkflow',
      'retention',
      'acquisitionChannels',
      'keyMetrics',
      'subscriptionTiers',
      'infrastructureCosts',
      'unitEconomics',
    ],
    areas: {
      targetSegments: 'segments',
      coreWorkflow: 'workflow',
      retention: 'retention',
      acquisitionChannels: 'acquisition',
      keyMetrics: 'metrics',
      subscriptionTiers: 'subscriptions',
      infrastructureCosts: 'infrastructure',
      unitEconomics: 'economics',
    },
  },

  'marketplace-model': {
    label: 'Marketplace Model',
    className: 'is-marketplace',
    order: [
      'demandSide',
      'valueExchange',
      'supplySide',
      'acquisitionChannels',
      'trustAndSafety',
      'liquidityStrategy',
      'operations',
      'revenueModel',
    ],
    areas: {
      demandSide: 'demand',
      valueExchange: 'exchange',
      supplySide: 'supply',
      acquisitionChannels: 'acquisition',
      trustAndSafety: 'trust',
      liquidityStrategy: 'liquidity',
      operations: 'operations',
      revenueModel: 'revenue',
    },
  },

  'social-impact-canvas': {
    label: 'Social Impact Canvas',
    className: 'is-impact',
    order: [
      'socialProblem',
      'beneficiaries',
      'intervention',
      'valueProposition',
      'keyPartners',
      'impactMetrics',
      'sustainability',
      'costStructure',
    ],
    areas: {
      socialProblem: 'problem',
      beneficiaries: 'beneficiaries',
      intervention: 'intervention',
      valueProposition: 'value',
      keyPartners: 'partners',
      impactMetrics: 'metrics',
      sustainability: 'sustainability',
      costStructure: 'costs',
    },
  },

  'value-proposition-canvas': {
    label: 'Value Proposition Canvas',
    className: 'is-vpc',
    order: [
      'productsAndServices',
      'painRelievers',
      'gainCreators',
      'customerJobs',
      'pains',
      'gains',
    ],
    areas: {
      customerJobs: 'jobs',
      pains: 'pains',
      gains: 'gains',
      productsAndServices: 'products',
      painRelievers: 'relievers',
      gainCreators: 'creators',
    },
  },
};

const ACCENTS = [
  'eucalyptus',
  'rose',
  'sage',
  'pearl',
  'teal',
  'blush',
  'mint',
  'stone',
  'seafoam',
];

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .replace(/[-_\s]+(.)?/g, (_, letter) =>
      letter ? letter.toUpperCase() : '',
    )
    .replace(/^(.)/, (letter) => letter.toLowerCase());
}

function prettify(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeItems(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) =>
      `${prettify(key)}: ${Array.isArray(item)
        ? item.join(', ')
        : String(item)
      }`,
    );
  }

  return String(value ?? '')
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function resolveTemplateKey(model, templates, selected) {
  const selectedKey = templates.find(
    (template) => template.id === selected,
  )?.key;

  return (
    selectedKey ||
    model?.businessModelTemplate?.key ||
    'dynamic'
  );
}

function getCanonicalTemplateName(template) {
  const key = template?.key;
  return TEMPLATE_LAYOUTS[key]?.label || template?.name || 'Business Model';
}

function buildSections(content, templateKey) {
  const entries = Object.entries(content || {}).map(
    ([originalKey, value]) => ({
      originalKey,
      key: normalizeKey(originalKey),
      value,
    }),
  );

  const layout = TEMPLATE_LAYOUTS[templateKey];

  if (!layout) {
    return entries.map((entry, index) => ({
      ...entry,
      label: prettify(entry.originalKey),
      area: `generic-${index + 1}`,
      accent: ACCENTS[index % ACCENTS.length],
      number: String(index + 1).padStart(2, '0'),
    }));
  }

  const ordered = layout.order
    .map((key) => entries.find((entry) => entry.key === key))
    .filter(Boolean);

  const remaining = entries.filter(
    (entry) => !ordered.includes(entry),
  );

  return [...ordered, ...remaining].map((entry, index) => ({
    ...entry,
    label: prettify(entry.originalKey),
    area: layout.areas[entry.key] || null,
    accent: ACCENTS[index % ACCENTS.length],
    number: String(index + 1).padStart(2, '0'),
  }));
}

function buildPrintableHtml(model, sections, templateKey, ideaTitle, translate, language, theme) {
  const cards = sections
    .map((section) => {
      const items = normalizeItems(section.value);

      const content =
        items.length > 1
          ? `<ul>${items
            .map((item) => `<li dir="auto">${escapeHtml(item)}</li>`)
            .join('')}</ul>`
          : items[0]
            ? `<p dir="auto">${escapeHtml(items[0])}</p>`
            : `<p>${escapeHtml(translate('No content available.'))}</p>`;

      return `
        <section class="card area-${escapeHtml(section.area)}">
          <span class="number">${escapeHtml(section.number)}</span>
          <h2>${escapeHtml(translate(section.label))}</h2>
          ${content}
        </section>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(ideaTitle || 'Untitled idea')} · Voxidence Business Model</title>
<style>
@page{size:A4 landscape;margin:9mm}
*{box-sizing:border-box}
body{margin:0;padding:0;font-family:Inter,Arial,sans-serif;color:${theme === 'dark' ? '#eaf5f2' : '#36413d'};background:${theme === 'dark' ? '#13231d' : '#fff'}}
header{display:flex;justify-content:space-between;align-items:flex-end;padding:0 0 6mm;border-bottom:1px solid ${theme === 'dark' ? '#2b4940' : '#dce9e5'}}
header span{color:${theme === 'dark' ? '#83d4cd' : '#2f7774'};font-size:9pt;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
header h1{margin:2mm 0 0;font-size:22pt;letter-spacing:-.04em;color:${theme === 'dark' ? '#f3f9f7' : '#36413d'}}
header small{color:${theme === 'dark' ? '#a8beb7' : '#78827e'}}
.idea-title{margin:2mm 0 0;max-width:230mm;color:${theme === 'dark' ? '#b8cbc5' : '#60706a'};font-size:9.5pt;font-weight:600;line-height:1.35}
.idea-title strong{color:${theme === 'dark' ? '#eef8f5' : '#36413d'};font-weight:800}
.grid{display:grid;gap:3.4mm;padding-top:5mm}
.grid.is-bmc{grid-template-columns:1.05fr 1fr 1.24fr 1fr 1.05fr;grid-template-areas:"partners activities value relationships segments" "partners resources value channels segments" "costs costs costs revenue revenue"}
.grid.is-lean{grid-template-columns:1.05fr 1fr 1.24fr 1fr 1.05fr;grid-template-areas:"problem solution value advantage segments" "problem metrics value channels segments" "costs costs costs revenue revenue"}
.grid.is-saas{grid-template-columns:1fr 1.35fr 1fr;grid-template-areas:"segments workflow retention" "acquisition workflow subscriptions" "infrastructure metrics economics"}
.grid.is-marketplace{grid-template-columns:1fr 1.25fr 1fr;grid-template-areas:"demand exchange supply" "acquisition exchange trust" "liquidity operations revenue"}
.grid.is-impact{grid-template-columns:1fr 1.2fr 1fr;grid-template-areas:"problem intervention beneficiaries" "partners value metrics" "costs sustainability sustainability"}
.grid.is-vpc{grid-template-columns:repeat(2,1fr);grid-template-areas:"products jobs" "relievers pains" "creators gains"}
.grid.is-dynamic{grid-template-columns:repeat(3,1fr)}
.card{position:relative;min-height:42mm;padding:5mm;border:1px solid ${theme === 'dark' ? '#2b4940' : '#dce9e5'};border-radius:11px;background:${theme === 'dark' ? 'linear-gradient(145deg,#1e342c,#192b25)' : 'linear-gradient(145deg,#fff,#f7fbf9)'};break-inside:avoid}
.card h2{margin:0 0 4mm;padding-inline-end:11mm;color:${theme === 'dark' ? '#83d4cd' : '#2f7774'};font-size:10pt}
.card p,.card li{font-size:8pt;line-height:1.42;color:${theme === 'dark' ? '#bfd0cb' : '#5f6b66'};unicode-bidi:plaintext;text-align:start}
.card ul{margin:0;padding-inline-start:4mm}
.number{position:absolute;inset-inline-end:4mm;top:3.5mm;color:${theme === 'dark' ? '#40675c' : '#cfe2dd'};font-size:15pt;font-weight:900}
${sections.filter((section) => section.area).map((section) => `.area-${section.area}{grid-area:${section.area}}`).join('')}
footer{margin-top:5mm;padding-top:3mm;border-top:1px solid ${theme === 'dark' ? '#2b4940' : '#dce9e5'};color:${theme === 'dark' ? '#9eb3ad' : '#87918d'};font-size:8pt;text-align:center}
@media print{body{color:#36413d!important;background:#fff!important}header{border-color:#dce9e5!important}header h1{color:#36413d!important}header span{color:#2f7774!important}header small,.idea-title{color:#60706a!important}.idea-title strong{color:#36413d!important}.card{border-color:#dce9e5!important;background:linear-gradient(145deg,#fff,#f7fbf9)!important}.card h2{color:#2f7774!important}.card p,.card li{color:#5f6b66!important}.number{color:#cfe2dd!important}footer{border-color:#dce9e5!important;color:#87918d!important}}
</style>
</head>
<body>
<header>
  <div>
    <span>Voxidence · ${escapeHtml(translate('Business model studio'))}</span>
    <h1>${escapeHtml(
    TEMPLATE_LAYOUTS[templateKey]?.label || 'Business Model',
  )}</h1>
    <p class="idea-title"><strong>${escapeHtml(translate('Idea'))}:</strong> <bdi dir="auto">${escapeHtml(
    ideaTitle || translate('Untitled idea'),
  )}</bdi></p>
  </div>
  <small>${escapeHtml(translate('Version'))} ${escapeHtml(model?.version || 1)}</small>
</header>
<main class="grid ${escapeHtml(
    TEMPLATE_LAYOUTS[templateKey]?.className || 'is-dynamic',
  )}">${cards}</main>
<footer>Voxidence · ${escapeHtml(translate('Ideas built from real needs'))}</footer>
</body>
</html>`;
}

export default function BusinessModelPage() {
  const { ideaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const { t, language, theme } = useUserExperience();

  const isAcceptedBusinessModel =
    location.state?.businessModelOrigin === 'accepted-publication';
  const acceptedPublicationId = location.state?.publicationId || '';
  const returnTo =
    location.state?.returnTo ||
    (isAcceptedBusinessModel && acceptedPublicationId
      ? workspacePath(`/normal/accepted/${acceptedPublicationId}/workspace`)
      : workspacePath(`/normal/ideas/${ideaId}`));
  const returnLabel =
    location.state?.returnLabel ||
    (isAcceptedBusinessModel ? 'Accepted idea' : 'Idea workspace');

  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState('');
  const [model, setModel] = useState(null);
  const [idea, setIdea] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    const ideaRequest =
      isAcceptedBusinessModel && acceptedPublicationId
        ? getDiscoveryById(acceptedPublicationId, {
          forceRefresh: true,
        }).then((payload) => {
          const publication = payload?.publication ?? payload;

          return {
            id: ideaId,
            title:
              publication?.publicTitle ||
              location.state?.ideaTitle ||
              'Accepted idea',
          };
        })
        : getIdeaWorkspace(ideaId);

    Promise.all([
      getBusinessModelTemplates(),
      getCurrentBusinessModel(ideaId, {
        forceRefresh: true,
      }),
      ideaRequest,
    ])
      .then(([list, current, currentIdea]) => {
        if (!mounted) return;

        const safeList = list ?? [];

        setTemplates(safeList);
        setModel(current);
        setIdea(currentIdea);
        setSelected(
          current?.businessModelTemplate?.id ||
          safeList.find((item) => item.isDefault)?.id ||
          safeList[0]?.id ||
          '',
        );
      })
      .catch((requestError) => {
        if (!mounted) return;

        setError(
          requestError?.message ||
          'Unable to load the business-model studio.',
        );
      });

    return () => {
      mounted = false;
    };
  }, [
    acceptedPublicationId,
    ideaId,
    isAcceptedBusinessModel,
    location.state?.ideaTitle,
  ]);

  const templateKey = useMemo(
    () => resolveTemplateKey(model, templates, selected),
    [model, selected, templates],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selected) ?? null,
    [selected, templates],
  );

  const layout =
    TEMPLATE_LAYOUTS[templateKey] || {
      label:
        selectedTemplate?.name ||
        model?.businessModelTemplate?.name ||
        'Business Model',
      className: 'is-dynamic',
    };

  const modelMatchesSelection = Boolean(
    model &&
    (!selected ||
      model.businessModelTemplate?.id === selected),
  );

  const visibleModel = modelMatchesSelection ? model : null;

  const sections = useMemo(
    () => buildSections(visibleModel?.content, templateKey),
    [templateKey, visibleModel],
  );

  const printableHtml = useMemo(
    () =>
      buildPrintableHtml(
        visibleModel,
        sections,
        templateKey,
        idea?.title,
        t,
        language,
        theme,
      ),
    [idea?.title, language, sections, t, templateKey, theme, visibleModel],
  );

  const generate = async () => {
    if (!selected) return;

    try {
      setBusy(true);
      setError('');
      setModel(
        await generateBusinessModel(ideaId, selected),
      );
    } catch (requestError) {
      setError(
        requestError?.message ||
        'Unable to generate the business model.',
      );
    } finally {
      setBusy(false);
    }
  };

  const printPdf = () => {
    const frame = document.getElementById(
      'business-model-preview-frame',
    );

    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  return (
    <main className="bm-page reveal-page">
      <button
        className="bm-back"
        type="button"
        onClick={() =>
          navigate(returnTo, {
            state:
              isAcceptedBusinessModel
                ? { forceRefresh: true }
                : undefined,
          })
        }
      >
        <ArrowLeft size={17} />
        {t(returnLabel)}
      </button>

      <section className="bm-hero">
        <div>
          <span>
            <Sparkles size={15} />
            {isAcceptedBusinessModel
              ? t('Accepted idea · Business design studio')
              : t('Business design studio')}
          </span>

          <h1>
            {t('Build the right model for the selected framework.')}
          </h1>

          <p>
            {t('Every template now receives its own professional layout instead of being forced into one generic grid.')}
          </p>
        </div>

        <div className="bm-hero__summary">
          <article>
            <small>{t('Active layout')}</small>
            <strong dir="ltr" data-no-auto-translate="true">{layout.label}</strong>
          </article>

          <article>
            <small>{t('Version')}</small>
            <strong>{modelMatchesSelection ? model?.version || 0 : t('New')}</strong>
          </article>
        </div>
      </section>

      <section className="bm-layout">
        <aside className="bm-templates">
          <span className="bm-kicker">
            {t('Framework library')}
          </span>
          <h2>{t('Choose a framework')}</h2>
          <p>
            {t('The displayed board changes automatically with the chosen template.')}
          </p>

          <div className="bm-template-list">
            {templates.map((template, index) => (
              <button
                key={template.id}
                type="button"
                className={
                  selected === template.id
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSelected(template.id)
                }
              >
                <span>
                  {String(index + 1).padStart(2, '0')}
                </span>

                <div>
                  <strong dir="ltr" data-no-auto-translate="true">{getCanonicalTemplateName(template)}</strong>
                  <small>{t(template.description)}</small>
                </div>

                <i>
                  {selected === template.id ? (
                    <Check size={14} />
                  ) : null}
                </i>
              </button>
            ))}
          </div>

          {/*
           * Primary generation action.
           *
           * The button intentionally mirrors the premium "Buy more credits"
           * control from the authenticated header: turquoise gradient, inset
           * icon tile, compact two-line copy, and a clear forward affordance.
           * Keeping the template name on the smaller second line also prevents
           * long framework names from making the action look oversized.
           */}
          <button
            className="bm-generate"
            type="button"
            disabled={!selected || busy}
            onClick={generate}
          >
            <span className="bm-action__icon" aria-hidden="true">
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : modelMatchesSelection ? (
                <RefreshCw size={17} />
              ) : (
                <Sparkles size={17} />
              )}
            </span>

            <span className="bm-action__copy">
              <strong>
                {modelMatchesSelection
                  ? t('Generate new version')
                  : t('Generate model')}
              </strong>
              <small>
                {selectedTemplate ? <bdi dir="ltr" data-no-auto-translate="true">{getCanonicalTemplateName(selectedTemplate)}</bdi> : t('Choose a framework')}
              </small>
            </span>

            <ArrowRight className="bm-action__arrow" size={16} aria-hidden="true" />
          </button>

          {error ? (
            <p className="bm-error">{error}</p>
          ) : null}
        </aside>

        <article className="bm-studio">
          {!visibleModel ? (
            <div className="bm-empty">
              <div className="bm-empty__icon" aria-hidden="true">
                <WandSparkles size={31} strokeWidth={1.8} />
              </div>
              <span className="bm-empty__eyebrow">{t('Ready to build')}</span>
              <h2>
                {selectedTemplate?.name
                  ? <><bdi dir="ltr" data-no-auto-translate="true">{selectedTemplate.name}</bdi>{' '}{t('is ready to generate.')}</>
                  : t('Your business model will appear here.')}
              </h2>
              <p>
                {model && !modelMatchesSelection
                  ? t('You changed the framework. Generate it to create a new version with the correct canvas structure.')
                  : t('Choose a framework, then generate a tailored model from your idea data.')}
              </p>
              {/* Same visual language as the header credit CTA. */}
              <button
                className="bm-empty__generate"
                type="button"
                disabled={!selected || busy}
                onClick={generate}
              >
                <span className="bm-action__icon" aria-hidden="true">
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}
                </span>

                <span className="bm-action__copy">
                  <strong>{busy ? t('Generating…') : t('Generate now')}</strong>
                  <small>{selectedTemplate?.name ? <bdi dir="ltr" data-no-auto-translate="true">{selectedTemplate.name}</bdi> : t('Business model')}</small>
                </span>

                <ArrowRight className="bm-action__arrow" size={17} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <header>
                <div>
                  <span dir="ltr" data-no-auto-translate="true">{layout.label}</span>
                  <h2>
                    {visibleModel.businessModelTemplate?.name
                      ? <bdi dir="ltr" data-no-auto-translate="true">{visibleModel.businessModelTemplate.name}</bdi>
                      : <bdi dir="ltr" data-no-auto-translate="true">{layout.label}</bdi>}
                  </h2>
                  <p>
                    {t('Template-specific structure · presentation ready')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye size={16} />
                  {t('Open presentation')}
                </button>
              </header>

              <div
                className={`bm-board ${layout.className}`}
              >
                {sections.map((section, index) => {
                  const items = normalizeItems(
                    section.value,
                  );

                  return (
                    <motion.section
                      key={section.originalKey}
                      className={`bm-card bm-card--${section.accent}${section.area ? ` bm-area--${section.area}` : ''}`}
                      initial={
                        shouldReduceMotion
                          ? undefined
                          : {
                            opacity: 0,
                            y: 18,
                          }
                      }
                      whileInView={{
                        opacity: 1,
                        y: 0,
                      }}
                      viewport={{
                        once: true,
                        amount: 0.12,
                      }}
                      transition={{
                        duration: 0.42,
                        delay: shouldReduceMotion
                          ? 0
                          : index * 0.035,
                      }}
                    >
                      <span className="bm-card__number">
                        {section.number}
                      </span>

                      <h3>{t(section.label)}</h3>

                      {items.length > 1 ? (
                        <ul>
                          {items.map(
                            (item, itemIndex) => (
                              <li
                                key={`${section.originalKey}-${itemIndex}`}
                              >
                                <span dir="auto" data-idea-content="true">{item}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      ) : (
                        <p dir="auto" data-idea-content="true">
                          {items[0] ||
                            t('No content available.')}
                        </p>
                      )}
                    </motion.section>
                  );
                })}
              </div>
            </>
          )}
        </article>
      </section>

      {typeof document !== 'undefined'
        ? createPortal(
          <AnimatePresence>
            {previewOpen ? (
              <motion.div
                className="bm-modal"
                role="dialog"
                aria-modal="true"
                aria-label={t('Business model presentation preview')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setPreviewOpen(false);
                  }
                }}
              >
                <motion.div
                  className="bm-modal__shell"
                  initial={
                    shouldReduceMotion
                      ? undefined
                      : {
                        opacity: 0,
                        y: 18,
                        scale: 0.98,
                      }
                  }
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                  }}
                  exit={{
                    opacity: 0,
                    y: 12,
                    scale: 0.985,
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <header>
                    <div>
                      <strong>{t('Presentation preview')}</strong>
                      <small>
                        {idea?.title ? (
                          <>
                            <bdi dir="auto" data-idea-content="true">
                              {idea.title}
                            </bdi>
                            <span aria-hidden="true"> · </span>
                            <span dir="ltr" data-no-auto-translate="true">{layout.label}</span>
                          </>
                        ) : (
                          <span dir="ltr" data-no-auto-translate="true">{layout.label}</span>
                        )}
                      </small>
                    </div>

                    <div>
                      <button
                        type="button"
                        className="bm-preview-print"
                        onClick={printPdf}
                      >
                        <Printer size={16} />
                        {t('Print or save PDF')}
                      </button>

                      <button
                        type="button"
                        className="bm-preview-close"
                        aria-label={t('Close')}
                        onClick={() =>
                          setPreviewOpen(false)
                        }
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </header>

                  <iframe
                    id="business-model-preview-frame"
                    title={t('Business model preview')}
                    srcDoc={printableHtml}
                  />
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )
        : null}
    </main>
  );
}