/**
 * Centralized content configuration for the Voxidence public landing page.
 *
 * This file stores the textual content and presentation metadata used by
 * the home-page sections. Keeping this data outside the React components
 * improves maintainability, reduces duplicated content, and allows future
 * localization or content updates without changing component logic.
 *
 * @author Eman
 */

/**
 * Main content displayed in the landing-page hero section.
 *
 * @type {{
 *     badge: string,
 *     titlePrefix: string,
 *     highlightedTitle: string,
 *     description: string,
 *     primaryActionLabel: string,
 *     secondaryActionLabel: string
 * }}
 */
export const HERO_CONTENT = {
    badge: 'Community voices, verified into direction',
    titlePrefix: 'Hear what communities need.',
    highlightedTitle: 'Build what truly matters.',
    description:
        'Voxidence listens across real public conversations, reveals the needs that keep resurfacing, and transforms verified evidence into focused software opportunities ready to explore.',
    primaryActionLabel: 'Explore the Process',
    secondaryActionLabel: 'Discover Ideas',
    trustPoints: [
        'Real community evidence',
        'Multi-model comparison',
        'Locally relevant outcomes',
    ],
};

/**
 * Key Voxidence platform highlights displayed below the hero actions.
 *
 * Each item contains a stable identifier, a short highlighted value,
 * and a supporting description.
 *
 * @type {Array<{
 *     id: string,
 *     title: string,
 *     description: string
 * }>}
 */
export const HERO_HIGHLIGHTS = [
    {
        id: 'signals',
        title: 'Real signals',
        description: 'Community evidence first',
    },
    {
        id: 'models',
        title: 'Multi-model',
        description: 'Stronger AI comparison',
    },
    {
        id: 'outcomes',
        title: 'Build-ready',
        description: 'Clear project direction',
    },
];

/**
 * Content used by the visual process card inside the hero section.
 *
 * The steps describe how Voxidence transforms public conversations into
 * structured and actionable software-project directions.
 *
 * The icon and variant values are resolved by HeroProcessCard.
 *
 * @type {{
 *     eyebrow: string,
 *     title: string,
 *     steps: Array<{
 *         id: string,
 *         title: string,
 *         description: string,
 *         icon: string,
 *         variant: string
 *     }>
 * }}
 */
export const HERO_PROCESS_CONTENT = {
    eyebrow: 'Voxidence Intelligence',
    title: 'From scattered voices to one clear direction',
    steps: [
        {
            id: 'community-needs',
            title: 'Community signals',
            description: 'Repeated conversations expose real frustrations, gaps, and unmet needs.',
            icon: 'users',
            variant: 'neutral',
        },
        {
            id: 'evidence-extraction',
            title: 'Evidence extraction',
            description: 'NLP organizes patterns, urgency, context, and supporting evidence.',
            icon: 'database',
            variant: 'primary',
        },
        {
            id: 'comparative-judge',
            title: 'Comparative AI judge',
            description: 'Multiple candidates are generated, scored, and compared for strength.',
            icon: 'judge',
            variant: 'rose',
        },
        {
            id: 'project-idea',
            title: 'Build-ready opportunity',
            description: 'The strongest direction becomes a structured, evidence-backed project idea.',
            icon: 'lightbulb',
            variant: 'gradient',
        },
    ],
};

/**
 * Workflow stages displayed in the "How Voxidence Works" section.
 *
 * Each step contains a visible sequence number, title, description,
 * and an icon key resolved by HowItWorksSection.
 *
 * @type {Array<{
 *     number: string,
 *     title: string,
 *     description: string,
 *     icon: string
 * }>}
 */
export const HOW_IT_WORKS_STEPS = [
    {
        number: '01',
        title: 'Listen to communities',
        description:
            'Voxidence gathers relevant public conversations from trusted digital communities and open platforms.',
        icon: 'radar',
    },
    {
        number: '02',
        title: 'Discover hidden patterns',
        description:
            'NLP detects repeated needs, urgency, evidence strength, and locally relevant opportunities.',
        icon: 'scan',
    },
    {
        number: '03',
        title: 'Generate and compare',
        description:
            'Several AI models propose solutions, then a comparative judge selects the strongest candidate.',
        icon: 'brain',
    },
    {
        number: '04',
        title: 'Shape a real project',
        description:
            'The final idea is organized into a clear problem, objectives, target users, and implementation direction.',
        icon: 'rocket',
    },
];

/**
 * Main content displayed in the About Voxidence section.
 *
 * @type {{
 *     eyebrow: string,
 *     titlePrefix: string,
 *     highlightedTitle: string,
 *     description: string,
 *     secondaryDescription: string,
 *     missionLabel: string,
 *     mission: string
 * }}
 */
