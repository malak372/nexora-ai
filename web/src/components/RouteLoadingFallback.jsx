/**
 * Lightweight fallback displayed while a route bundle is downloaded.
 *
 * Keeping this component dependency-free prevents the loading screen itself
 * from increasing the initial JavaScript bundle size.
 *
 * @author Eman
 */
export default function RouteLoadingFallback() {
    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                minHeight: '45vh',
                display: 'grid',
                placeItems: 'center',
                padding: '2rem',
                color: '#315e55',
            }}
        >
            <div style={{ display: 'grid', justifyItems: 'center', gap: '0.85rem' }}>
                <span
                    aria-hidden="true"
                    style={{
                        width: '2rem',
                        height: '2rem',
                        border: '3px solid rgba(49, 94, 85, 0.18)',
                        borderTopColor: '#315e55',
                        borderRadius: '999px',
                        animation: 'vox-route-spin 0.75s linear infinite',
                    }}
                />
                <span>Loading…</span>
                <style>{'@keyframes vox-route-spin{to{transform:rotate(360deg)}}'}</style>
            </div>
        </div>
    );
}