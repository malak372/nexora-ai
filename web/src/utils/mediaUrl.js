const API_BASE_URL = (
    process.env.REACT_APP_API_BASE_URL ||
    process.env.REACT_APP_API_URL ||
    'http://localhost:3000'
).replace(/\/$/, '');

/** Resolves a backend-relative media path into an absolute browser URL. */
export function resolveMediaUrl(mediaPath) {
    if (!mediaPath) return '';
    if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
    return `${API_BASE_URL}${mediaPath.startsWith('/') ? '' : '/'}${mediaPath}`;
}