export const ABOUT_NEXORA_CONTENT = {
    eyebrow: 'Why Voxidence',
    titlePrefix: 'Ideas should begin with',
    highlightedTitle: 'real human needs.',
    description:
        'Voxidence is an evidence-intelligence platform that transforms real community voices into structured software opportunities with purpose, context, and measurable relevance.',
    secondaryDescription:
        'Rather than guessing from a blank prompt, Voxidence listens first. It identifies repeated challenges, evaluates the evidence, compares multiple AI-generated directions, and surfaces the opportunities most worth building.',
    missionLabel: 'Our mission',
    mission:
        'Help students, developers, and innovators build software that responds to genuine problems rather than assumptions.',
};

/**
 * Key platform differentiators displayed in the About Voxidence section.
 *
 * The offset property controls the staggered vertical card layout on
 * supported screen sizes without relying on each item's array position.
 *
 * @type {Array<{
 *     id: string,
 *     title: string,
 *     description: string,
 *     icon: string,
 *     offset: boolean
 * }>}
 */
export const ABOUT_NEXORA_FEATURES = [
    {
        id: 'public-evidence',
        title: 'Evidence before ideas',
        description:
            'Project opportunities are discovered from repeated public conversations and community feedback.',
        icon: 'evidence',
        offset: false,
    },
    {
        id: 'comparative-intelligence',
        title: 'Comparative AI intelligence',
        description:
            'Multiple AI models generate and evaluate candidates instead of relying on a single response.',
        icon: 'intelligence',
        offset: true,
    },
    {
        id: 'local-relevance',
        title: 'Locally relevant outcomes',
        description:
            'Country, region, audience, and community context help shape more meaningful solutions.',
        icon: 'relevance',
        offset: false,
    },
    {
        id: 'structured-results',
        title: 'Structured and trustworthy',
        description:
            'Ideas are validated and organized into clear problems, objectives, users, and implementation directions.',
        icon: 'trust',
        offset: true,
    },
];

/**
 * Opportunity domains displayed in the landing-page domains section.
 *
 * The icon value is a stable key mapped to a Lucide icon component
 * inside DomainsSection.
 *
 * @type {Array<{
 *     id: string,
 *     title: string,
 *     label: string,
 *     icon: string
 * }>}
 */
export const DOMAIN_ITEMS = [
    {
        id: 'education',
        title: 'Education',
        label: 'Smarter learning experiences',
        icon: 'graduation',
    },
    {
        id: 'health',
        title: 'Health',
        label: 'Accessible digital care',
        icon: 'heart',
    },
    {
        id: 'business',
        title: 'Business',
        label: 'Better everyday operations',
        icon: 'briefcase',
    },
    {
        id: 'environment',
        title: 'Environment',
        label: 'Sustainable local solutions',
        icon: 'leaf',
    },
    {
        id: 'community',
        title: 'Community',
        label: 'Services people actually need',
        icon: 'users',
    },
    {
        id: 'technology',
        title: 'Technology',
        label: 'Tools for emerging challenges',
        icon: 'cpu',
    },
];

/**
 * Featured software ideas displayed on the public landing page.
 *
 * These records are presentation examples and can later be replaced by
 * public idea records retrieved from the Voxidence backend.
 *
 * @type {Array<{
 *     id: string,
 *     title: string,
 *     domain: string,
 *     location: string,
 *     problem: string,
 *     solution: string,
 *     icon: string,
 *     variant: string
 * }>}
 */
export const FEATURED_IDEAS = [
    {
        id: 'student-support-navigator',
        title: 'Student Support Navigator',
        domain: 'Education',
        location: 'Nablus, Palestine',
        problem:
            'University students often struggle to discover the right academic and administrative support at the moment they need it.',
        solution:
            'A personalized platform that guides students toward relevant services, deadlines, and campus resources.',
        icon: 'education',
        variant: 'lavender',
    },
    {
        id: 'community-care-access',
        title: 'Community Care Access',
        domain: 'Health',
        location: 'Local communities',
        problem:
            'People frequently lack a clear way to find suitable nearby healthcare and community-support services.',
        solution:
            'A location-aware service directory that recommends accessible care options based on user needs.',
        icon: 'health',
        variant: 'sky',
    },
    {
        id: 'small-business-flow',
        title: 'Small Business Flow',
        domain: 'Business',
        location: 'Palestine',
        problem:
            'Small businesses manage daily requests, inventory, and customer communication through disconnected manual tools.',
        solution:
            'A lightweight operations platform that brings orders, customer communication, and stock tracking together.',
        icon: 'business',
        variant: 'pink',
    },
];

/**
 * Main platform benefits displayed in the final call-to-action section.
 *
 * @type {string[]}
 */
export const VALUE_POINTS = [
    'Built from public evidence, not random prompts',
    'Evaluated by more than one AI model',
    'Designed around local context and real users',
];