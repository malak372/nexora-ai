/**
 * Renders a compact selection of public Voxidence discoveries.
 *
 * Publications are loaded from the public backend endpoint and remain fully
 * connected to the existing publication-details route.
 *
 * @component
 * @returns {JSX.Element} The public discoveries section.
 *
 * @author Eman
 */

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
    ArrowRight,
    CalendarDays,
    Lightbulb,
    MessageSquareText,
    RefreshCw,
    Sparkles,
    Star,
    UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { useUserExperience } from '../../../system/user-experience';

import { ROUTES, buildRoute } from '../../../constants/routes.constants';
import {
    getFeaturedPublications,
    publicPublicationQueryKeys,
} from '../api/publications.api';

const FEATURED_PUBLICATIONS_LIMIT = 3;

function formatPublishedDate(value, language) {
    if (!value) {
        return 'Recently published';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Recently published';
    }

    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function getDirection(publication) {
    const objectives = Array.isArray(publication.publicObjectives)
        ? publication.publicObjectives
        : [];

    const firstObjective = objectives.find(
        (objective) => typeof objective === 'string' && objective.trim(),
    );

    return (
        firstObjective?.trim() ||
        publication.publicAbstract ||
        'Open this publication to explore the complete opportunity direction.'
    );
}

function DiscoveryCard({ publication, index, shouldReduceMotion, language, t }) {
    const title = publication.publicTitle || 'Untitled software idea';
    const summary =
        publication.publicProblem ||
        publication.publicAbstract ||
        'A public software opportunity discovered through Voxidence.';
    const localizedTitle = title;
    const localizedSummary = summary;
    const localizedDirection = getDirection(publication);

    return (
        <motion.article
            initial={shouldReduceMotion ? undefined : { opacity: 0, y: 20 }}
            whileInView={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{
                duration: 0.48,
                delay: index * 0.08,
                ease: [0.22, 1, 0.36, 1],
            }}
            className="vox-discovery-card group"
        >
            <div className="vox-discovery-card__topline" aria-hidden="true" />

            <div className="vox-discovery-card__header">
                <span className="vox-discovery-card__icon">
                    <Lightbulb size={19} aria-hidden="true" />
                </span>

                <span className="vox-discovery-card__badge">
                    {t('Public discovery')}
                </span>
            </div>

            <div className="vox-discovery-card__meta">
                <span>
                    <UserRound size={13} aria-hidden="true" />
                    <span dir="auto" data-no-auto-translate="true">{publication.publisher?.fullName || t('Voxidence creator')}</span>
                </span>

                <span>
                    <CalendarDays size={13} aria-hidden="true" />
                    {t(formatPublishedDate(publication.publishedAt, language))}
                </span>
            </div>

            <h3 dir="auto" data-idea-content="true">{localizedTitle}</h3>

            <p className="vox-discovery-card__summary" dir="auto" data-idea-content="true">
                {localizedSummary}
            </p>

            <div className="vox-discovery-card__direction">
                <span>{t('Selected direction')}</span>
                <p dir="auto" data-idea-content="true">{localizedDirection}</p>
            </div>

            <div className="vox-discovery-card__footer">
                <div className="vox-discovery-card__signals">
                    <span>
                        <Star size={14} aria-hidden="true" />
                        {Number(publication.averageRating || 0).toFixed(1)}
                    </span>

                    <span>
                        <MessageSquareText size={14} aria-hidden="true" />
                        {publication.feedbackCount || 0}
                    </span>
                </div>

                <Link
                    to={buildRoute.publicationDetails(publication.id)}
                    className="vox-discovery-card__link"
                    aria-label={t('Open idea')}
                >
                    {t('Open idea')}
                    <ArrowRight size={16} aria-hidden="true" />
                </Link>
            </div>
        </motion.article>
    );
}

function FeaturedIdeasSkeleton({ t }) {
    return (
        <div className="vox-discoveries-grid" aria-label={t('Loading public ideas')}>
            {[0, 1, 2].map((item) => (
                <div
                    key={item}
                    className="vox-discovery-card vox-discovery-card--skeleton"
                    aria-hidden="true"
                >
                    <div className="h-10 w-10 rounded-2xl bg-[#eaf5f3]" />
                    <div className="mt-5 h-3 w-2/3 rounded-full bg-[#eaf5f3]" />
                    <div className="mt-5 h-6 w-4/5 rounded-full bg-[#e1eeeb]" />
                    <div className="mt-4 h-3 w-full rounded-full bg-[#edf6f4]" />
                    <div className="mt-2 h-3 w-5/6 rounded-full bg-[#edf6f4]" />
                    <div className="mt-7 h-16 rounded-2xl bg-[#f4f9f8]" />
                </div>
            ))}
        </div>
    );
}

export default function FeaturedIdeasSection() {
    const shouldReduceMotion = useReducedMotion();
    const { language, t } = useUserExperience();

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
            className="vox-discoveries-section"
            aria-labelledby="featured-ideas-heading"
        >
            <div className="vox-discoveries-container">
                <header className="vox-discoveries-header">
                    <div className="vox-discoveries-heading">
                        <div className="vox-discoveries-eyebrow-row">
                            <span className="vox-discoveries-eyebrow">
                                <Sparkles size={15} aria-hidden="true" />
                                {t('Community discoveries')}
                            </span>

                            <span className="vox-discoveries-live">
                                <span aria-hidden="true" />
                                {t('Live publications')}
                            </span>
                        </div>

                        <h2 id="featured-ideas-heading">
                            {t('Explore ideas shaped by real community evidence.')}
                        </h2>

                        <p>
                            {t('A curated look at public software opportunities discovered, evaluated, and shared through Voxidence.')}
                        </p>
                    </div>
                </header>

                {isLoading && <FeaturedIdeasSkeleton t={t} />}

                {!isLoading && isError && (
                    <div className="vox-discoveries-state">
                        <Lightbulb size={27} aria-hidden="true" />
                        <div>
                            <h3>{t('Public ideas could not be loaded.')}</h3>
                            <p>{t('Make sure the backend is running, then try again.')}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            disabled={isFetching}
                            className="vox-discoveries-retry"
                        >
                            <RefreshCw
                                size={16}
                                className={isFetching ? 'animate-spin' : ''}
                                aria-hidden="true"
                            />
                            {t('Try again')}
                        </button>
                    </div>
                )}

                {!isLoading && !isError && publications.length === 0 && (
                    <div className="vox-discoveries-state">
                        <Lightbulb size={27} aria-hidden="true" />
                        <div>
                            <h3>{t('No public ideas yet.')}</h3>
                            <p>{t('The first published discoveries will appear here automatically.')}</p>
                        </div>
                        <Link to={ROUTES.REGISTER} className="vox-discoveries-retry">
                            {t('Create an account')}
                        </Link>
                    </div>
                )}

                {!isLoading && !isError && publications.length > 0 && (
                    <div className="vox-discoveries-grid">
                        {publications.map((publication, index) => (
                            <DiscoveryCard
                                key={publication.id}
                                publication={publication}
                                index={index}
                                shouldReduceMotion={shouldReduceMotion}
                                language={language}
                                t={t}
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
