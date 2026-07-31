/**
 * Compact horizontal generation milestone.
 *
 * The active milestone receives the strongest visual emphasis. Completed
 * milestones stay refined and neutral, while the connector communicates flow
 * toward the next milestone without implying backend progress by itself.
 *
 * @author Malak
 */
import { Check, ChevronRight, LoaderCircle, TriangleAlert } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PipelineStage({ stage, index, isLast }) {
  const Icon = stage.icon;
  const isActive = stage.status === 'active';

  const label = stage.status === 'completed'
    ? 'Completed'
    : isActive
      ? 'In progress'
      : stage.status === 'failed'
        ? 'Needs attention'
        : 'Waiting';

  return (
    <div className="nx-pipeline-stage-wrap" role="listitem">
      <motion.article
        className={`nx-horizontal-stage nx-horizontal-stage--${stage.status}`}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={isActive
          ? { opacity: 1, y: [0, -4, 0], scale: [1, 1.012, 1] }
          : { opacity: 1, y: 0, scale: 1 }}
        transition={isActive
          ? { opacity: { duration: 0.4 }, y: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } }
          : { delay: index * 0.07, duration: 0.38 }}
      >
        {isActive ? <span className="nx-horizontal-stage__active-glow" aria-hidden="true" /> : null}

        <div className="nx-horizontal-stage__top">
          <motion.span
            className="nx-horizontal-stage__icon"
            animate={isActive ? { rotate: [0, 4, -4, 0], scale: [1, 1.09, 1] } : {}}
            transition={{ duration: 1.8, repeat: isActive ? Infinity : 0, ease: 'easeInOut' }}
          >
            {stage.status === 'completed' ? <Check size={17} />
              : isActive ? <LoaderCircle className="nx-spin" size={18} />
                : stage.status === 'failed' ? <TriangleAlert size={18} />
                  : <Icon size={18} />}
          </motion.span>
          <span className="nx-horizontal-stage__number">{String(index + 1).padStart(2, '0')}</span>
        </div>

        <div className="nx-horizontal-stage__state"><i />{label}</div>
        <h3>{stage.title}</h3>
        <p>{stage.description}</p>
      </motion.article>

      {!isLast ? (
        <div className={`nx-stage-flow nx-stage-flow--${stage.status}`} aria-hidden="true">
          <span className="nx-stage-flow__line" />
          <motion.span
            className="nx-stage-flow__spark"
            animate={{ x: ['-130%', '230%'], opacity: [0, 1, 1, 0] }}
            transition={{ duration: isActive ? 1.15 : 1.8, repeat: Infinity, ease: 'linear', delay: index * 0.12 }}
          />
          <ChevronRight className="nx-stage-flow__arrow" size={16} strokeWidth={2.4} />
        </div>
      ) : null}
    </div>
  );
}