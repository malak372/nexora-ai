import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useUserExperience } from '../../../../system/user-experience';

function elapsedLabel(stage, t) {
  const rows = Array.isArray(stage?.stages) ? stage.stages : [];
  const completed = [...rows].reverse().find((row) => row?.completedAt || row?.finishedAt || row?.updatedAt);
  const started = rows.find((row) => row?.startedAt || row?.createdAt);
  const end = completed?.completedAt ?? completed?.finishedAt ?? completed?.updatedAt;
  const start = started?.startedAt ?? started?.createdAt;

  if (start && end) {
    const diff = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
    if (Number.isFinite(diff) && diff > 0) {
      const seconds = Math.max(1, Math.round(diff / 1000));
      return seconds < 60 ? `${seconds}s ${t('elapsed')}` : `${Math.round(seconds / 60)}m ${t('elapsed')}`;
    }
  }

  if (stage.status === 'active') return t('In progress');
  if (stage.status === 'completed') return t('Completed');
  if (stage.status === 'failed') return t('Failed');
  return t('Pending');
}

export default function PipelineStage({ stage, index }) {
  const shouldReduceMotion = useReducedMotion();
  const { t } = useUserExperience();
  const Icon = stage.icon;
  const isActive = stage.status === 'active';
  const isCompleted = stage.status === 'completed';
  const isFailed = stage.status === 'failed';

  return (
    <motion.article
      className={`vx-progress-stage vx-progress-stage--${stage.status}`}
      role="listitem"
      initial={shouldReduceMotion ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: shouldReduceMotion ? 0 : index * 0.05, duration: 0.3 }}
    >
      {index < 5 ? (
        <span className={`vx-progress-stage__connector is-${stage.status}`} aria-hidden="true">
          <span className="vx-progress-stage__flow" />
          <ArrowRight size={15} />
        </span>
      ) : null}
      <span className="vx-progress-stage__orbit" aria-hidden="true" />
      <div className="vx-progress-stage__top">
        <span className="vx-progress-stage__icon">
          {isCompleted ? <Check size={17} /> : isActive ? <span className="vx-progress-stage__active-dial" aria-hidden="true" /> : isFailed ? <TriangleAlert size={17} /> : <Icon size={17} className="vx-progress-stage__icon-glyph" />}
        </span>
        <span className="vx-progress-stage__number">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <h3>{t(stage.title)}</h3>
      <p>{t(stage.description)}</p>
      <div className="vx-progress-stage__footer">
        <span className={`vx-progress-stage__badge is-${stage.status}`}>
          {t(isCompleted ? 'Completed' : isActive ? 'In progress' : isFailed ? 'Failed' : 'Pending')}
        </span>
        <small>{elapsedLabel(stage, t)}</small>
      </div>
    </motion.article>
  );
}
