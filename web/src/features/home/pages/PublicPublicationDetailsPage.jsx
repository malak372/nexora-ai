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

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    CalendarDays,
    Lightbulb,
    MessageSquareText,
    Send,
    Star,
    ThumbsDown,
    ThumbsUp,
    Target,
    UserRound,
    UsersRound,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { apiClient } from '../../../api/client';
import { ROUTES } from '../../../constants/routes.constants';
import {
    ensureGuestSession,
    getGuestFeedback,
    getGuestRating,
    getGuestVote,
    setGuestFeedback,
    setGuestRating,
    setGuestVote,
} from '../api/guest-publication-engagement.api';

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
    const queryClient = useQueryClient();
    const [guestReady, setGuestReady] = useState(false);
    const [rating, setRating] = useState(0);
    const [vote, setVote] = useState('');
    const [feedback, setFeedback] = useState('');
    const [busy, setBusy] = useState('');
    const [engagementError, setEngagementError] = useState('');
    const [engagementNotice, setEngagementNotice] = useState('');

    useEffect(() => {
        if (!engagementNotice) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setEngagementNotice('');
        }, 3000);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [engagementNotice]);

    useEffect(() => {
        let active = true;
        ensureGuestSession()
            .then(() => active && setGuestReady(true))
            .catch(() => active && setEngagementError('Guest interactions could not be prepared.'));
        return () => { active = false; };
    }, []);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['publications', 'public', publicationId],
        queryFn: () => getPublicPublication(publicationId),
        enabled: Boolean(publicationId),
        staleTime: 2 * 60 * 1000,
        retry: 1,
    });

    useEffect(() => {
        if (!guestReady || !data) return;

        const requests = [];
        if (data.allowRatings !== false) requests.push(getGuestRating(publicationId).then((value) => setRating(Number(value?.value ?? value?.rating?.value ?? 0))));
        if (data.allowVoting !== false) requests.push(getGuestVote(publicationId).then((value) => setVote(value?.value ?? value?.vote?.value ?? '')));
        if (data.allowFeedback !== false) requests.push(getGuestFeedback(publicationId).then((value) => setFeedback(value?.comment ?? value?.feedback?.comment ?? '')));

        Promise.allSettled(requests).catch(() => undefined);
    }, [data, guestReady, publicationId]);

    async function saveRating(value) {
        setBusy('rating');
        setEngagementError('');
        setEngagementNotice('');

        try {
            await setGuestRating(publicationId, value);
            setRating(value);
            setEngagementNotice(`Thank you! Your ${value}-star rating was saved.`);
            await queryClient.invalidateQueries({
                queryKey: ['publications', 'public', publicationId],
            });
        } catch (error) {
            setEngagementError(
                error?.response?.data?.message ||
                'Your rating could not be saved.',
            );
        } finally {
            setBusy('');
        }
    }

    async function saveVote(value) {
        setBusy('vote');
        setEngagementError('');
        setEngagementNotice('');

        try {
            await setGuestVote(publicationId, value);
            setVote(value);
            setEngagementNotice('Thank you for your vote!');
            await queryClient.invalidateQueries({
                queryKey: ['publications', 'public', publicationId],
            });
        } catch (error) {
            setEngagementError(
                error?.response?.data?.message ||
                'Your vote could not be saved.',
            );
        } finally {
            setBusy('');
        }
    }

    async function saveFeedback(event) {
        event.preventDefault();

        const comment = feedback.trim();

        if (!comment) {
            return;
        }

        setBusy('feedback');
        setEngagementError('');
        setEngagementNotice('');

        try {
            await setGuestFeedback(publicationId, comment);
            setFeedback(comment);
            setEngagementNotice('Thank you! Your feedback was saved.');
            await queryClient.invalidateQueries({
                queryKey: ['publications', 'public', publicationId],
            });
        } catch (error) {
            setEngagementError(
                error?.response?.data?.message ||
                'Your feedback could not be saved.',
            );
        } finally {
            setBusy('');
        }
    }

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

                            {(data.allowRatings !== false || data.allowVoting !== false || data.allowFeedback !== false) && (
                                <div className="mt-7 border-t border-[#e8e0f4] pt-6">
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#8464c8]">Community interaction</p>
                                    <p className="mt-2 text-sm leading-6 text-[#756e83]">You can participate as a guest because the publisher enabled these options.</p>

                                    {data.allowRatings !== false && (
                                        <div className="mt-5">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-sm font-extrabold text-[#554b63]">
                                                    Rate this idea
                                                </p>

                                                {rating > 0 && (
                                                    <span className="text-xs font-bold text-[#7656c6]">
                                                        Your rating: {rating}/5
                                                    </span>
                                                )}
                                            </div>

                                            <div className="mt-2 flex gap-1">
                                                {[1, 2, 3, 4, 5].map((value) => {
                                                    const isSelected = value <= rating;

                                                    return (
                                                        <button
                                                            key={value}
                                                            type="button"
                                                            disabled={!guestReady || busy === 'rating'}
                                                            onClick={() => saveRating(value)}
                                                            className="rounded-lg p-1 transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
                                                            aria-label={`Rate ${value} stars`}
                                                            aria-pressed={rating === value}
                                                        >
                                                            <Star
                                                                size={23}
                                                                className={
                                                                    isSelected
                                                                        ? 'fill-[#8b6bd1] text-[#8b6bd1]'
                                                                        : 'text-[#cfc5df]'
                                                                }
                                                            />
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {rating > 0 && (
                                                <p className="mt-2 text-xs font-semibold text-[#756e83]">
                                                    You can select another star to update your rating.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {data.allowVoting !== false && (
                                        <div className="mt-5 grid grid-cols-2 gap-2">
                                            <button type="button" disabled={!guestReady || busy === 'vote'} onClick={() => saveVote('UP')} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-extrabold ${vote === 'UP' ? 'border-[#8b6bd1] bg-[#f2edff] text-[#6d4fba]' : 'border-[#ddd4eb] bg-white text-[#665b73]'}`}>
                                                <ThumbsUp size={17} /> {data.upvotesCount || 0}
                                            </button>
                                            <button type="button" disabled={!guestReady || busy === 'vote'} onClick={() => saveVote('DOWN')} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-extrabold ${vote === 'DOWN' ? 'border-[#8b6bd1] bg-[#f2edff] text-[#6d4fba]' : 'border-[#ddd4eb] bg-white text-[#665b73]'}`}>
                                                <ThumbsDown size={17} /> {data.downvotesCount || 0}
                                            </button>
                                        </div>
                                    )}

                                    {data.allowFeedback !== false && (
                                        <form className="mt-5" onSubmit={saveFeedback}>
                                            <label className="text-sm font-extrabold text-[#554b63]" htmlFor="guest-feedback">Feedback</label>
                                            <textarea id="guest-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={1000} rows={4} className="mt-2 w-full resize-none rounded-xl border border-[#ddd4eb] bg-white p-3 text-sm text-[#554b63] outline-none focus:border-[#8b6bd1]" placeholder="Share useful feedback with the publisher…" />
                                            <button type="submit" disabled={!guestReady || busy === 'feedback' || !feedback.trim()} className="nexora-button-primary mt-3 w-full disabled:opacity-50">
                                                <Send size={16} /> Save feedback
                                            </button>
                                        </form>
                                    )}

                                    {engagementNotice && (
                                        <div
                                            role="status"
                                            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"
                                        >
                                            {engagementNotice}
                                        </div>
                                    )}

                                    {engagementError && (
                                        <div
                                            role="alert"
                                            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600"
                                        >
                                            {engagementError}
                                        </div>
                                    )}
                                </div>
                            )}
                        </aside>
                    </div>
                </article>
            </div>
        </main>
    );
}