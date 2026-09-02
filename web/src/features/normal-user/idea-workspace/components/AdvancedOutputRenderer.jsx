// @refresh reset
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  Layers3,
  MessageSquare,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

const humanizeKey = (value) =>
  String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');

const PRESENTATIONS = [
  {
    match: /full abstract|abstract|executive brief/,
    variant: 'abstract',
    icon: FileText,
    label: 'Executive narrative',
  },
  {
    match: /technology stack|technical stack|tech stack/,
    variant: 'technology',
    icon: Cpu,
    label: 'Technology stack',
  },
  {
    match: /system architecture|solution architecture|architecture/,
    variant: 'architecture',
    icon: Layers3,
    label: 'Architecture flow',
  },
  {
    match: /database design|data model|database/,
    variant: 'database',
    icon: Database,
    label: 'Data model',
  },
  {
    match: /mvp features|mvp feature set|minimum viable|feature set/,
    variant: 'mvp',
    icon: Rocket,
    label: 'MVP priorities',
  },
  {
    match: /value proposition|customer value/,
    variant: 'value',
    icon: Target,
    label: 'Value proposition',
  },
  {
    match: /revenue model|monetization|revenue/,
    variant: 'revenue',
    icon: BriefcaseBusiness,
    label: 'Revenue model',
  },
  {
    match: /local regulation|regulatory|compliance/,
    variant: 'regulations',
    icon: ShieldCheck,
    label: 'Regulatory guidance',
  },
  {
    match: /budget estimation|budget estimate|cost estimation|cost estimate|budget/,
    variant: 'budget',
    icon: Wallet,
    label: 'Budget breakdown',
  },
  {
    match: /feasibility assessment|feasibility analysis|feasibility/,
    variant: 'feasibility',
    icon: CheckCircle2,
    label: 'Feasibility review',
  },
  {
    match: /implementation timeline|project timeline|development timeline|roadmap|timeline/,
    variant: 'timeline',
    icon: CalendarDays,
    label: 'Implementation roadmap',
  },
  {
    match: /market potential|market opportunity|market analysis/,
    variant: 'market',
    icon: TrendingUp,
    label: 'Market validation',
  },
  {
    match: /nlp executive summary|natural language processing|nlp/,
    variant: 'nlp',
    icon: Bot,
    label: 'NLP evidence summary',
  },
  {
    match: /community feedback summary|community feedback|feedback summary/,
    variant: 'community',
    icon: MessageSquare,
    label: 'Community evidence',
  },
  {
    match: /business model|operating model/,
    variant: 'business',
    icon: BriefcaseBusiness,
    label: 'Business model',
  },
];

export function getAdvancedOutputPresentation(section) {
  const signature = normalizeKey(
    `${section?.outputKey || ''} ${section?.key || ''} ${section?.title || ''}`,
  );

  const presentation = PRESENTATIONS.find(({ match }) => match.test(signature));

  return (
    presentation || {
      variant: 'generic',
      icon: Sparkles,
      label: 'Structured analysis',
    }
  );
}

function stringifyValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available yet.';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stringifyValue).join(' · ');

  return Object.entries(value)
    .map(([key, item]) => `${humanizeKey(key)}: ${stringifyValue(item)}`)
    .join(' · ');
}

function splitSentences(value) {
  const source = String(value || '').trim();
  if (!source) return [];

  const explicitLines = source
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[•*\-–—]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  if (explicitLines.length > 1) return explicitLines;

  const sentences = source
    .split(/(?<=[.!?])\s+(?=(?:[A-Z0-9]|The\b|This\b|Current\b|Formal\b|Preliminary\b|No\b|A\b|An\b|Trusted\b|Collected\b|Major\b|Excluded\b|Assumptions\b|Month\b))/)
    .map((line) => line.trim())
    .filter(Boolean);

  return sentences.length > 1 ? sentences : [source];
}


