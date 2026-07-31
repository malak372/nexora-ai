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

import {
    BriefcaseBusiness,
    CircleHelp,
    Cpu,
    GraduationCap,
    HeartPulse,
    Leaf,
    UsersRound,
} from 'lucide-react';

import { useDomains } from '../../domains/hooks/useDomains';
import { DOMAIN_ITEMS } from '../constants/home.constants';

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
 * Maximum number of domains displayed in the landing-page section.
 *
 * Keeping the landing-page grid concise prevents the section from becoming
 * visually overwhelming when the backend contains many domain records.
 *
 * @type {number}
 */
const MAX_VISIBLE_DOMAINS = 6;

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
        .filter(Boolean)
        .slice(0, MAX_VISIBLE_DOMAINS);
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
        <article className="domain-card group rounded-2xl border border-white/90 bg-white/65 p-5 backdrop-blur-xl">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#eee6ff] to-[#e2f3ff] text-[#7556c1] transition duration-300 group-hover:scale-110">
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
    const {
        data: availableDomains = [],
        isLoading,
        isError,
    } = useDomains();

    const normalizedDomains = normalizeDomains(availableDomains);

    const domainsToDisplay =
        normalizedDomains.length > 0
            ? normalizedDomains
            : DOMAIN_ITEMS.slice(0, MAX_VISIBLE_DOMAINS);

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

                    <div className="relative z-10 grid gap-12 lg:grid-cols-[.85fr_1.15fr] lg:items-end">
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
                                Discover meaningful software opportunities
                                across domains where communities continuously
                                express real needs.
                            </p>

                            {isError && (
                                <p
                                    className="mt-5 max-w-lg rounded-2xl border border-[#eadff8] bg-white/65 px-4 py-3 text-sm leading-6 text-[#756e83]"
                                    role="status"
                                >
                                    Live domains are temporarily unavailable.
                                    Showing featured Nexora domains instead.
                                </p>
                            )}
                        </div>

                        {/* Supported domain cards */}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {isLoading
                                ? Array.from(
                                    { length: MAX_VISIBLE_DOMAINS },
                                    (_, index) => (
                                        <DomainSkeleton
                                            key={`domain-skeleton-${index}`}
                                            index={index}
                                        />
                                    ),
                                )
                                : domainsToDisplay.map((domain) => (
                                    <DomainCard
                                        key={domain.id}
                                        domain={domain}
                                    />
                                ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}