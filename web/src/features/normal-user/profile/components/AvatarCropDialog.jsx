import { Check, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const OUTPUT_SIZE = 512;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image preview could not be loaded.'));
    image.src = url;
  });
}

export default function AvatarCropDialog({ file, onCancel, onConfirm }) {
  const canvasRef = useRef(null);
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  const createCroppedFile = async () => {
    const image = await loadImage(previewUrl);
    const sourceSquare = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
    const sourceX = (image.naturalWidth - sourceSquare) / 2;
    const sourceY = (image.naturalHeight - sourceSquare) / 2;
    const canvas = canvasRef.current;
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, sourceX, sourceY, sourceSquare, sourceSquare, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) throw new Error('The cropped image could not be created.');
    return new File([blob], 'avatar.webp', { type: 'image/webp' });
  };

  return (
    <div className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-label="Crop profile image">
      <div className="avatar-crop-dialog__card">
        <div className="avatar-crop-dialog__head">
          <div><strong>Crop your photo</strong><span>The center square becomes your avatar.</span></div>
          <button type="button" onClick={onCancel} aria-label="Close"><X size={19} /></button>
        </div>

        <div className="avatar-crop-dialog__preview">
          <img src={previewUrl} alt="Avatar crop preview" style={{ transform: `scale(${zoom})` }} />
          <i aria-hidden="true" />
        </div>

        <label className="avatar-crop-dialog__zoom">
          <span>Zoom</span>
          <input type="range" min="1" max="2.5" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>

        {error ? <p className="profile-settings__error">{error}</p> : null}

        <div className="avatar-crop-dialog__actions">
          <button type="button" className="is-secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              try {
                setSaving(true);
                setError('');
                await onConfirm(await createCroppedFile());
              } catch (requestError) {
                setError(requestError.message);
                setSaving(false);
              }
            }}
          >
            <Check size={17} /> {saving ? 'Uploading...' : 'Use photo'}
          </button>
        </div>
        <canvas ref={canvasRef} hidden />
      </div>
    </div>
  );
}