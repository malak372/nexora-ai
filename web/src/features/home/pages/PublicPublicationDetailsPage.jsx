/**
 * Displays a single public idea publication for unauthenticated visitors.
 *
 * The page uses the public publication endpoint and exposes only the safe
 * publication snapshot returned by the backend.
 *
 * @component
 * @returns {JSX.Element}
 *
 * @author Eman
 */

import { useQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    CalendarDays,
    Lightbulb,
    MessageSquareText,
    Star,
    Target,
    UserRound,
    UsersRound,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { apiClient } from '../../../api/client';
import { ROUTES } from '../../../constants/routes.constants';

async function getPublicPublication(publicationId) {
    const response = await apiClient.get(`/publications/${publicationId}`);
    return response.data;
}

function formatDate(value) {
    if (!value) {
        return 'Recently published';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Recently published';
    }

    return new Intl.DateTimeFormat('en', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function normalizeTextList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(
        (item) => typeof item === 'string' && item.trim(),
    );
}

export default function PublicPublicationDetailsPage() {
    const { publicationId } = useParams();

    const { data, isLoading, isError } = useQuery({
        queryKey: ['publications', 'public', publicationId],
        queryFn: () => getPublicPublication(publicationId),
        enabled: Boolean(publicationId),
        staleTime: 2 * 60 * 1000,
        retry: 1,
    });

    if (isLoading) {
        return (
            <main className="min-h-[70vh] bg-[#fbf9ff] py-16">
                <div className="nexora-container">
                    <div className="mx-auto max-w-4xl animate-pulse rounded-[2rem] border border-[#ebe3f6] bg-white p-8 shadow-soft sm:p-12">
                        <div className="h-4 w-40 rounded-full bg-[#eee8f7]" />
                        <div className="mt-8 h-10 w-4/5 rounded-full bg-[#e9e2f3]" />
                        <div className="mt-8 h-4 w-full rounded-full bg-[#f0ebf6]" />
                        <div className="mt-3 h-4 w-11/12 rounded-full bg-[#f0ebf6]" />
                        <div className="mt-3 h-4 w-3/4 rounded-full bg-[#f0ebf6]" />
                    </div>
                </div>
            </main>
        );
    }

    if (isError || !data) {
        return (
            <main className="min-h-[70vh] bg-[#fbf9ff] py-16">
                <div className="nexora-container">
                    <div className="mx-auto flex max-w-3xl flex-col items-center rounded-[2rem] border border-[#ebe3f6] bg-white p-10 text-center shadow-soft">
                        <Lightbulb size={36} className="text-[#7656c6]" aria-hidden="true" />
                        <h1 className="mt-5 text-2xl font-black text-[#2b233d]">
                            This public idea is unavailable.
                        </h1>
                        <p className="mt-3 text-[#756e83]">
                            It may have been archived, hidden, or changed to a non-public visibility.
                        </p>
                        <Link to={`${ROUTES.HOME}#featured-ideas`} className="nexora-button-primary mt-7">
                            Back to public ideas
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    const objectives = normalizeTextList(data.publicObjectives);
    const targetUsers = normalizeTextList(data.publicTargetUsers);

    return (
        <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(222,207,255,0.35),transparent_30%),linear-gradient(180deg,#ffffff_0%,#fbf9ff_100%)] py-12 sm:py-16">
            <div className="nexora-container">
                <Link
                    to={`${ROUTES.HOME}#featured-ideas`}
                    className="inline-flex items-center gap-2 text-sm font-extrabold text-[#7656c6]"
                >
                    <ArrowLeft size={17} aria-hidden="true" />
                    Back to Discover
                </Link>

                <article className="mx-auto mt-8 max-w-5xl overflow-hidden rounded-[2.25rem] border border-white bg-white/85 shadow-[0_28px_70px_rgba(96,73,134,0.12)] backdrop-blur-xl">
                    <header className="border-b border-[#eee8f5] p-7 sm:p-11">
                        <span className="inline-flex items-center gap-2 rounded-full border border-[#e3d8fa] bg-[#f5f0ff] px-3.5 py-2 text-xs font-extrabold text-[#7555c7]">
                            <Lightbulb size={15} aria-hidden="true" />
                            Public software idea
                        </span>

                        <h1 className="mt-6 max-w-4xl text-3xl font-black leading-tight text-[#2b233d] sm:text-5xl">
                            {data.publicTitle || 'Untitled software idea'}
                        </h1>

                        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-[#7b7288]">
                            <span className="inline-flex items-center gap-2">
                                <UserRound size={17} aria-hidden="true" />
                                {data.publisher?.fullName || 'Nexora creator'}
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <CalendarDays size={17} aria-hidden="true" />
                                {formatDate(data.publishedAt)}
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <Star size={17} aria-hidden="true" />
                                {Number(data.averageRating || 0).toFixed(1)} ({data.ratingsCount || 0})
                            </span>
                            <span className="inline-flex items-center gap-2">
                                <MessageSquareText size={17} aria-hidden="true" />
                                {data.feedbackCount || 0} feedback
                            </span>
                        </div>
                    </header>

                    <div className="grid gap-8 p-7 sm:p-11 lg:grid-cols-[1.35fr_0.65fr]">
                        <div className="space-y-9">
                            <section>
                                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8464c8]">Problem</p>
                                <p className="mt-4 whitespace-pre-line text-base leading-8 text-[#554b63]">
                                    {data.publicProblem || data.publicAbstract || 'No public problem statement was provided.'}
                                </p>
                            </section>

                            {data.publicAbstract && data.publicAbstract !== data.publicProblem && (
                                <section>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8464c8]">Abstract</p>
                                    <p className="mt-4 whitespace-pre-line text-base leading-8 text-[#554b63]">
                                        {data.publicAbstract}
                                    </p>
                                </section>
                            )}

                            {objectives.length > 0 && (
                                <section>
                                    <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#8464c8]">
                                        <Target size={16} aria-hidden="true" />
                                        Objectives
                                    </p>
                                    <ul className="mt-4 space-y-3">
                                        {objectives.map((objective, index) => (
                                            <li key={`${objective}-${index}`} className="rounded-2xl bg-[#faf8fe] px-4 py-3 text-sm font-semibold leading-6 text-[#554b63]">
                                                {objective}
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </div>

                        <aside className="h-fit rounded-[1.75rem] border border-[#e8e0f4] bg-[#faf8fe] p-6">
                            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#8464c8]">
                                <UsersRound size={16} aria-hidden="true" />
                                Target users
                            </p>

                            {targetUsers.length > 0 ? (
                                <ul className="mt-5 space-y-3">
                                    {targetUsers.map((user, index) => (
                                        <li key={`${user}-${index}`} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#554b63] shadow-sm">
                                            {user}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-4 text-sm leading-6 text-[#756e83]">
                                    Target-user details were not included in the public snapshot.
                                </p>
                            )}

                            <div className="mt-7 border-t border-[#e8e0f4] pt-6">
                                <p className="text-sm font-bold leading-6 text-[#554b63]">
                                    Sign in to access community interactions available for registered users.
                                </p>
                                <Link to={ROUTES.LOGIN} className="nexora-button-primary mt-5 w-full">
                                    Sign in
                                </Link>
                            </div>
                        </aside>
                    </div>
                </article>
            </div>
        </main>
    );
}