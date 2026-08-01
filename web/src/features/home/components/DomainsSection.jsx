/**
 * Renders the public domains discovery section on the Nexora landing page.
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
    BriefcaseBusiness,
    ChevronDown,
    ChevronUp,
    CircleHelp,
    Cpu,
    GraduationCap,
    HeartPulse,
    Layers3,
    Leaf,
    UsersRound,
} from 'lucide-react';

import { useDomains } from '../../domains/hooks/useDomains';

/**
 * Maps domain icon identifiers to Lucide React icon components.
 *
 * @type {Object.<string, import('lucide-react').LucideIcon>}
 */
const DOMAIN_ICONS = {
    graduation: GraduationCap,
    education: GraduationCap,
    heart: HeartPulse,
    health: HeartPulse,
    briefcase: BriefcaseBusiness,
    business: BriefcaseBusiness,
    leaf: Leaf,
    environment: Leaf,
    users: UsersRound,
    community: UsersRound,
    cpu: Cpu,
    technology: Cpu,
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

    const normalizedTitle = title.toLowerCase();

    const matchingIconKey = Object.keys(DOMAIN_ICONS).find((key) =>
        normalizedTitle.includes(key),
    );

    return matchingIconKey || 'unknown';
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
    return DOMAIN_ICONS[iconKey] || CircleHelp;
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
        <article className="domain-card group relative min-h-[190px] overflow-hidden rounded-[1.35rem] border border-white/90 bg-white/72 p-5 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:bg-white/88 hover:shadow-[0_20px_45px_rgba(96,73,134,0.12)]">
            <div
                className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#8d70d7]/45 to-transparent"
                aria-hidden="true"
            />

            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#eee6ff] to-[#e2f3ff] text-[#7556c1] shadow-[0_8px_18px_rgba(117,86,193,0.08)] transition duration-300 group-hover:scale-110">
                <Icon
                    size={22}
                    aria-hidden="true"
                />
            </span>

            <h3 className="mt-5 font-extrabold text-[#302642]">
                {domain.title}
            </h3>

            <p className="mt-1 text-sm leading-6 text-[#777083]">
                {domain.label}
            </p>
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
            className="domain-card animate-pulse rounded-2xl border border-white/90 bg-white/55 p-5"
            aria-hidden="true"
            key={index}
        >
            <div className="h-11 w-11 rounded-xl bg-[#eae3f5]" />
            <div className="mt-5 h-4 w-2/3 rounded-full bg-[#e8e1f2]" />
            <div className="mt-3 h-3 w-full rounded-full bg-[#eee9f5]" />
            <div className="mt-2 h-3 w-4/5 rounded-full bg-[#eee9f5]" />
        </div>
    );
}

