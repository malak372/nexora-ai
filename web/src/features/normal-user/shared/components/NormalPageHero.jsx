import {
  BarChart3,
  Bell,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Coins,
  Compass,
  CreditCard,
  Crown,
  Database,
  FileText,
  Globe2,
  Heart,
  KeyRound,
  Layers3,
  Lightbulb,
  MapPin,
  MessageSquareText,
  Mic,
  ReceiptText,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  WandSparkles,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

import { useUserExperience } from '../../../../system/user-experience';
import './normal-page-hero.css';

const HERO_ART = {
  dashboard: {
    primary: BrainCircuit,
    nodes: [Search, Database, Sparkles],
    label: 'LIVE SIGNAL MAP',
  },
  generate: {
    primary: WandSparkles,
    nodes: [Mic, Layers3, MapPin],
    label: 'DISCOVERY STUDIO',
  },
  ideas: {
    primary: Lightbulb,
    nodes: [Layers3, Heart, CheckCircle2],
    label: 'IDEA LIBRARY',
  },
  discover: {
    primary: Compass,
    nodes: [Search, UsersRound, Globe2],
    label: 'COMMUNITY RADAR',
  },
  published: {
    primary: Send,
    nodes: [UsersRound, Heart, BarChart3],
    label: 'PUBLISHING SIGNAL',
  },
  compliance: {
    primary: ShieldCheck,
    nodes: [MessageSquareText, CheckCircle2, FileText],
    label: 'TRUST CHANNEL',
  },
  credits: {
    primary: Crown,
    nodes: [Coins, Sparkles, Rocket],
    label: 'PREMIUM CAPACITY',
  },
  preferences: {
    primary: SlidersHorizontal,
    nodes: [Globe2, MapPin, WandSparkles],
    label: 'PERSONALIZATION MAP',
  },
  notifications: {
    primary: Bell,
    nodes: [MessageSquareText, CheckCircle2, Sparkles],
    label: 'ACTIVITY PULSE',
  },
  billing: {
    primary: ReceiptText,
    nodes: [CreditCard, ShieldCheck, FileText],
    label: 'VERIFIED LEDGER',
  },
  profile: {
    primary: UserRound,
    nodes: [Camera, ShieldCheck, KeyRound],
    label: 'IDENTITY LAYER',
  },
  chat: {
    primary: BrainCircuit,
    nodes: [MessageSquareText, Sparkles, Lightbulb],
    label: 'CONTEXTUAL AI',
  },
};

function HeroArtwork({ variant, stats = [] }) {
  const { t } = useUserExperience();
  const reduceMotion = useReducedMotion();
  const art = HERO_ART[variant] || HERO_ART.dashboard;
  const PrimaryIcon = art.primary;
  const [NodeOne, NodeTwo, NodeThree] = art.nodes;
  const visibleStats = stats.slice(0, 2);

  return (
    <div
      className={`normal-page-hero__artboard normal-page-hero__artboard--${variant} normal-page-hero__artboard--stats-${visibleStats.length}`}
      aria-hidden="true"
    >
      <span className="normal-page-hero__art-grid" />

      <div className="normal-page-hero__scene">
        <span className="normal-page-hero__motif normal-page-hero__motif--one" />
        <span className="normal-page-hero__motif normal-page-hero__motif--two" />
        <span className="normal-page-hero__motif normal-page-hero__motif--three" />
        <span className="normal-page-hero__motif normal-page-hero__motif--four" />
        <span className="normal-page-hero__path normal-page-hero__path--one" />
        <span className="normal-page-hero__path normal-page-hero__path--two" />
        <span className="normal-page-hero__orbit normal-page-hero__orbit--one" />
        <span className="normal-page-hero__orbit normal-page-hero__orbit--two" />
        <span className="normal-page-hero__spark normal-page-hero__spark--one" />
        <span className="normal-page-hero__spark normal-page-hero__spark--two" />
        <span className="normal-page-hero__spark normal-page-hero__spark--three" />
        <span className="normal-page-hero__halo normal-page-hero__halo--one" />
        <span className="normal-page-hero__halo normal-page-hero__halo--two" />
        <span className="normal-page-hero__glass normal-page-hero__glass--one">
          <i /><i /><i />
        </span>
        <span className="normal-page-hero__glass normal-page-hero__glass--two">
          <i /><i />
        </span>
        <span className="normal-page-hero__signal">
          <i /><i /><i /><i /><i />
        </span>

        <motion.span
          className="normal-page-hero__art-core"
          animate={reduceMotion ? undefined : { y: [0, -5, 0], rotate: [0, 1.15, -1.15, 0] }}
          transition={reduceMotion ? undefined : { duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <PrimaryIcon size={36} strokeWidth={1.75} />
        </motion.span>

        <motion.span
          className="normal-page-hero__art-node normal-page-hero__art-node--one"
          animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
          transition={reduceMotion ? undefined : { duration: 4.1, repeat: Infinity, ease: 'easeInOut' }}
        >
          <NodeOne size={18} />
        </motion.span>
        <motion.span
          className="normal-page-hero__art-node normal-page-hero__art-node--two"
          animate={reduceMotion ? undefined : { y: [0, 5, 0] }}
          transition={reduceMotion ? undefined : { duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
        >
          <NodeTwo size={18} />
        </motion.span>
        <motion.span
          className="normal-page-hero__art-node normal-page-hero__art-node--three"
          animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
          transition={reduceMotion ? undefined : { duration: 3.9, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
        >
          <NodeThree size={17} />
        </motion.span>
      </div>

      <div className="normal-page-hero__art-caption">
        <i />
        <span dir="auto">{t(art.label)}</span>
      </div>

      {visibleStats.map((stat, index) => (
        <div
          className={`normal-page-hero__art-stat normal-page-hero__art-stat--${index + 1}`}
          key={`${stat.label}-${index}`}
        >
          <small dir="auto">{stat.label}</small>
          <strong dir="auto">{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

export default function NormalPageHero({
  variant = 'dashboard',
  eyebrow,
  title,
  description,
  chips = [],
  stats = [],
  actions = null,
  footnote = null,
  compact = false,
  className = '',
}) {
  const { isArabic } = useUserExperience();
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      className={`normal-page-hero normal-page-hero--${variant} ${isArabic ? 'is-rtl' : 'is-ltr'} ${compact ? 'is-compact' : ''} ${className}`.trim()}
      initial={reduceMotion ? undefined : { opacity: 0, y: 18, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="normal-page-hero__ambient normal-page-hero__ambient--accent" aria-hidden="true" />
      <span className="normal-page-hero__ambient normal-page-hero__ambient--secondary" aria-hidden="true" />
      <span className="normal-page-hero__mesh" aria-hidden="true" />

      <div className="normal-page-hero__copy">
        {eyebrow ? (
          <span className="normal-page-hero__eyebrow">
            <Sparkles size={14} />
            {eyebrow}
          </span>
        ) : null}

        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}

        {chips.length ? (
          <div className="normal-page-hero__chips">
            {chips.map((chip) => (
              <span key={typeof chip === 'string' ? chip : chip.label}>
                {typeof chip === 'string' ? <CheckCircle2 size={14} /> : chip.icon || <CheckCircle2 size={14} />}
                {typeof chip === 'string' ? chip : chip.label}
              </span>
            ))}
          </div>
        ) : null}

        {actions ? <div className="normal-page-hero__actions">{actions}</div> : null}
        {footnote ? <div className="normal-page-hero__footnote">{footnote}</div> : null}
      </div>

      <div className="normal-page-hero__visual">
        <HeroArtwork variant={variant} stats={stats} />
      </div>
    </motion.section>
  );
}
