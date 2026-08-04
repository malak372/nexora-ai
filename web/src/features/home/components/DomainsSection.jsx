/**
 * Renders the public domains discovery section on the Voxidence landing page.
 *
 * The section retrieves the available domains from the backend and presents
 * them in a responsive grid. Static landing-page domains are used as a
 * graceful fallback when the request fails or returns no valid records.
 *
 * The component provides dedicated loading, empty, and error-aware states
 * without preventing the rest of the public landing page from rendering.
 *
 * @component
 * @returns {JSX.Element} The domains discovery section.
 *
 * @author Eman
 */

import { useState } from 'react';

import {
    Banknote,
    BriefcaseBusiness,
    ChevronDown,
    ChevronUp,
    CircleHelp,
    Cpu,
    Factory,
    GraduationCap,
    HeartPulse,
    Landmark,
    Layers3,
    Leaf,
    Plane,
    ShoppingCart,
    Sprout,
    Truck,
    UserSearch,
    UsersRound,
    UtensilsCrossed,
    Wifi,
    Zap,
} from 'lucide-react';

import { useDomains } from '../../domains/hooks/useDomains';

/**
 * Maps domain icon identifiers to Lucide React icon components.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const DOMAIN_ICONS = {
    agriculture: Sprout,
    business: BriefcaseBusiness,
    commerce: ShoppingCart,
    community: UsersRound,
    cpu: Cpu,
    education: GraduationCap,
    energy: Zap,
    environment: Leaf,
    finance: Banknote,
    food: UtensilsCrossed,
    government: Landmark,
    graduation: GraduationCap,
    health: HeartPulse,
    hr: UserSearch,
    industry: Factory,
    internet: Wifi,
    iot: Wifi,
    leaf: Leaf,
    logistics: Truck,
    recruitment: UserSearch,
    retail: ShoppingCart,
    technology: Cpu,
    tourism: Plane,
    transport: Truck,
    users: UsersRound,
};

/**
 * Number of database domains shown before the Explore More card.
 *
 * The sixth grid position is reserved for the expansion control whenever
 * additional database domains are available.
 *
 * @type {number}
 */
const INITIAL_VISIBLE_DOMAINS = 5;

/**
 * Converts a value to a trimmed string.
 *
 * @param {unknown} value - Value to normalize.
 * @returns {string} A safe trimmed string.
 */
function toSafeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Creates a URL-friendly identifier from a domain name.
 *
 * @param {string} value - Domain name.
 * @returns {string} A stable normalized identifier.
 */