function parseLabeledEntry(text, fallbackLabel) {
  const normalizedText = String(text || '').trim();
  const match = normalizedText.match(
    /^([A-Za-z][A-Za-z0-9 &/+()'’-]{1,64})\s*:\s*(.+)$/s,
  );

  if (!match) {
    return {
      label: fallbackLabel,
      text: normalizedText,
    };
  }

  return {
    label: match[1].trim(),
    text: match[2].trim(),
  };
}

function isGenericEntryLabel(label) {
  return /^(?:insight|item|context|feature|assessment|architecture note|data structure|market insight|nlp insight|evidence note|technology note|business block)\b/i.test(
    String(label || '').trim(),
  );
}

function resolveEntryTitle(entry, index, titleForText, fallbackLabel = 'Insight') {
  if (entry?.label && !isGenericEntryLabel(entry.label)) {
    return humanizeKey(entry.label);
  }

  if (titleForText) {
    return titleForText(entry?.text || '', index);
  }

  return entry?.label || `${fallbackLabel} ${String(index + 1).padStart(2, '0')}`;
}

function groupEntriesByTitle(entries, titleForText, fallbackLabel = 'Insight') {
  const groups = new Map();

  entries.forEach((entry, index) => {
    const title = resolveEntryTitle(entry, index, titleForText, fallbackLabel);
    const key = normalizeKey(title) || `group-${index}`;

    if (!groups.has(key)) {
      groups.set(key, {
        title,
        entries: [],
      });
    }

    groups.get(key).entries.push(entry);
  });

  return Array.from(groups.values());
}

function GroupedEntryBody({ entries }) {
  if (entries.length <= 1) {
    return <p>{entries[0]?.text || 'Not available yet.'}</p>;
  }

  return (
    <div className="advanced-output__grouped-notes">
      <span>{entries.length} related notes</span>
      <ul>
        {entries.map((entry, index) => (
          <li key={`${entry.label}-${index}`}>
            <p>{entry.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function contentEntries(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item, index) => {
        const text = stringifyValue(item);
        return splitSentences(text).map((sentence, sentenceIndex) =>
          parseLabeledEntry(
            sentence,
            sentenceIndex
              ? `Item ${String(index + 1).padStart(2, '0')}.${sentenceIndex + 1}`
              : `Item ${String(index + 1).padStart(2, '0')}`,
          ),
        );
      })
      .filter((item) => item.text.trim());
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .flatMap(([key, item]) => {
        if (Array.isArray(item)) {
          return item.map((nested, index) =>
            parseLabeledEntry(
              stringifyValue(nested),
              item.length > 1
                ? `${humanizeKey(key)} ${String(index + 1).padStart(2, '0')}`
                : humanizeKey(key),
            ),
          );
        }

        const text = stringifyValue(item);
        const pieces = splitSentences(text);
        return pieces.map((piece, index) =>
          parseLabeledEntry(
            piece,
            index ? `${humanizeKey(key)} ${String(index + 1).padStart(2, '0')}` : humanizeKey(key),
          ),
        );
      })
      .filter((item) => item.text.trim());
  }

  return splitSentences(value).map((item, index) =>
    parseLabeledEntry(item, `Insight ${String(index + 1).padStart(2, '0')}`),
  );
}

function isScopeContext(text) {
  return /requester[- ]defined scope spans|requester[- ]selected implementation and validation dimensions|independently evidenced problem domains|retained supporting evidence currently validates/i.test(
    String(text || ''),
  );
}

function contextLabel(text, index) {
  if (/requester[- ]defined scope spans/i.test(text)) return 'Requester scope';
  if (/retained supporting evidence currently validates|independently evidenced problem domains/i.test(text)) {
    return 'Evidence alignment';
  }
  return `Context ${String(index + 1).padStart(2, '0')}`;
}

function partitionEntries(entries) {
  const context = [];
  const content = [];

  entries.forEach((entry) => {
    if (isScopeContext(entry.text)) {
      context.push({
        ...entry,
        label: contextLabel(entry.text, context.length),
      });
    } else {
      content.push(entry);
    }
  });

  return {
    context,
    content: content.length ? content : entries,
  };
}

function splitInlineList(text) {
  const source = String(text || '').trim();
  if (!source) return [];

  const hyphenParts = source
    .split(/\s+(?:-|–|—)\s+(?=[A-Z0-9@])/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (hyphenParts.length > 2) return hyphenParts;

  const bulletParts = source
    .split(/\s*[•|]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  return bulletParts.length > 2 ? bulletParts : [source];
}

function extractCommunityMetrics(text) {
  const signals = text.match(/(\d+)\s+(?:retained\s+)?(?:external\s+)?supporting\s+signal/i)?.[1];
  const sources = text.match(/(?:across|from)\s+(\d+)\s+source/i)?.[1];
  const direct = /no\s+verified\s+direct[- ]user\s+evidence/i.test(text)
    ? 'Not verified'
    : /verified\s+direct[- ]user\s+evidence/i.test(text)
      ? 'Verified'
      : 'Review needed';

  return [
    signals ? { value: signals, label: 'Supporting signals' } : null,
    sources ? { value: sources, label: 'Sources' } : null,
    { value: direct, label: 'Direct-user evidence' },
  ].filter(Boolean);
}

function extractMarketStatus(text) {
  if (/market potential remains unproven|market[- ]wide demand.*(?:not|no)|no verified direct[- ]user evidence/i.test(text)) {
    return { title: 'Needs validation', detail: 'Market-wide demand is not yet established by the retained evidence.' };
  }
  if (/preliminary support|preliminary evidence/i.test(text)) {
    return { title: 'Preliminary support', detail: 'Early signals exist, but broader market validation is still required.' };
  }
  if (/validated|verified demand|establishes recurrence|willingness to adopt/i.test(text)) {
    return { title: 'Evidence-backed', detail: 'The retained output contains stronger validation signals.' };
  }
  return { title: 'Under assessment', detail: 'The available evidence should be reviewed before drawing broader market conclusions.' };
}

function extractRegulationItems(text) {
  const match = text.match(/(?:compliance with|guidance (?:includes|suggests))\s+(.+?)(?:\.\s|$)/i);
  const source = match?.[1] || '';

  return source
    .split(/,|;|\band\b/i)
    .map((item) => item.trim().replace(/[.]+$/, ''))
    .filter((item) => item.length > 4)
    .slice(0, 5);
}

function extractMoney(text) {
  const matches = text.match(/(?:[$€£₪]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:USD|EUR|GBP|ILS|NIS|dollars?)\b)/gi);
  return Array.from(new Set(matches || [])).slice(0, 8);
}

function extractNlpMetrics(text) {
  const match = text.match(/processed\s+(\d+)\s+text\(s\).*?(\d+)\s+post\(s\).*?(\d+)\s+comment\(s\)/i);
  if (!match) return [];

  return [
    { value: match[1], label: 'Texts processed' },
    { value: match[2], label: 'Posts processed' },
    { value: match[3], label: 'Comments processed' },
  ];
}

function titleForArchitecture(text) {
  const source = String(text || '');

  if (/\bmodular\b|\bmonolith\b|\bmicroservices?\b|\barchitecture style\b|\blayered architecture\b/i.test(source)) {
    return 'Architecture Style';
  }
  if (/\bauth(?:entication|orization)?\b|\bjwt\b|json web token|role[- ]based|access control|\bpermissions?\b|\btls\b|\bencrypt(?:ed|ion)?\b|\bsecurity\b/i.test(source)) {
    return 'Access & Security';
  }
  if (/@nestjs\/schedule|\bschedul(?:e|ed|er|ing)\b|\bcron\b|\bperiodic\b|\bbackground\b|\bworker\b|\bjob\b/i.test(source)) {
    return 'Background Processing';
  }
  if (/\bthird[- ]party\b|\bintegrat(?:e|ed|ion|ions)\b|\bcollector\b|\bprovider\b|\bwebhook\b|\bexternal service\b/i.test(source)) {
    return 'Integrations';
  }
  if (/\bcontrollers?\b|\bendpoints?\b|\broutes?\b|\bhttp\b|\bapi\b|\bclient requests?\b|\brequest flow\b/i.test(source)) {
    return 'Request Flow';
  }
  if (/\bbusiness logic\b|\bapplication service\b|\bservice layer\b|\bbackend service\b|\bcalculat(?:e|ion|ions)\b|\bscor(?:e|ing)\b|\borchestrat(?:e|ion)\b/i.test(source)) {
    return 'Application Services';
  }
  if (/\bpostgres(?:ql)?\b|\bprisma\b|\bdatabase\b|\bpersist(?:ed|ence|ing)?\b|\brepositor(?:y|ies)\b|\bstorage\b|\bdata layer\b/i.test(source)) {
    return 'Data Persistence';
  }

  return 'Architecture Details';
}

function titleForDatabase(text) {
  const table = text.match(/\b([a-z][a-z0-9_]*)\s+table\b/i)?.[1]
    || text.match(/\btable\s+([a-z][a-z0-9_]*)\b/i)?.[1];

  if (table) return `Table · ${humanizeKey(table)}`;
  if (/relational schema|schema foundation|\bschema\b/i.test(text)) return 'Schema Foundation';
  if (/foreign key|relationship|relation/i.test(text)) return 'Relationships';
  if (/index|lookup/i.test(text)) return 'Indexes & Lookup';
  if (/entity|entities|table|record|field|column/i.test(text)) return 'Core Entities';
  return 'Data Model Notes';
}

function titleForFeasibility(text) {
  if (/technical/i.test(text)) return 'Technical Feasibility';
  if (/operational/i.test(text)) return 'Operational Feasibility';
  if (/economic|financial|budget|cost/i.test(text)) return 'Economic Feasibility';
  if (/legal|regulatory|compliance/i.test(text)) return 'Regulatory Feasibility';
  if (/schedule|timeline|delivery|time/i.test(text)) return 'Delivery Feasibility';
  return 'General Feasibility';
}

function titleForMarket(text) {
  if (/market potential remains unproven|\bdemand\b|market status/i.test(text)) return 'Demand Status';
  if (/supporting signal|source|evidence coverage/i.test(text)) return 'Evidence Coverage';
  if (/direct[- ]user|willingness|adopt|recurrence|prevalence/i.test(text)) return 'Direct-user Validation';
  if (/pilot|collect direct evidence|before any broader commercial conclusion|next validation|next step/i.test(text)) return 'Next Validation Step';
  return 'Market Context';
}

function titleForNlp(text) {
  if (/processed\s+\d+\s+text|processing coverage/i.test(text)) return 'Processing Coverage';
  if (/supporting signal|retained|evidence retained/i.test(text)) return 'Evidence Retained';
  if (/context_only|unrelated|excluded|excluded corpus/i.test(text)) return 'Excluded Corpus';
  if (/sentiment|theme|language|nlp|synthesis/i.test(text)) return 'Language Synthesis';
  return 'NLP Interpretation';
}

function titleForCommunity(text) {
  if (/supporting signal|source|retained evidence/i.test(text)) return 'Retained Evidence';
  if (/context_only|unrelated|excluded|excluded findings/i.test(text)) return 'Excluded Findings';
  if (/requester text may shape|does not redefine|problem family|scope interpretation/i.test(text)) return 'Scope Interpretation';
  if (/community|feedback|demand evidence|community signal/i.test(text)) return 'Community Signal';
  return 'Community Context';
}

function titleForRegulation(text) {
  if (/privacy|data protection|consent|data residency|cross-border data/i.test(text)) return 'Data Protection & Privacy';
  if (/record[- ]keeping|records?|retention|audit trail/i.test(text)) return 'Record-Keeping';
  if (/food safety|domain regulation|sector regulation|reporting framework/i.test(text)) return 'Domain Regulations';
  if (/legal counsel|local authorities|rollout|deployment|jurisdiction/i.test(text)) return 'Deployment Review';
  return 'Regulatory Guidance';
}

function ContextStrip({ entries }) {
  if (!entries.length) return null;

  return (
    <div className="advanced-output__context-strip">
      {entries.slice(0, 2).map((entry, index) => (
        <article key={`${entry.label}-${index}`}>
          <span className="advanced-output__context-icon">
            {index === 0 ? <Target size={15} /> : <ShieldCheck size={15} />}
          </span>
          <div>
            <small>{entry.label}</small>
            <p>{entry.text}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutputFrame({ variant, label, icon: Icon, contextEntries, children }) {
  return (
    <section className={`advanced-output advanced-output--${variant}`}>
      <div className="advanced-output__ambient" aria-hidden="true" />
      <div className="advanced-output__topline">
        <span className="advanced-output__identity">
          <span className="advanced-output__identity-icon"><Icon size={17} /></span>
          <span>{label}</span>
        </span>
        <span className="advanced-output__verified"><CheckCircle2 size={13} /> Structured view</span>
      </div>
      <ContextStrip entries={contextEntries} />
      <div className="advanced-output__content">{children}</div>
    </section>
  );
}

function InsightCards({ entries, label = 'Insight', titleForText, icon: Icon = Sparkles, group = false }) {
  const groups = group
    ? groupEntriesByTitle(entries, titleForText, label)
    : entries.map((entry, index) => ({
        title: resolveEntryTitle(entry, index, titleForText, label),
        entries: [entry],
      }));

  return (
    <div className="advanced-output__insight-grid">
      {groups.map((groupedEntry, index) => (
        <article key={`${groupedEntry.title}-${index}`} className="advanced-output__insight-card">
          <div className="advanced-output__card-head">
            <span className="advanced-output__card-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="advanced-output__card-icon"><Icon size={16} /></span>
          </div>
          <strong>{groupedEntry.title}</strong>
          <GroupedEntryBody entries={groupedEntry.entries} />
        </article>
      ))}
    </div>
  );
}

function AbstractView({ entries }) {
  const [lead, ...rest] = entries;
  return (
    <div className="advanced-output__abstract-layout">
      <article className="advanced-output__lead-card">
        <span className="advanced-output__lead-mark"><FileText size={19} /></span>
        <div>
          <small>Executive narrative</small>
          <p>{lead?.text || 'Not available yet.'}</p>
        </div>
      </article>
      {rest.length ? <InsightCards entries={rest} icon={FileText} /> : null}
    </div>
  );
}

function TechnologyView({ entries }) {
  const shortCollection =
    entries.length >= 3
    && entries.every(
      (entry) =>
        /^Item\b/i.test(String(entry.label || ''))
        && String(entry.text || '').trim().length <= 120,
    );

  const stackEntry = shortCollection
    ? null
    : entries.find((entry) => splitInlineList(entry.text).length >= 4);

  const stack = shortCollection
    ? entries.map((entry) => entry.text)
    : stackEntry
      ? splitInlineList(stackEntry.text)
      : [];

  const detailEntries = shortCollection
    ? []
    : stackEntry
      ? entries.filter((entry) => entry !== stackEntry)
      : entries;

  return (
    <div className="advanced-output__technology-layout">
      {stack.length >= 3 ? (
        <article className="advanced-output__stack-card">
          <div className="advanced-output__section-kicker">
            <span><Cpu size={18} /></span>
            <div><small>Technology selection</small><strong>Recommended stack</strong></div>
          </div>
          <div className="advanced-output__chip-cloud">
            {stack.map((chip, index) => <span key={`${chip}-${index}`}>{chip}</span>)}
          </div>
        </article>
      ) : null}
      {detailEntries.length ? (
        <InsightCards
          entries={detailEntries}
          icon={Cpu}
          group
          titleForText={(technologyText) => (/stack|technology|framework|frontend|backend/i.test(technologyText) ? 'Stack Rationale' : 'Technology Notes')}
        />
      ) : null}
    </div>
  );
}

function ArchitectureView({ entries }) {
  const groups = groupEntriesByTitle(entries, titleForArchitecture, 'Architecture');

  return (
    <div className="advanced-output__flow-list">
      {groups.map((group, index) => (
        <article key={`${group.title}-${index}`}>
          <span className="advanced-output__flow-node"><Layers3 size={17} /></span>
          <div>
            <small>{String(index + 1).padStart(2, '0')}</small>
            <strong>{group.title}</strong>
            <GroupedEntryBody entries={group.entries} />
          </div>
        </article>
      ))}
    </div>
  );
}

function DatabaseView({ entries }) {
  return (
    <InsightCards
      entries={entries}
      icon={Database}
      titleForText={titleForDatabase}
      group
    />
  );
}

function expandFeatureEntries(entries) {
  const expanded = [];

  entries.forEach((entry) => {
    const parts = splitInlineList(entry.text);
    if (parts.length > 2) {
      const first = parts[0];
      const startsWithIntro = /(?:features?|mvp|includes?|comprises?|consists?)(?:\s+of)?\s*:?[\s]*$/i.test(first)
        || (
          /(?:features?|mvp|includes?|comprises?|consists?)/i.test(first)
          && first.length < 120
        );
      const actualParts = startsWithIntro ? parts.slice(1) : parts;
      actualParts.forEach((part, index) => {
        expanded.push({ label: `Feature ${String(index + 1).padStart(2, '0')}`, text: part });
      });
    } else {
      expanded.push(entry);
    }
  });

  return expanded;
}

function MvpView({ entries }) {
  const features = expandFeatureEntries(entries);
  return (
    <div className="advanced-output__feature-grid">
      {features.map((entry, index) => (
        <article key={`${entry.label}-${index}`}>
          <div className="advanced-output__feature-number">{String(index + 1).padStart(2, '0')}</div>
          <span className="advanced-output__feature-icon"><Rocket size={17} /></span>
          <strong>{/^Insight|^Item|^Feature/i.test(entry.label) ? `MVP feature ${String(index + 1).padStart(2, '0')}` : entry.label}</strong>
          <p>{entry.text}</p>
        </article>
      ))}
    </div>
  );
}

function ValueView({ entries }) {
  const [lead, ...rest] = entries;
  return (
    <div className="advanced-output__value-layout">
      <article className="advanced-output__value-core">
        <span><Target size={24} /></span>
        <div>
          <small>Core value</small>
          <strong>Primary value proposition</strong>
          <p>{lead?.text || 'Not available yet.'}</p>
        </div>
      </article>
      {rest.length ? <InsightCards entries={rest} icon={Target} /> : null}
    </div>
  );
}

function RevenueView({ entries }) {
  return (
    <div className="advanced-output__revenue-layout">
      <article className="advanced-output__section-summary">
        <span><BriefcaseBusiness size={20} /></span>
        <div>
          <small>Commercial model</small>
          <strong>Revenue structure</strong>
        </div>
      </article>
      <InsightCards entries={entries} icon={BriefcaseBusiness} group />
    </div>
  );
}

function RegulationsView({ entries, rawText }) {
  const regulationItems = extractRegulationItems(rawText);
  const advisory = entries.find((entry) =>
    /formal legal review|legal counsel|local authorities|prior to commercial rollout|jurisdiction/i.test(
      `${entry.label} ${entry.text}`,
    ),
  );
  const guidanceEntries = entries.filter((entry) => entry !== advisory);
  const guidanceGroups = groupEntriesByTitle(
    guidanceEntries.length ? guidanceEntries : entries,
    titleForRegulation,
    'Regulation',
  );

  return (
    <div className="advanced-output__regulations-layout">
      {advisory ? (
        <article className="advanced-output__advisory">
          <span><ShieldCheck size={19} /></span>
          <div><strong>Local review required before rollout</strong><p>{advisory.text}</p></div>
        </article>
      ) : null}

      <div className="advanced-output__regulations-grid">
        <aside className="advanced-output__regulations-brief">
          <span className="advanced-output__brief-icon"><ShieldCheck size={27} /></span>
          <small>Compliance brief</small>
          <strong>Regulatory areas identified in this output</strong>
          {regulationItems.length ? (
            <div className="advanced-output__tag-list">
              {regulationItems.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}
            </div>
          ) : (
            <p>Review the generated local requirements and validation notes for the intended deployment region.</p>
          )}
        </aside>

        <div className="advanced-output__regulations-cards">
          {guidanceGroups.map((group, index) => (
            <article key={`${group.title}-${index}`}>
              <div className="advanced-output__card-head">
                <span className="advanced-output__card-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="advanced-output__card-icon"><ShieldCheck size={16} /></span>
              </div>
              <strong>{group.title}</strong>
              <GroupedEntryBody entries={group.entries} />
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function BudgetView({ entries, rawText }) {
  const money = extractMoney(rawText);
  const signature = (entry) => `${entry?.label || ''} ${entry?.text || ''}`;
  const overview = entries.find((entry) => /budget range|estimated budget|budget.*(?:range|pilot)|preliminary.*budget/i.test(signature(entry)));
  const categories = entries.find((entry) => /cost structure|major cost categor|core software development|cloud hosting|contingency/i.test(signature(entry)));
  const assumptions = entries.find((entry) => /assumption|planning basis/i.test(signature(entry)));
  const excluded = entries.find((entry) => /excluded cost|excluded|does not include|scope boundary/i.test(signature(entry)));
  const used = new Set([overview, categories, assumptions, excluded].filter(Boolean));
  const rest = entries.filter((entry) => !used.has(entry));

  return (
    <div className="advanced-output__budget-layout">
      <article className="advanced-output__budget-overview">
        <span className="advanced-output__budget-icon"><Wallet size={22} /></span>
        <div>
          <small>Budget snapshot</small>
          <strong>{overview ? 'Pilot estimate' : 'Cost references from the generated output'}</strong>
          {overview ? <p>{overview.text}</p> : null}
        </div>
        {money.length ? (
          <div className="advanced-output__money-chips">
            {money.map((amount) => <span key={amount}>{amount}</span>)}
          </div>
        ) : null}
      </article>

      {categories ? (
        <article className="advanced-output__budget-detail advanced-output__budget-detail--wide">
          <span><BriefcaseBusiness size={18} /></span>
          <div><small>Cost structure</small><strong>Major cost categories</strong><p>{categories.text}</p></div>
        </article>
      ) : null}

      {(assumptions || excluded) ? (
        <div className="advanced-output__budget-notes">
          {assumptions ? (
            <article className="advanced-output__budget-detail">
              <span><CheckCircle2 size={18} /></span>
              <div><small>Planning basis</small><strong>Assumptions</strong><p>{assumptions.text}</p></div>
            </article>
          ) : null}
          {excluded ? (
            <article className="advanced-output__budget-detail">
              <span><ShieldCheck size={18} /></span>
              <div><small>Scope boundary</small><strong>Excluded costs</strong><p>{excluded.text}</p></div>
            </article>
          ) : null}
        </div>
      ) : null}

      {rest.length ? <InsightCards entries={rest} icon={Wallet} group /> : null}
    </div>
  );
}

function FeasibilityView({ entries }) {
  const groups = groupEntriesByTitle(entries, titleForFeasibility, 'Assessment');

  return (
    <div className="advanced-output__feasibility-grid">
      {groups.map((group, index) => (
        <article key={`${group.title}-${index}`}>
          <span className="advanced-output__feasibility-icon"><CheckCircle2 size={18} /></span>
          <div>
            <small>{String(index + 1).padStart(2, '0')}</small>
            <strong>{group.title}</strong>
            <GroupedEntryBody entries={group.entries} />
          </div>
        </article>
      ))}
    </div>
  );
}

function timelineSegments(entries) {
  const segments = [];
  let intro = '';

  entries.forEach((entry) => {
    const text = String(entry.text || '').trim();
    const periodStart = text.search(/\b(?:Month(?:s)?|Week(?:s)?|Phase)\s+\d/i);

    if (periodStart >= 0) {
      const prefix = text.slice(0, periodStart).replace(/[:;\s]+$/, '').trim();
      if (prefix && !intro) intro = prefix;
      const timelineText = text.slice(periodStart);
      const parts = timelineText
        .split(/;\s*(?:and\s+)?(?=(?:Month(?:s)?|Week(?:s)?|Phase)\s+\d)/i)
        .map((part) => part.trim())
        .filter(Boolean);

      parts.forEach((part) => {
        const match = part.match(/^((?:Month(?:s)?|Week(?:s)?|Phase)\s+[\d\s–—-]+)\s*(?:for|:|-)?\s*(.*)$/i);
        if (match) {
          segments.push({ period: match[1].trim(), text: match[2].trim() || part });
        } else {
          segments.push({ period: `Step ${String(segments.length + 1).padStart(2, '0')}`, text: part });
        }
      });
      return;
    }

    segments.push({
      period: /^Insight|^Item/i.test(entry.label)
        ? `Step ${String(segments.length + 1).padStart(2, '0')}`
        : entry.label,
      text,
    });
  });

  return { intro, segments };
}

function TimelineView({ entries }) {
  const { intro, segments } = timelineSegments(entries);

  return (
    <div className="advanced-output__timeline-layout">
      <article className="advanced-output__timeline-overview">
        <span><CalendarDays size={19} /></span>
        <div><small>Roadmap overview</small><strong>{intro || 'Generated implementation sequence'}</strong></div>
        <span className="advanced-output__timeline-count">{segments.length} {segments.length === 1 ? 'stage' : 'stages'}</span>
      </article>

      <div className="advanced-output__timeline">
        {segments.map((segment, index) => (
          <article key={`${segment.period}-${index}`}>
            <div className="advanced-output__timeline-rail">
              <span>{String(index + 1).padStart(2, '0')}</span>
              {index < segments.length - 1 ? <i aria-hidden="true" /> : null}
            </div>
            <div className="advanced-output__timeline-card">
              <small>{segment.period}</small>
              <p>{segment.text}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function MarketView({ entries, rawText }) {
  const status = extractMarketStatus(rawText);
  const metrics = extractCommunityMetrics(rawText);

  return (
    <div className="advanced-output__market-layout">
      <div className="advanced-output__market-summary">
        <article className="advanced-output__market-status">
          <span><TrendingUp size={22} /></span>
          <div><small>Market status</small><strong>{status.title}</strong><p>{status.detail}</p></div>
        </article>

        <div className="advanced-output__metric-row">
          {metrics.map((metric) => (
            <article key={metric.label}>
              <strong>{metric.value}</strong>
              <small>{metric.label}</small>
            </article>
          ))}
        </div>
      </div>

      <InsightCards entries={entries} icon={TrendingUp} titleForText={titleForMarket} group />
    </div>
  );
}

function NlpView({ entries, rawText }) {
  const metrics = extractNlpMetrics(rawText);

  return (
    <div className="advanced-output__nlp-layout">
      {metrics.length ? (
        <div className="advanced-output__metric-row advanced-output__metric-row--nlp">
          {metrics.map((metric) => (
            <article key={metric.label}>
              <span><Bot size={16} /></span>
              <strong>{metric.value}</strong>
              <small>{metric.label}</small>
            </article>
          ))}
        </div>
      ) : null}
      <InsightCards entries={entries} icon={Bot} titleForText={titleForNlp} group />
    </div>
  );
}

function CommunityView({ entries, rawText }) {
  const metrics = extractCommunityMetrics(rawText);

  return (
    <div className="advanced-output__community-layout">
      <div className="advanced-output__community-stats">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span><MessageSquare size={17} /></span>
            <div><strong>{metric.value}</strong><small>{metric.label}</small></div>
          </article>
        ))}
      </div>

      <InsightCards entries={entries} icon={MessageSquare} titleForText={titleForCommunity} group />
    </div>
  );
}

function BusinessView({ entries }) {
  return (
    <div className="advanced-output__business-canvas">
      {entries.map((entry, index) => (
        <article key={`${entry.label}-${index}`}>
          <span><BriefcaseBusiness size={17} /></span>
          <small>Business block {String(index + 1).padStart(2, '0')}</small>
          <strong>{/^Insight|^Item/i.test(entry.label) ? `Business model note ${String(index + 1).padStart(2, '0')}` : entry.label}</strong>
          <p>{entry.text}</p>
        </article>
      ))}
    </div>
  );
}

function GenericAdvancedView({ entries }) {
  return <InsightCards entries={entries} />;
}

export function AdvancedOutputContent({ section, value }) {
  const presentation = getAdvancedOutputPresentation(section);
  const entries = contentEntries(value);
  const safeEntries = entries.length
    ? entries
    : [{ label: 'Insight 01', text: 'Not available yet.' }];
  const { context, content } = partitionEntries(safeEntries);
  const contentRawText = content.map((entry) => entry.text).join(' ');

  let rendered;
  switch (presentation.variant) {
    case 'abstract':
      rendered = <AbstractView entries={content} />;
      break;
    case 'technology':
      rendered = <TechnologyView entries={content} />;
      break;
    case 'architecture':
      rendered = <ArchitectureView entries={content} />;
      break;
    case 'database':
      rendered = <DatabaseView entries={content} />;
      break;
    case 'mvp':
      rendered = <MvpView entries={content} />;
      break;
    case 'value':
      rendered = <ValueView entries={content} />;
      break;
    case 'revenue':
      rendered = <RevenueView entries={content} />;
      break;
    case 'regulations':
      rendered = <RegulationsView entries={content} rawText={contentRawText} />;
      break;
    case 'budget':
      rendered = <BudgetView entries={content} rawText={contentRawText} />;
      break;
    case 'feasibility':
      rendered = <FeasibilityView entries={content} />;
      break;
    case 'timeline':
      rendered = <TimelineView entries={content} />;
      break;
    case 'market':
      rendered = <MarketView entries={content} rawText={contentRawText} />;
      break;
    case 'nlp':
      rendered = <NlpView entries={content} rawText={contentRawText} />;
      break;
    case 'community':
      rendered = <CommunityView entries={content} rawText={contentRawText} />;
      break;
    case 'business':
      rendered = <BusinessView entries={content} />;
      break;
    default:
      rendered = <GenericAdvancedView entries={content} />;
  }

  return (
    <OutputFrame
      variant={presentation.variant}
      label={presentation.label}
      icon={presentation.icon}
      contextEntries={context}
    >
      {rendered}
    </OutputFrame>
  );
}

export function WorkspaceSectionArtwork({ section, index = 0, label = 'Idea signal' }) {
  const presentation = getAdvancedOutputPresentation(section);
  const Icon = section?.icon || presentation.icon || FileText;
  const isAdvanced = Boolean(section?.isAdvanced || Number(index) >= 4);
  const variant = isAdvanced ? presentation.variant : ['mint', 'rose', 'sky', 'pearl'][index % 4];

  return (
    <div
      className={`workspace-section-art workspace-section-art--${variant}`}
      aria-hidden="true"
    >
      <span className="workspace-section-art__grid" />
      <span className="workspace-section-art__orbit workspace-section-art__orbit--one" />
      <span className="workspace-section-art__orbit workspace-section-art__orbit--two" />
      <span className="workspace-section-art__line workspace-section-art__line--one" />
      <span className="workspace-section-art__line workspace-section-art__line--two" />

      <span className="workspace-section-art__node workspace-section-art__node--a">
        {isAdvanced ? <Icon size={13} /> : <Sparkles size={13} />}
      </span>
      <span className="workspace-section-art__node workspace-section-art__node--b">
        <CheckCircle2 size={13} />
      </span>
      <span className="workspace-section-art__node workspace-section-art__node--c">
        {isAdvanced ? <Sparkles size={13} /> : <Rocket size={13} />}
      </span>

      <span className="workspace-section-art__core">
        <Icon size={28} />
      </span>

      <span className="workspace-section-art__label">
        {isAdvanced ? <Icon size={11} /> : <Sparkles size={11} />}
        {isAdvanced ? presentation.label : label}
      </span>
    </div>
  );
}
