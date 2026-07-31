/**
 * Centralized content configuration for the Nexora public landing page.
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
    badge: 'AI-powered project discovery',
    titlePrefix: 'Turn real community needs into',
    highlightedTitle: 'software worth building.',
    description:
        'Nexora AI listens across digital communities, detects repeated challenges, and transforms them into practical, evidence-driven software project ideas.',
    primaryActionLabel: 'Explore the Process',
    secondaryActionLabel: 'Contact Us',
};

/**
 * Key Nexora platform highlights displayed below the hero actions.
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
        id: 'sources',
        title: '12+',
        description: 'Community sources',
    },
    {
        id: 'models',
        title: 'Multi-AI',
        description: 'Idea comparison',
    },
    {
        id: 'local',
        title: 'Local-first',
        description: 'Relevant solutions',
    },
];

/**
 * Content used by the visual process card inside the hero section.
 *
 * The steps describe how Nexora transforms public conversations into
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
    eyebrow: 'Nexora Intelligence',
    title: 'A signal becomes a solution',

    steps: [
        {
            id: 'community-needs',
            title: 'Real conversations',
            description:
                'Public feedback reveals repeated frustrations, unmet needs, and emerging opportunities.',
            icon: 'users',
            variant: 'neutral',
        },
        {
            id: 'ai-analysis',
            title: 'Evidence-based analysis',
            description:
                'NLP and multiple AI models rank themes, compare candidates, and reduce weak ideas.',
            icon: 'database',
            variant: 'primary',
        },
        {
            id: 'project-idea',
            title: 'Build-ready direction',
            description:
                'The strongest opportunity becomes a structured software idea with clear users and value.',
            icon: 'lightbulb',
            variant: 'gradient',
        },
    ],
};

/**
 * Workflow stages displayed in the "How Nexora Works" section.
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
            'Nexora gathers public conversations from relevant digital platforms and community spaces.',
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
 * Main content displayed in the About Nexora section.
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
    eyebrow: 'About Nexora',
    titlePrefix: 'Ideas should begin with',
    highlightedTitle: 'real human needs.',
    description:
        'Nexora AI is an intelligent software-project discovery platform that turns public community feedback into structured and meaningful project opportunities.',
    secondaryDescription:
        'Instead of generating ideas from isolated prompts, Nexora studies repeated challenges, analyzes evidence, compares multiple AI candidates, and selects directions that are practical, relevant, and worth exploring.',
    missionLabel: 'Our mission',
    mission:
        'Help students, developers, and innovators build software that responds to genuine problems rather than assumptions.',
};

/**
 * Key platform differentiators displayed in the About Nexora section.
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
 * public idea records retrieved from the Nexora backend.
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