function createDomainId(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Resolves a supported icon key from a backend domain record.
 *
 * @param {Object} domain - Raw domain record.
 * @param {string} title - Normalized domain title.
 * @returns {string} A supported domain icon key.
 */
function resolveDomainIconKey(domain, title) {
    const configuredIcon = toSafeString(
        domain.icon || domain.iconKey || domain.slug,
    ).toLowerCase();

    if (DOMAIN_ICONS[configuredIcon]) {
        return configuredIcon;
    }

    const searchableValue = `${configuredIcon} ${title}`
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const iconRules = [
        { keywords: ['education', 'learning', 'school', 'university'], icon: 'education' },
        { keywords: ['health', 'healthcare', 'medical', 'medicine'], icon: 'health' },
        { keywords: ['energy', 'electricity', 'power', 'renewable'], icon: 'energy' },
        { keywords: ['environment', 'climate', 'sustainability', 'green'], icon: 'environment' },
        { keywords: ['finance', 'financial', 'fintech', 'banking', 'insurance'], icon: 'finance' },
        { keywords: ['food', 'restaurant', 'restaurants', 'hospitality'], icon: 'food' },
        { keywords: ['government', 'public sector', 'civic', 'municipality'], icon: 'government' },
        { keywords: ['human resources', 'hr', 'recruitment', 'hiring', 'jobs'], icon: 'recruitment' },
        { keywords: ['internet of things', 'iot', 'smart devices', 'connected devices'], icon: 'iot' },
        { keywords: ['agriculture', 'farming', 'agritech'], icon: 'agriculture' },
        { keywords: ['retail', 'ecommerce', 'e commerce', 'shopping'], icon: 'retail' },
        { keywords: ['logistics', 'delivery', 'shipping', 'supply chain'], icon: 'logistics' },
        { keywords: ['transport', 'transportation', 'mobility'], icon: 'transport' },
        { keywords: ['tourism', 'travel'], icon: 'tourism' },
        { keywords: ['industry', 'manufacturing', 'factory'], icon: 'industry' },
        { keywords: ['technology', 'software', 'artificial intelligence', 'ai'], icon: 'technology' },
        { keywords: ['business', 'enterprise', 'startup'], icon: 'business' },
        { keywords: ['community', 'social'], icon: 'community' },
    ];

    const matchingRule = iconRules.find(({ keywords }) =>
        keywords.some((keyword) => searchableValue.includes(keyword)),
    );

    return matchingRule?.icon || 'generic';
}

/**
 * Normalizes a backend domain record into the structure required by the UI.
 *
 * Several possible field names are supported to keep the public component
 * resilient to minor differences in API response naming.
 *
 * @param {Object} domain - Raw backend domain record.
 * @param {number} index - Domain position in the response.
 * @returns {{
 *     id: string,
 *     title: string,
 *     label: string,
 *     icon: string
 * } | null} A normalized domain or null when the record is invalid.
 */
function normalizeDomain(domain, index) {
    if (!domain || typeof domain !== 'object') {
        return null;
    }

    const title = toSafeString(
        domain.title ||
        domain.name ||
        domain.displayName ||
        domain.label,
    );

    if (!title) {
        return null;
    }

    const label =
        toSafeString(
            domain.description ||
            domain.shortDescription ||
            domain.summary ||
            domain.subtitle,
        ) || 'Discover software opportunities in this domain.';

    const rawId =
        toSafeString(domain.id) ||
        toSafeString(domain.key) ||
        toSafeString(domain.slug);

    return {
        id: rawId || createDomainId(title) || `domain-${index}`,
        title,
        label,
        icon: resolveDomainIconKey(domain, title),
    };
}

/**
 * Normalizes and limits the domains returned by the backend.
 *
 * @param {Array<Object>} domains - Raw backend domain records.
 * @returns {Array<{
 *     id: string,
 *     title: string,
 *     label: string,
 *     icon: string
 * }>} Domains ready for presentation.
 */
function normalizeDomains(domains) {
    if (!Array.isArray(domains)) {
        return [];
    }

    return domains
        .map(normalizeDomain)
        .filter(Boolean);
}

/**
 * Resolves the icon component for a normalized domain.
 *
 * @param {string} iconKey - Domain icon identifier.
 * @returns {import('lucide-react').LucideIcon} The resolved icon component.
 */
function getDomainIcon(iconKey) {
    return DOMAIN_ICONS[iconKey] || Layers3;
}

/**
 * Displays one domain card.
 *
 * @param {Object} props - Component properties.
 * @param {{
 *     id: string,
 *     title: string,
 *     label: string,
 *     icon: string
 * }} props.domain - Domain presentation data.
 *
 * @returns {JSX.Element} A single domain card.
 */
function DomainCard({ domain }) {
    const Icon = getDomainIcon(domain.icon);

    return (
        <article className="vox-domain-card group">
            <div
                className="vox-domain-card__line"
                aria-hidden="true"
            />

            <span className="vox-domain-card__icon">
                <Icon
                    size={20}
                    aria-hidden="true"
                />
            </span>

            <div className="vox-domain-card__copy">
                <h3 className="vox-domain-card__title">
                    {domain.title}
                </h3>

                <p className="vox-domain-card__description">
                    {domain.label}
                </p>
            </div>
        </article>
    );
}

/**
 * Displays a loading placeholder matching the domain-card layout.
 *
 * @param {Object} props - Component properties.
 * @param {number} props.index - Skeleton position.
 * @returns {JSX.Element} A domain loading skeleton.
 */
function DomainSkeleton({ index }) {
    return (
        <div
            className="vox-domain-card vox-domain-card--skeleton animate-pulse"
            aria-hidden="true"
            key={index}
        >
            <div className="h-11 w-11 rounded-xl bg-[#e8f4f2]" />
            <div className="mt-5 h-4 w-2/3 rounded-full bg-[#e4efec]" />
            <div className="mt-3 h-3 w-full rounded-full bg-[#eef7f5]" />
            <div className="mt-2 h-3 w-4/5 rounded-full bg-[#eef7f5]" />
        </div>
    );
}

/**
 * Displays the supported Voxidence opportunity domains in a responsive grid.
 *
 * Backend data is preferred when available. Static values are retained as a
 * graceful fallback so that the public landing page remains visually complete
 * when the API is temporarily unavailable.
 *
 * @returns {JSX.Element}
 */
export default function DomainsSection() {
    const [isExpanded, setIsExpanded] = useState(false);

    const {
        data: availableDomains = [],
        isLoading,
        isError,
    } = useDomains();

    const normalizedDomains = normalizeDomains(availableDomains);

    const initialDomains = normalizedDomains.slice(
        0,
        INITIAL_VISIBLE_DOMAINS,
    );

    const remainingDomains = normalizedDomains.slice(
        INITIAL_VISIBLE_DOMAINS,
    );

    const hasMoreDomains = remainingDomains.length > 0;

    /**
     * Expands or collapses the remaining domains returned by the backend.
     *
     * @returns {void}
     */
    function toggleExpandedDomains() {
        setIsExpanded((currentValue) => !currentValue);
    }

    return (
        <section
            id="domains"
            className="vox-domains-section scroll-mt-24"
            aria-labelledby="domains-heading"
            aria-busy={isLoading}
        >
            <div className="vox-domains-container">
                <div className="vox-domains-header">
                    <div className="vox-domains-heading">
                        <div className="vox-domains-kicker-row">
                            <p className="vox-domains-eyebrow">Explore opportunities</p>

                            {!isLoading && !isError && normalizedDomains.length > 0 && (
                                <span className="vox-domains-count" aria-label={`${normalizedDomains.length} domains available`}>
                                    <strong>{normalizedDomains.length}</strong>
                                    <span>live domains</span>
                                </span>
                            )}
                        </div>

                        <div className="vox-domains-title-row">
                            <h2 id="domains-heading" className="vox-domains-title">
                                Explore the domains where community needs become software opportunities.
                            </h2>
                        </div>

                        <p className="vox-domains-intro">
                            Choose a focus area to see where real community evidence can
                            lead to a meaningful, locally relevant software direction.
                        </p>
                    </div>
                </div>

                {isError && (
                    <p className="vox-domains-error" role="alert">
                        Domains could not be loaded from the server. Please try again shortly.
                    </p>
                )}

                <div className="vox-domains-content">
                    {isLoading && (
                        <div className="vox-domains-grid">
                            {Array.from({ length: 6 }, (_, index) => (
                                <DomainSkeleton
                                    key={`domain-skeleton-${index}`}
                                    index={index}
                                />
                            ))}
                        </div>
                    )}

                    {!isLoading && !isError && normalizedDomains.length === 0 && (
                        <div className="vox-domains-empty">
                            <CircleHelp size={30} aria-hidden="true" />
                            <h3>No domains are available yet</h3>
                            <p>
                                New opportunity domains will appear here as soon as
                                they are enabled in Voxidence.
                            </p>
                        </div>
                    )}

                    {!isLoading && !isError && normalizedDomains.length > 0 && (
                        <>
                            <div className="vox-domains-grid">
                                {initialDomains.map((domain) => (
                                    <DomainCard key={domain.id} domain={domain} />
                                ))}

                                {hasMoreDomains && (
                                    <ExploreMoreCard
                                        remainingCount={remainingDomains.length}
                                        isExpanded={isExpanded}
                                        onClick={toggleExpandedDomains}
                                    />
                                )}
                            </div>

                            {hasMoreDomains && isExpanded && (
                                <div id="additional-domains" className="vox-domains-more">
                                    <div className="vox-domains-more__header">
                                        <div>
                                            <p>More Voxidence domains</p>
                                            <span>Additional live domains from the database</span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={toggleExpandedDomains}
                                            className="vox-domains-collapse"
                                            aria-expanded="true"
                                            aria-controls="additional-domains"
                                        >
                                            Show less
                                            <ChevronUp size={17} aria-hidden="true" />
                                        </button>
                                    </div>

                                    <div className="vox-domains-grid">
                                        {remainingDomains.map((domain) => (
                                            <DomainCard key={domain.id} domain={domain} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}

/**
 * Displays the sixth-grid-position control for revealing more domains.
 *
 * @param {Object} props - Component properties.
 * @param {number} props.remainingCount - Number of hidden domains.
 * @param {boolean} props.isExpanded - Whether hidden domains are visible.
 * @param {() => void} props.onClick - Expansion callback.
 * @returns {JSX.Element} The Explore More card.
 */
function ExploreMoreCard({
    remainingCount,
    isExpanded,
    onClick,
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="vox-domain-card vox-domain-card--more group"
            aria-expanded={isExpanded}
            aria-controls="additional-domains"
        >
            <div
                className="vox-domain-card__line"
                aria-hidden="true"
            />

            <span className="vox-domain-card__icon vox-domain-card__icon--more">
                <Layers3
                    size={20}
                    aria-hidden="true"
                />
            </span>

            <div className="vox-domain-card__copy">
                <h3 className="vox-domain-card__title">
                    {isExpanded ? 'Hide More' : 'Explore More'}
                </h3>

                <p className="vox-domain-card__description">
                    {remainingCount} additional domain
                    {remainingCount === 1 ? '' : 's'} available
                </p>
            </div>

            <span className="vox-domain-card__action">
                {isExpanded ? 'Show less' : 'View all domains'}

                {isExpanded ? (
                    <ChevronUp
                        size={17}
                        aria-hidden="true"
                    />
                ) : (
                    <ChevronDown
                        size={17}
                        aria-hidden="true"
                    />
                )}
            </span>
        </button>
    );
}