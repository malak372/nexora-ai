/**
 * Compact problem launcher used inside the normal user dashboard.
 *
 * @author Malak
 */

import { useState } from "react";
import { ArrowUpRight, Mic, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

const EXAMPLES = [
  "University scheduling problems",
  "Healthcare appointment delays",
  "Public transport reliability",
];

export default function IdeaLauncher({ compact = false }) {
  const navigate = useNavigate();
  const [problem, setProblem] = useState("");

  const continueToGenerator = () => {
    const trimmedProblem = problem.trim();
    const query = trimmedProblem
      ? `?problem=${encodeURIComponent(trimmedProblem)}`
      : "";

    navigate(`/normal/generate${query}`);
  };

  return (
    <div className={`normal-launcher${compact ? " normal-launcher--compact" : ""}`}>
      <div className="normal-launcher__input-shell">
        <textarea
          value={problem}
          onChange={(event) => setProblem(event.target.value.slice(0, 2000))}
          placeholder="Describe the challenge in your own words..."
          aria-label="Describe the problem you want to solve"
        />

        <div className="normal-launcher__input-meta">
          <span>{problem.length}/2000</span>

          <div className="normal-launcher__actions">
            <button
              className="normal-icon-button"
              type="button"
              aria-label="Use voice input"
              title="Voice input will be connected in the generation wizard"
            >
              <Mic size={18} />
            </button>

            <button
              className="normal-primary-button"
              type="button"
              onClick={continueToGenerator}
            >
              Start discovery
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="normal-launcher__examples">
        <span>
          <Sparkles size={14} />
          Try an example
        </span>

        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => setProblem(example)}>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}