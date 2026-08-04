/**
 * Premium profile-image crop dialog.
 *
 * Uses FileReader instead of a temporary object URL so React StrictMode cannot
 * revoke the preview URL during development and leave a broken image.
 *
 * @author Malak
 */

import {
  Check,
  Image as ImageIcon,
  LoaderCircle,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import {
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const OUTPUT_SIZE = 512;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () =>
      resolve(String(reader.result));

    reader.onerror = () =>
      reject(
        new Error(
          'The selected image could not be read.',
        ),
      );

    reader.readAsDataURL(file);
  });
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);

    image.onerror = () =>
      reject(
        new Error(
          'The image preview could not be loaded.',
        ),
      );

    image.src = source;
  });
}

export default function AvatarCropDialog({
  file,
  onCancel,
  onConfirm,
}) {
  const shouldReduceMotion = useReducedMotion();
  const canvasRef = useRef(null);

  const [previewSource, setPreviewSource] =
    useState('');
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    readFileAsDataUrl(file)
      .then((source) => {
        if (active) {
          setPreviewSource(source);
        }
      })
      .catch((readError) => {
        if (active) {
          setError(readError.message);
        }
      });

    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel, saving]);

  const createCroppedFile = async () => {
    if (!previewSource) {
      throw new Error(
        'Wait until the image preview is ready.',
      );
    }

    const image = await loadImage(previewSource);
    const sourceSquare =
      Math.min(
        image.naturalWidth,
        image.naturalHeight,
      ) / zoom;

    const sourceX =
      (image.naturalWidth - sourceSquare) / 2;

    const sourceY =
      (image.naturalHeight - sourceSquare) / 2;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      throw new Error(
        'The crop canvas is unavailable.',
      );
    }

    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    context.clearRect(
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSquare,
      sourceSquare,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE,
    );

    const blob = await new Promise((resolve) => {
      canvas.toBlob(
        resolve,
        'image/webp',
        0.9,
      );
    });

    if (!blob) {
      throw new Error(
        'The cropped image could not be created.',
      );
    }

    return new File(
      [blob],
      'avatar.webp',
      {
        type: 'image/webp',
        lastModified: Date.now(),
      },
    );
  };

  const updateZoom = (nextZoom) => {
    setZoom(
      Math.max(
        1,
        Math.min(2.5, nextZoom),
      ),
    );
  };

  return createPortal(
    <motion.div
      className="avatar-crop-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onCancel();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Crop profile image"
      initial={
        shouldReduceMotion
          ? undefined
          : { opacity: 0 }
      }
      animate={{ opacity: 1 }}
      exit={
        shouldReduceMotion
          ? undefined
          : { opacity: 0 }
      }
    >
      <motion.div
        className="avatar-crop-dialog__card"
        initial={
          shouldReduceMotion
            ? undefined
            : {
                opacity: 0,
                y: 22,
                scale: 0.975,
              }
        }
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        transition={{
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div className="avatar-crop-dialog__head">
          <div className="avatar-crop-dialog__title">
            <span>
              <ImageIcon size={15} />
              Avatar studio
            </span>

            <strong>Crop your photo</strong>

            <small>
              The centered square becomes your Voxidence avatar.
            </small>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={19} />
          </button>
        </div>

        <div className="avatar-crop-dialog__stage">
          <div className="avatar-crop-dialog__preview">
            {previewSource ? (
              <img
                src={previewSource}
                alt="Avatar crop preview"
                style={{
                  transform: `scale(${zoom})`,
                }}
              />
            ) : (
              <LoaderCircle
                className="profile-settings__spin"
                size={34}
              />
            )}

            <i aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        </div>

        <div className="avatar-crop-dialog__zoom">
          <div>
            <span>Zoom</span>
            <strong>{zoom.toFixed(2)}×</strong>
          </div>

          <div className="avatar-crop-dialog__zoom-control">
            <button
              type="button"
              onClick={() =>
                updateZoom(zoom - 0.05)
              }
              aria-label="Zoom out"
            >
              <Minus size={16} />
            </button>

            <input
              type="range"
              min="1"
              max="2.5"
              step="0.05"
              value={zoom}
              onChange={(event) =>
                setZoom(
                  Number(event.target.value),
                )
              }
            />

            <button
              type="button"
              onClick={() =>
                updateZoom(zoom + 0.05)
              }
              aria-label="Zoom in"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {error ? (
          <p className="profile-settings__error">
            {error}
          </p>
        ) : null}

        <div className="avatar-crop-dialog__actions">
          <button
            type="button"
            className="is-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={
              saving || !previewSource
            }
            onClick={async () => {
              try {
                setSaving(true);
                setError('');

                await onConfirm(
                  await createCroppedFile(),
                );
              } catch (requestError) {
                setError(
                  requestError?.message ||
                    'The photo could not be prepared.',
                );

                setSaving(false);
              }
            }}
          >
            {saving ? (
              <LoaderCircle
                className="profile-settings__spin"
                size={17}
              />
            ) : (
              <Check size={17} />
            )}

            {saving
              ? 'Uploading...'
              : 'Use photo'}
          </button>
        </div>

        <canvas
          ref={canvasRef}
          hidden
        />
      </motion.div>
    </motion.div>,
    document.body,
  );
}