/**
 * Voxidence evidence-signal brand mark.
 *
 * The symbol combines a voice waveform, a focused evidence point, and a
 * forward V-shaped path. It represents community voices being refined into
 * evidence-backed software direction.
 *
 * @param {Object} props Component properties.
 * @param {number|string} [props.size=24] Rendered mark size.
 * @param {string} [props.className=''] Optional CSS class name.
 * @param {string} [props.title='Voxidence'] Accessible SVG title.
 * @returns {JSX.Element} Voxidence brand symbol.
 *
 * @author Eman, Malak
 */
export default function VoxidenceMark({
  size = 24,
  className = '',
  title = 'Voxidence',
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      <path
        d="M6.4 9.2 15.2 26c1.12 2.14 4.18 2.14 5.3 0l9.1-16.8"
        stroke="currentColor"
        strokeWidth="2.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M9.1 10.4c2.5 1.65 5.43 2.48 8.8 2.48 3.35 0 6.28-.83 8.79-2.48"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity=".9"
      />

      <path
        d="M11.9 14.6c1.76.94 3.76 1.41 6 1.41 2.23 0 4.23-.47 5.99-1.41"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        opacity=".62"
      />

      <circle cx="17.9" cy="20.15" r="2.55" fill="currentColor" />
      <circle cx="17.9" cy="20.15" r="4.6" stroke="currentColor" strokeWidth="1.2" opacity=".24" />
    </svg>
  );
}