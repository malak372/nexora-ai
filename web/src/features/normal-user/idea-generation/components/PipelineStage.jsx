/**
 * Compact horizontal generation milestone.
 *
 * Backend stage state remains authoritative. The component presents only the
 * stage name, a concise supporting line, and the current state so the pipeline
 * stays readable for both normal and premium generation.
 *
 * @author Malak
 */
import {
  Check,
  ChevronRight,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

export default function PipelineStage({
  stage,
  index,
  isLast,
}) {
  const shouldReduceMotion = useReducedMotion();
  const Icon = stage.icon;
  const isActive = stage.status === 'active';

  const label =
    stage.status === 'completed'
      ? 'Done'
      : isActive
        ? 'Working'
        : stage.status === 'failed'
          ? 'Attention'
          : 'Queued';

  return (
    <div
      className="nx-pipeline-stage-wrap"
      role="listitem"
    >
      <motion.article
        className={`nx-horizontal-stage nx-horizontal-stage--${stage.status}`}
        initial={
          shouldReduceMotion
            ? undefined
            : {
                opacity: 0,
                y: 12,
                scale: 0.985,
              }
        }
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          delay: shouldReduceMotion ? 0 : index * 0.055,
          duration: 0.34,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        {isActive ? (
          <motion.span
            className="nx-horizontal-stage__active-glow"
            aria-hidden="true"
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    opacity: [0.35, 0.72, 0.35],
                    scale: [0.96, 1.04, 0.96],
                  }
            }
            transition={{
              duration: 2.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ) : null}

        <div className="nx-horizontal-stage__top">
          <motion.span
            className="nx-horizontal-stage__icon"
            animate={
              isActive && !shouldReduceMotion
                ? {
                    rotate: [0, 4, -4, 0],
                    scale: [1, 1.08, 1],
                  }
                : undefined
            }
            transition={{
              duration: 1.8,
              repeat: isActive ? Infinity : 0,
              ease: 'easeInOut',
            }}
          >
            {stage.status === 'completed' ? (
              <Check size={17} />
            ) : isActive ? (
              <LoaderCircle
                className="nx-spin"
                size={18}
              />
            ) : stage.status === 'failed' ? (
              <TriangleAlert size={18} />
            ) : (
              <Icon size={18} />
            )}
          </motion.span>

          <span className="nx-horizontal-stage__number">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        <div className="nx-horizontal-stage__state">
          <i />
          {label}
        </div>

        <h3>{stage.title}</h3>
        <p>{stage.description}</p>
      </motion.article>

      {!isLast ? (
        <div
          className={`nx-stage-flow nx-stage-flow--${stage.status}`}
          aria-hidden="true"
        >
          <span className="nx-stage-flow__line" />

          <motion.span
            className="nx-stage-flow__spark"
            animate={
              shouldReduceMotion
                ? undefined
                : {
                    x: ['-130%', '230%'],
                    opacity: [0, 1, 1, 0],
                  }
            }
            transition={{
              duration: isActive ? 1.1 : 1.7,
              repeat: Infinity,
              ease: 'linear',
              delay: index * 0.1,
            }}
          />

          <ChevronRight
            className="nx-stage-flow__arrow"
            size={16}
            strokeWidth={2.4}
          />
        </div>
      ) : null}
    </div>
  );
}