/**
 * Displays the supported Nexora opportunity domains in a responsive grid.
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
            className="scroll-mt-24 py-24 sm:py-28"
            aria-labelledby="domains-heading"
            aria-busy={isLoading}
        >
            <div className="nexora-container">
                <div className="domains-panel relative overflow-hidden rounded-[2.5rem] border border-white/90 px-6 py-14 shadow-[0_28px_70px_rgba(96,73,134,0.11)] sm:px-10 lg:px-14">
                    {/* Decorative background elements */}
                    <div
                        className="domains-panel-orb domains-panel-orb-one"
                        aria-hidden="true"
                    />

                    <div
                        className="domains-panel-orb domains-panel-orb-two"
                        aria-hidden="true"
                    />

                    <div className="relative z-10 grid gap-12 lg:grid-cols-[.82fr_1.18fr] lg:items-center">
                        {/* Section introduction */}
                        <div>
                            <p className="nexora-eyebrow">
                                Explore opportunities
                            </p>

                            <h2
                                id="domains-heading"
                                className="mt-5 text-4xl font-black tracking-tight text-[#29213d] sm:text-5xl"
                            >
                                One platform. Many directions.
                            </h2>

                            <p className="mt-5 max-w-xl leading-8 text-[#716a81]">
                                Explore opportunity areas available across
                                Nexora. The platform reads its live domain
                                catalog directly from the backend and supports
                                a growing range of community needs.
                            </p>

                            {isError && (
                                <p
                                    className="mt-6 flex max-w-lg items-start gap-2 text-sm font-semibold leading-6 text-[#81788f]"
                                    role="alert"
                                >
                                    <span
                                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d05d75]"
                                        aria-hidden="true"
                                    />

                                    Domains could not be loaded from the server.
                                    Please try again shortly.
                                </p>
                            )}
                        </div>

                        {/* Database-backed domain cards */}
                        <div>
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-sm font-extrabold text-[#342947]">
                                        Available domains
                                    </p>

                                    <p className="mt-1 text-sm text-[#81798e]">
                                        Live opportunity areas from Nexora
                                    </p>
                                </div>

                                {!isLoading && !isError && normalizedDomains.length > 0 && (
                                    <span className="rounded-full border border-white/90 bg-white/60 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[#7b6f91] backdrop-blur-xl">
                                        {normalizedDomains.length} available
                                    </span>
                                )}
                            </div>

                            {isLoading && (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {Array.from(
                                        { length: 6 },
                                        (_, index) => (
                                            <DomainSkeleton
                                                key={`domain-skeleton-${index}`}
                                                index={index}
                                            />
                                        ),
                                    )}
                                </div>
                            )}

                            {!isLoading && !isError && normalizedDomains.length === 0 && (
                                <div className="rounded-[1.5rem] border border-white/90 bg-white/65 px-6 py-10 text-center backdrop-blur-xl">
                                    <CircleHelp
                                        className="mx-auto text-[#8165cd]"
                                        size={30}
                                        aria-hidden="true"
                                    />

                                    <h3 className="mt-4 text-lg font-extrabold text-[#302642]">
                                        No domains are available yet
                                    </h3>

                                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#777083]">
                                        New opportunity domains will appear here
                                        as soon as they are enabled in Nexora.
                                    </p>
                                </div>
                            )}

                            {!isLoading && !isError && normalizedDomains.length > 0 && (
                                <>
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        {initialDomains.map((domain) => (
                                            <DomainCard
                                                key={domain.id}
                                                domain={domain}
                                            />
                                        ))}

                                        {hasMoreDomains && (
                                            <ExploreMoreCard
                                                remainingCount={
                                                    remainingDomains.length
                                                }
                                                isExpanded={isExpanded}
                                                onClick={
                                                    toggleExpandedDomains
                                                }
                                            />
                                        )}
                                    </div>

                                    {hasMoreDomains && isExpanded && (
                                        <div
                                            id="additional-domains"
                                            className="mt-7 rounded-[1.75rem] border border-white/90 bg-white/45 p-4 shadow-[0_18px_45px_rgba(96,73,134,0.07)] backdrop-blur-xl sm:p-5"
                                        >
                                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <p className="font-extrabold text-[#342947]">
                                                        More Nexora domains
                                                    </p>

                                                    <p className="mt-1 text-sm text-[#81798e]">
                                                        Additional live domains
                                                        from the database
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={
                                                        toggleExpandedDomains
                                                    }
                                                    className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/75 px-4 py-2 text-sm font-bold text-[#6f57b9] transition hover:bg-white"
                                                    aria-expanded="true"
                                                    aria-controls="additional-domains"
                                                >
                                                    Show less

                                                    <ChevronUp
                                                        size={17}
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                            </div>

                                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                                {remainingDomains.map(
                                                    (domain) => (
                                                        <DomainCard
                                                            key={domain.id}
                                                            domain={domain}
                                                        />
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
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
            className="domain-card group relative min-h-[190px] overflow-hidden rounded-[1.35rem] border border-[#d9cdf3] bg-gradient-to-br from-[#f2ebff]/90 via-white/80 to-[#e8f6ff]/90 p-5 text-left shadow-[0_16px_38px_rgba(98,77,143,0.09)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(98,77,143,0.16)]"
            aria-expanded={isExpanded}
            aria-controls="additional-domains"
        >
            <div
                className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#8062d0]/70 to-transparent"
                aria-hidden="true"
            />

            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#8062d0] to-[#64a5d8] text-white shadow-[0_10px_22px_rgba(117,86,193,0.18)] transition duration-300 group-hover:scale-110">
                <Layers3
                    size={22}
                    aria-hidden="true"
                />
            </span>

            <h3 className="mt-5 font-extrabold text-[#302642]">
                {isExpanded ? 'Hide More' : 'Explore More'}
            </h3>

            <p className="mt-1 text-sm leading-6 text-[#777083]">
                {remainingCount} additional domain
                {remainingCount === 1 ? '' : 's'} available
            </p>

            <span className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-[#7155bf]">
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