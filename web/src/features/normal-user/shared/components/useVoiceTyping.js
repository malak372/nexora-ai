import { useCallback, useEffect, useRef, useState } from 'react';

const VOICE_LOCALES = Object.freeze({
  AR: ['ar-SA', 'ar-JO'],
  EN: ['en-US', 'en-GB'],
});

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function normalizeVoiceLanguage(value) {
  const raw = String(value || '').trim().toUpperCase();
  return raw === 'AR' || raw.startsWith('AR-') ? 'AR' : 'EN';
}

function getLanguageOrder(preferredLanguage) {
  const preferred = normalizeVoiceLanguage(preferredLanguage);
  return preferred === 'AR' ? ['AR', 'EN'] : ['EN', 'AR'];
}

function detectTranscriptLanguage(value) {
  const text = String(value || '');
  const arabicCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const englishCount = (text.match(/[A-Za-z]/g) || []).length;

  if (!arabicCount && !englishCount) return null;
  return arabicCount >= englishCount ? 'AR' : 'EN';
}

function clampText(value, maxLength) {
  const text = String(value || '');
  if (!Number.isFinite(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function appendSpeech(baseValue, speechValue) {
  const base = String(baseValue || '').trim();
  const speech = String(speechValue || '').trim();

  if (!speech) return base;
  if (!base) return speech;
  return `${base} ${speech}`;
}

function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function recognitionErrorMessage(code) {
  switch (String(code || '')) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Allow microphone access to use voice typing.';
    case 'audio-capture':
      return 'No microphone was detected.';
    case 'network':
      return 'A network problem interrupted voice typing.';
    case 'language-not-supported':
      return 'Arabic or English voice typing is not supported by this browser.';
    case 'aborted':
    case 'no-speech':
      return '';
    default:
      return 'Voice typing stopped. Please try again.';
  }
}

async function ensureMicrophonePermission() {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  stream.getTracks().forEach((track) => track.stop());
}

export default function useVoiceTyping({
  value,
  onChange,
  preferredLanguage = 'EN',
  maxLength = null,
  disabled = false,
}) {
  const recognitionRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const maxLengthRef = useRef(maxLength);
  const preferredLanguageRef = useRef(preferredLanguage);
  const shouldListenRef = useRef(false);
  const mountedRef = useRef(true);
  const restartTimerRef = useRef(null);
  const sessionRef = useRef(0);
  const startingRef = useRef(false);

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState('');
  const [isSupported, setIsSupported] = useState(() =>
    Boolean(getSpeechRecognitionConstructor()),
  );

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    maxLengthRef.current = maxLength;
  }, [maxLength]);

  useEffect(() => {
    preferredLanguageRef.current = preferredLanguage;
  }, [preferredLanguage]);

  const clearRestartTimer = useCallback(() => {
    if (!restartTimerRef.current) return;
    window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const detachRecognition = useCallback((recognition) => {
    if (!recognition) return;

    recognition.onstart = null;
    recognition.onaudiostart = null;
    recognition.onspeechstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    startingRef.current = false;
    sessionRef.current += 1;
    clearRestartTimer();

    const recognition = recognitionRef.current;
    recognitionRef.current = null;

    if (mountedRef.current) {
      setIsListening(false);
    }

    if (!recognition) return;

    detachRecognition(recognition);

    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
      }
    }
  }, [clearRestartTimer, detachRecognition]);

  const start = useCallback(async () => {
    if (
      disabledRef.current ||
      shouldListenRef.current ||
      startingRef.current
    ) {
      return false;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    const supported = Boolean(SpeechRecognitionCtor);
    setIsSupported(supported);

    if (!SpeechRecognitionCtor) {
      setError('Voice typing is not supported here. Use Chrome or Edge.');
      return false;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext && !isLocalHost()) {
      setError('Voice typing requires HTTPS or localhost.');
      return false;
    }

    startingRef.current = true;
    setError('');

    try {
      await ensureMicrophonePermission();
    } catch (permissionError) {
      startingRef.current = false;

      const permissionName = String(permissionError?.name || '');
      if (permissionName === 'NotAllowedError' || permissionName === 'SecurityError') {
        setError('Allow microphone access to use voice typing.');
      } else if (permissionName === 'NotFoundError' || permissionName === 'DevicesNotFoundError') {
        setError('No microphone was detected.');
      } else {
        setError('The microphone could not start. Please try again.');
      }

      return false;
    }

    if (!mountedRef.current || disabledRef.current) {
      startingRef.current = false;
      return false;
    }

    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    shouldListenRef.current = true;
    startingRef.current = false;

    const languageOrder = getLanguageOrder(preferredLanguageRef.current);
    let languageIndex = 0;
    let localeIndex = 0;
    let lockedLanguage = null;

    const switchToNextLanguage = () => {
      if (lockedLanguage) return;
      languageIndex = (languageIndex + 1) % languageOrder.length;
      localeIndex = 0;
    };

    const scheduleRestart = (delay = 100) => {
      if (
        !mountedRef.current ||
        !shouldListenRef.current ||
        disabledRef.current ||
        sessionRef.current !== sessionId
      ) {
        return;
      }

      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        beginRecognition();
      }, delay);
    };

    const beginRecognition = () => {
      if (
        !mountedRef.current ||
        !shouldListenRef.current ||
        disabledRef.current ||
        sessionRef.current !== sessionId
      ) {
        return;
      }

      const activeLanguage = lockedLanguage || languageOrder[languageIndex];
      const activeLocales = VOICE_LOCALES[activeLanguage];
      const recognition = new SpeechRecognitionCtor();
      const sessionBaseValue = String(valueRef.current || '').trim();
      let producedTranscript = false;
      let fatalError = false;
      let retryDifferentLocale = false;

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;
      recognition.lang = activeLocales[localeIndex];

      recognitionRef.current = recognition;

      recognition.onstart = () => {
        if (
          recognitionRef.current !== recognition ||
          sessionRef.current !== sessionId
        ) {
          return;
        }

        setIsListening(true);
        setError('');
      };

      recognition.onresult = (event) => {
        if (
          recognitionRef.current !== recognition ||
          sessionRef.current !== sessionId
        ) {
          return;
        }

        const finalParts = [];
        const interimParts = [];

        for (let resultIndex = 0; resultIndex < event.results.length; resultIndex += 1) {
          const result = event.results[resultIndex];
          if (!result) continue;

          let selectedTranscript = '';
          let selectedScore = -1;

          for (
            let alternativeIndex = 0;
            alternativeIndex < Math.min(result.length || 0, 3);
            alternativeIndex += 1
          ) {
            const alternative = result[alternativeIndex];
            const transcript = String(alternative?.transcript || '').trim();
            if (!transcript) continue;

            const detectedLanguage = detectTranscriptLanguage(transcript);
            const confidence = Number(alternative?.confidence || 0);
            const languageBonus =
              detectedLanguage === activeLanguage
                ? 2
                : detectedLanguage
                  ? 1
                  : 0;
            const score = languageBonus + confidence;

            if (score > selectedScore) {
              selectedScore = score;
              selectedTranscript = transcript;
            }
          }

          if (!selectedTranscript) continue;

          if (result.isFinal) {
            finalParts.push(selectedTranscript);
          } else {
            interimParts.push(selectedTranscript);
          }
        }

        const sessionTranscript = [...finalParts, ...interimParts].join(' ').trim();
        if (!sessionTranscript) return;

        producedTranscript = true;

        const detectedLanguage = detectTranscriptLanguage(sessionTranscript);
        if (!lockedLanguage) {
          lockedLanguage = detectedLanguage || activeLanguage;
          const detectedIndex = languageOrder.indexOf(lockedLanguage);
          if (detectedIndex >= 0) {
            languageIndex = detectedIndex;
          }
          localeIndex = 0;
        }

        const nextValue = clampText(
          appendSpeech(sessionBaseValue, sessionTranscript),
          maxLengthRef.current,
        );

        valueRef.current = nextValue;
        onChangeRef.current?.(nextValue);
        setError('');
      };

      recognition.onerror = (event) => {
        if (
          recognitionRef.current !== recognition ||
          sessionRef.current !== sessionId
        ) {
          return;
        }

        const code = String(event?.error || '');

        if (code === 'no-speech' || code === 'aborted') {
          return;
        }

        if (code === 'language-not-supported') {
          if (localeIndex < activeLocales.length - 1) {
            localeIndex += 1;
            retryDifferentLocale = true;
            return;
          }

          if (!lockedLanguage) {
            switchToNextLanguage();
            retryDifferentLocale = true;
            return;
          }

          fatalError = true;
          shouldListenRef.current = false;
          setIsListening(false);
          setError(recognitionErrorMessage(code));
          return;
        }

        fatalError = true;
        shouldListenRef.current = false;
        setIsListening(false);
        setError(recognitionErrorMessage(code));
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }

        if (!mountedRef.current || sessionRef.current !== sessionId) return;

        if (shouldListenRef.current && !fatalError && !disabledRef.current) {
          if (!lockedLanguage && !producedTranscript && !retryDifferentLocale) {
            switchToNextLanguage();
          }

          setIsListening(true);
          scheduleRestart(retryDifferentLocale ? 70 : producedTranscript ? 90 : 120);
          return;
        }

        setIsListening(false);
      };

      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
        shouldListenRef.current = false;
        setIsListening(false);
        setError('The microphone could not start. Please try again.');
      }
    };

    beginRecognition();
    return true;
  }, [clearRestartTimer]);

  const toggle = useCallback(() => {
    if (shouldListenRef.current || startingRef.current || isListening) {
      stop();
      return false;
    }

    return start();
  }, [isListening, start, stop]);

  const clearError = useCallback(() => setError(''), []);

  useEffect(() => {
    if (disabled && (shouldListenRef.current || startingRef.current)) {
      stop();
    }
  }, [disabled, stop]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      shouldListenRef.current = false;
      startingRef.current = false;
      sessionRef.current += 1;
      clearRestartTimer();

      const recognition = recognitionRef.current;
      recognitionRef.current = null;

      if (!recognition) return;

      detachRecognition(recognition);

      try {
        recognition.abort();
      } catch {
      }
    };
  }, [clearRestartTimer, detachRecognition]);

  return {
    isSupported,
    isListening,
    error,
    hint: '',
    language: 'AUTO',
    start,
    stop,
    toggle,
    clearError,
  };
}
