/**
 * Compact problem launcher used inside the normal user dashboard.
 *
 * @author Malak
 */

import { useState } from "react";
import { ArrowUpRight, Mic, MicOff, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserExperience } from '../../../../system/user-experience';
import useVoiceTyping from '../../shared/components/useVoiceTyping';

const EXAMPLES = [
  "University scheduling problems",
  "Healthcare appointment delays",
  "Public transport reliability",
];

export default function IdeaLauncher({ compact = false }) {
  const navigate = useNavigate();
  const { t, isArabic } = useUserExperience();
  const [problem, setProblem] = useState("");
  const {
    isListening,
    isSupported: voiceSupported,
    error: voiceError,
    toggle: toggleVoice,
  } = useVoiceTyping({
    value: problem,
    onChange: setProblem,
    preferredLanguage: isArabic ? 'AR' : 'EN',
    maxLength: 2000,
  });

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
          placeholder={t('Describe the challenge in your own words...')}
          aria-label={t('Describe the problem you want to solve')}
          dir="auto"
          maxLength={2000}
        />

        <div className="normal-launcher__input-meta">
          <span>{problem.length}/2000</span>

          <div className="normal-launcher__actions">
            <button
              className={`normal-icon-button normal-launcher__voice ${isListening ? 'is-listening' : ''}`}
              type="button"
              onClick={toggleVoice}
              aria-label={t(isListening ? 'Stop voice typing' : 'Start voice typing')}
              aria-pressed={isListening}
              title={t(
                voiceSupported
                  ? isListening
                    ? 'Stop voice typing'
                    : 'Speak and convert your voice to text'
                  : 'Voice typing is unavailable in this browser'
              )}
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <button
              className="normal-primary-button"
              type="button"
              onClick={continueToGenerator}
            >
              {t('Start discovery')}
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {voiceError ? (
        <div className="normal-launcher__voice-status is-error">
          <span />
          {t(voiceError)}
        </div>
      ) : null}

      <div className="normal-launcher__examples">
        <span>
          <Sparkles size={14} />
          {t('Try an example')}
        </span>

        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => setProblem(isArabic ? t(example) : example)}>
            {t(example)}
          </button>
        ))}
      </div>
    </div>
  );
}