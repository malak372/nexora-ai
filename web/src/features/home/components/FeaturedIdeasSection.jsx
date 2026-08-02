/**
 * Renders the latest public software ideas on the Nexora landing page.
 *
 * Publications are loaded from the public backend endpoint, so the section
 * always reflects published ideas stored in the database instead of static
 * frontend examples.
 *
 * @component
 * @returns {JSX.Element} The featured public ideas section.
 *
 * @author Eman
 */

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowUpRight,
    CalendarDays,
    Lightbulb,
    MessageSquareText,
    RefreshCw,
    Sparkles,
    Star,
    UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { ROUTES, buildRoute } from '../../../constants/routes.constants';
import {
    getFeaturedPublications,
    publicPublicationQueryKeys,
} from '../api/publications.api';

const FEATURED_PUBLICATIONS_LIMIT = 6;

const IDEA_VARIANTS = [
    {
        icon: 'from-[#8b6bd8] to-[#a98be8]',
        badge: 'border-[#e3d8fa] bg-[#f5f0ff] text-[#7555c7]',
        glow: 'bg-[#d9c8ff]/45',
    },
    {
        icon: 'from-[#5e9ed0] to-[#79b8df]',
        badge: 'border-[#d7ebf8] bg-[#eff9ff] text-[#4d8ebd]',
        glow: 'bg-[#ccecff]/45',
    },
    {
        icon: 'from-[#c779aa] to-[#df9fc0]',
        badge: 'border-[#f2dbea] bg-[#fff3f9] text-[#a9618a]',
        glow: 'bg-[#ffd8eb]/45',
    },
];

function formatPublishedDate(value) {
    if (!value) {
        return 'Recently published';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Recently published';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function getObjectivesPreview(objectives) {
    if (!Array.isArray(objectives) || objectives.length === 0) {
        return null;
    }

    const firstObjective = objectives.find(
        (objective) => typeof objective === 'string' && objective.trim(),
    );

    return firstObjective?.trim() || null;
}

function FeaturedIdeaCard({
    publication,
    index,
    shouldReduceMotion,
}) {
    const variant = IDEA_VARIANTS[index % IDEA_VARIANTS.length];
    const direction =
        getObjectivesPreview(publication.publicObjectives) ||
        publication.publicAbstract ||
        'Open the publication to explore this software opportunity.';

    return (
        <motion.article
            initial={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 0, y: 30 }
            }
            whileInView={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 1, y: 0 }
            }
            viewport={{ once: true, amount: 0.2 }}
            transition={{
                duration: 0.55,
                delay: index * 0.08,
            }}
            className="featured-idea-card group relative overflow-hidden rounded-[2rem] border border-white/90 bg-white/75 p-6 backdrop-blur-xl"
        >
            <div
                className={`absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${variant.glow}`}
                aria-hidden="true"
            />

            <div className="relative z-10 flex h-full flex-col">
                <div className="flex items-start justify-between gap-5">
                    <span
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_14px_30px_rgba(98,75,145,0.18)] ${variant.icon}`}
                    >
                        <Lightbulb size={25} aria-hidden="true" />
                    </span>

                    <span
                        className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${variant.badge}`}
                    >
                        Public idea
                    </span>
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-[#8b8297]">
                    <span className="inline-flex items-center gap-1.5">
                        <UserRound size={14} aria-hidden="true" />
                        {publication.publisher?.fullName || 'Nexora creator'}
                    </span>

                    <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={14} aria-hidden="true" />
                        {formatPublishedDate(publication.publishedAt)}
                    </span>
                </div>

                <h3 className="mt-4 min-h-[3.5rem] text-xl font-black leading-7 text-[#2b233d]">
                    {publication.publicTitle || 'Untitled software idea'}
                </h3>

                <p className="mt-4 min-h-[7rem] line-clamp-4 text-sm leading-7 text-[#756e83]">
                    {publication.publicProblem ||
                        publication.publicAbstract ||
                        'A public software opportunity shared through Nexora.'}
                </p>

                <div className="mt-6 border-t border-[#eee8f5] pt-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8464c8]">
                        Proposed direction
                    </p>

                    <p className="mt-2 min-h-[4.5rem] line-clamp-3 text-sm font-semibold leading-6 text-[#40364f]">
                        {direction}
                    </p>
                </div>

                <div className="mt-5 flex items-center gap-4 text-xs font-bold text-[#8b8297]">
                    <span className="inline-flex items-center gap-1.5">
                        <Star size={14} aria-hidden="true" />
                        {Number(publication.averageRating || 0).toFixed(1)}
                    </span>

                    <span className="inline-flex items-center gap-1.5">
                        <MessageSquareText size={14} aria-hidden="true" />
                        {publication.feedbackCount || 0} feedback
                    </span>
                </div>

                <Link
                    to={buildRoute.publicationDetails(publication.id)}
                    className="mt-auto inline-flex items-center gap-2 pt-7 text-sm font-extrabold text-[#7656c6] transition duration-300 group-hover:gap-3"
                    aria-label={`Preview ${publication.publicTitle || 'this idea'}`}
                >
                    Preview idea
                    <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
            </div>
        </motion.article>
    );
}

