/**
 * Soft monochrome light-bulb mark for compact public-facing brand placements.
 * It inherits the surrounding text color, so it stays free of gold accents.
 *
 * @param {Object} props Component properties.
 * @param {number|string} [props.size=24] Rendered mark size.
 * @param {string} [props.className=''] Optional CSS class name.
 * @param {string} [props.title='Voxidence idea light'] Accessible SVG title.
 * @returns {JSX.Element} Soft light-bulb symbol.
 *
 * @author Eman, Malak
 */
export default function SoftBulbMark({
    size = 24,
    className = '',
    title = 'Voxidence idea light',
}) {
    return (
        <svg
            viewBox="0 0 32 32"
            width={size}
            height={size}
            className={className}
            role="img"
            aria-label={title}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
                display: 'block',
                width: size,
                height: size,
                flexShrink: 0,
            }}
        >
            <path
                d="M10.35 18.55C8.88 17.2 8 15.25 8 13.1C8 8.88 11.58 5.5 16 5.5C20.42 5.5 24 8.88 24 13.1C24 15.25 23.12 17.2 21.65 18.55C20.45 19.66 19.7 20.75 19.55 22.25H12.45C12.3 20.75 11.55 19.66 10.35 18.55Z"
                stroke="currentColor"
                strokeWidth="2.05"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12.75 25H19.25M13.8 28H18.2"
                stroke="currentColor"
                strokeWidth="2.05"
                strokeLinecap="round"
            />
            <path
                d="M16 2V3.7M5.2 6.1L6.55 7.1M26.8 6.1L25.45 7.1M3 14H4.8M27.2 14H29"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
            />
            <path
                d="M13.2 14.5L15.15 16.45L19.1 11.9"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}