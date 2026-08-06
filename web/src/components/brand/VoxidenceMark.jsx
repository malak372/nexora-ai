/**
 * Voxidence official project icon.
 *
 * Uses the approved icon stored in the public folder and adds the subtle
 * recurring light sweep used across the public and authenticated headers.
 *
 * @param {Object} props Component properties.
 * @param {number|string} [props.size=24] Rendered icon size.
 * @param {string} [props.className=''] Optional CSS class name.
 * @param {string} [props.title='Voxidence'] Accessible image label.
 * @returns {JSX.Element} Voxidence project icon.
 *
 * @author Eman, Malak
 */
export default function VoxidenceMark({
  size = 24,
  className = '',
  title = 'Voxidence',
}) {
  return (
    <span
      className={`voxidence-mark ${className}`.trim()}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${typeof size === 'number' ? `${size}px` : size}`,
      }}
      title={title}
    >
      <img
        src="/voxidence-icon.svg"
        alt={title}
        width={size}
        height={size}
        draggable="false"
      />
      <span className="voxidence-mark__shine" aria-hidden="true" />
    </span>
  );
}