function FeaturedIdeasSkeleton() {
    return (
        <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading public ideas">
            {[0, 1, 2].map((item) => (
                <div
                    key={item}
                    className="featured-idea-card min-h-[430px] animate-pulse rounded-[2rem] border border-white/90 bg-white/75 p-6"
                >
                    <div className="h-14 w-14 rounded-2xl bg-[#eee8f7]" />
                    <div className="mt-7 h-3 w-2/3 rounded-full bg-[#eee8f7]" />
                    <div className="mt-5 h-7 w-5/6 rounded-full bg-[#e8e1f2]" />
                    <div className="mt-5 h-3 w-full rounded-full bg-[#f0ebf6]" />
                    <div className="mt-3 h-3 w-11/12 rounded-full bg-[#f0ebf6]" />
                    <div className="mt-3 h-3 w-4/5 rounded-full bg-[#f0ebf6]" />
                    <div className="mt-10 h-px bg-[#eee8f5]" />
                    <div className="mt-6 h-3 w-1/3 rounded-full bg-[#e8e1f2]" />
                    <div className="mt-4 h-3 w-full rounded-full bg-[#f0ebf6]" />
                    <div className="mt-3 h-3 w-3/4 rounded-full bg-[#f0ebf6]" />
                </div>
            ))}
        </div>
    );
}

export default function FeaturedIdeasSection() {
    const shouldReduceMotion = useReducedMotion();

    const {
        data,
        isLoading,
        isError,
        refetch,
        isFetching,
    } = useQuery({
        queryKey: publicPublicationQueryKeys.featured(
            FEATURED_PUBLICATIONS_LIMIT,
        ),
        queryFn: () =>
            getFeaturedPublications({
                limit: FEATURED_PUBLICATIONS_LIMIT,
            }),
        staleTime: 3 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
    });

    const publications = data?.items ?? [];

    return (
        <section
            id="featured-ideas"
            className="featured-ideas-section relative scroll-mt-24 overflow-hidden py-24 sm:py-32"
            aria-labelledby="featured-ideas-heading"
        >
            <div className="featured-ideas-orb featured-ideas-orb-one" aria-hidden="true" />
            <div className="featured-ideas-orb featured-ideas-orb-two" aria-hidden="true" />

            <div className="nexora-container relative z-10">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <p className="nexora-eyebrow">Featured opportunities</p>

                        <h2 id="featured-ideas-heading" className="nexora-section-title mt-5">
                            Discover ideas published by the Nexora community.
                        </h2>

                        <p className="nexora-section-description mt-5">
                            Explore real public software ideas created from community evidence and shared by Nexora users.
                        </p>
                    </div>

                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#e2d7f6] bg-white/75 px-4 py-2 text-sm font-bold text-[#7656c6] shadow-sm backdrop-blur-xl">
                        <Sparkles size={16} aria-hidden="true" />
                        Live from public publications
                    </div>
                </div>

                {isLoading && <FeaturedIdeasSkeleton />}

                {!isLoading && isError && (
                    <div className="featured-ideas-state mt-14 text-center">
                        <Lightbulb size={30} aria-hidden="true" />
                        <h3>Public ideas could not be loaded.</h3>
                        <p>Make sure the backend is running, then try again.</p>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="nexora-button-secondary mt-5 inline-flex items-center gap-2"
                        >
                            <RefreshCw
                                size={17}
                                className={isFetching ? 'animate-spin' : ''}
                                aria-hidden="true"
                            />
                            Try again
                        </button>
                    </div>
                )}

                {!isLoading && !isError && publications.length === 0 && (
                    <div className="featured-ideas-state mt-14 text-center">
                        <Lightbulb size={30} aria-hidden="true" />
                        <h3>No public ideas yet.</h3>
                        <p>The first published public ideas will appear here automatically.</p>
                        <Link to={ROUTES.REGISTER} className="nexora-button-primary mt-5 inline-flex">
                            Create an account
                        </Link>
                    </div>
                )}

                {!isLoading && !isError && publications.length > 0 && (
                    <div className="mt-14 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {publications.map((publication, index) => (
                            <FeaturedIdeaCard
                                key={publication.id}
                                publication={publication}
                                index={index}
                                shouldReduceMotion={shouldReduceMotion}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}