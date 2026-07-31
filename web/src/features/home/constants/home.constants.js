/**
 * Static content used across the Nexora home page.
 *
 * Centralizing home page content keeps presentation components focused
 * on rendering and makes future content updates easier to maintain.
 *
 * @author Eman
 */

export const HERO_CONTENT = {
    badge: 'Intelligent project discovery',

    titlePrefix: 'Discover ideas hidden inside',

    highlightedTitle: 'real-world problems.',

    description:
        'Nexora listens to real communities, analyzes their challenges, and transforms repeated needs into meaningful software project ideas.',

    primaryActionLabel: 'Generate an Idea',

    secondaryActionLabel: 'Explore Ideas',
};

export const HERO_HIGHLIGHTS = [
    {
        id: 'real-feedback',
        title: 'Real',
        description: 'Community feedback',
    },
    {
        id: 'smart-analysis',
        title: 'Smart',
        description: 'Multi-model analysis',
    },
    {
        id: 'local-opportunities',
        title: 'Local',
        description: 'Relevant opportunities',
    },
];

export const HERO_PROCESS_CONTENT = {
    eyebrow: 'Nexora Intelligence',

    title: 'From conversations to solutions',

    steps: [
        {
            id: 'community-needs',
            title: 'Community needs',
            description:
                'Students repeatedly report difficulty finding accessible, locally relevant learning support.',
            icon: 'users',
            variant: 'neutral',
        },
        {
            id: 'ai-analysis',
            title: 'AI analysis',
            description:
                'Repeated themes are analyzed, ranked, and compared across several AI models.',
            icon: 'database',
            variant: 'primary',
        },
        {
            id: 'project-idea',
            title: 'Meaningful project idea',
            description:
                'An adaptive learning companion designed around verified student challenges.',
            icon: 'lightbulb',
            variant: 'gradient',
        },
    ],
};