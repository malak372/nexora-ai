/**
 * Interactive dashboard metric.
 *
 * @author Malak
 */

import { ArrowUpRight, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

export default function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  tone = "violet",
  index = "01",
  onClick,
}) {
  const Element = onClick ? motion.button : motion.article;

  return (
    <Element
      className={`normal-metric-card normal-metric-card--${tone}`}
      onClick={onClick}
      type={onClick ? "button" : undefined}
      whileHover={onClick ? { y: -8, scale: 1.012 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      <span className="normal-metric-card__index" aria-hidden="true">{index}</span>

      <div className="normal-metric-card__top">
        <span className="normal-metric-card__icon" aria-hidden="true">
          <Icon size={20} strokeWidth={1.9} />
        </span>

        {onClick ? (
          <span className="normal-metric-card__arrow">
            <ArrowUpRight size={17} aria-hidden="true" />
          </span>
        ) : null}
      </div>

      <div className="normal-metric-card__content">
        <span className="normal-metric-card__trend"><TrendingUp size={13} /> Live workspace metric</span>
        <strong>{value}</strong>
        <span className="normal-metric-card__label">{label}</span>
        <small>{helper}</small>
      </div>
    </Element>
  );
}