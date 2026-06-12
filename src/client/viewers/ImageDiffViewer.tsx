import { Columns2, MoveHorizontal, Rows2 } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';

import type { DiffViewerBodyProps } from './types';

interface ImageInfo {
  width?: number;
  height?: number;
  size?: number;
}

type ImageCompareMode = '2-up' | 'stacked' | 'swipe';

type ImageVersion = {
  label: string;
  src: string;
  alt: string;
  info: ImageInfo;
  onImageInfo: (info: ImageInfo) => void;
};

interface StaticBlobWindow {
  __DIFIT_STATIC_BLOB_URLS__?: Record<string, string>;
}

const blobKey = (ref: string, path: string): string => `${ref.slice(0, 7)}:${path}`;

const imageBlobUrl = (path: string, ref: string): string => {
  const staticBlobUrls = (window as Window & StaticBlobWindow).__DIFIT_STATIC_BLOB_URLS__;
  return staticBlobUrls?.[blobKey(ref, path)] ?? `/api/blob/${path}?ref=${ref}`;
};

const checkerboardStyle: CSSProperties = {
  backgroundImage: `
      linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),
      linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)
    `,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 10px 10px',
  backgroundColor: 'white',
};

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDimensions = (info: ImageInfo): string => {
  if (!info.width || !info.height) return '';
  return `W: ${info.width}px | H: ${info.height}px`;
};

const formatImageInfo = (info: ImageInfo): string => {
  const dimensions = formatDimensions(info);
  const size = formatFileSize(info.size);
  if (dimensions && size) return `${dimensions} | ${size}`;
  return dimensions || size;
};

const handleImageLoad = async (img: HTMLImageElement, setImageInfo: (info: ImageInfo) => void) => {
  try {
    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const response = await fetch(img.src);
    const blob = await response.blob();
    const size = blob.size;

    setImageInfo({ width, height, size });
  } catch (error) {
    console.error('Failed to get image info:', error);
  }
};

const getDefaultCompareMode = (diffMode: DiffViewerBodyProps['diffMode']): ImageCompareMode =>
  diffMode === 'split' ? '2-up' : 'stacked';

const getSwipeAspectRatio = (oldImageInfo: ImageInfo, newImageInfo: ImageInfo): string => {
  const width = newImageInfo.width ?? oldImageInfo.width;
  const height = newImageInfo.height ?? oldImageInfo.height;

  if (width && height) {
    return `${width} / ${height}`;
  }

  return '16 / 9';
};

type ImageCardProps = {
  image: ImageVersion;
  className?: string;
};

const ImageCard = ({ image, className = '' }: ImageCardProps) => {
  const [hasError, setHasError] = useState(false);
  const imageInfo = formatImageInfo(image.info);

  return (
    <div
      className={`border border-github-border rounded-md p-4 bg-github-bg-secondary ${className}`}
    >
      <div className="text-github-text-muted mb-2" style={{ fontSize: '14px' }}>
        {image.label}
      </div>
      {!hasError && (
        <img
          src={image.src}
          alt={image.alt}
          className="max-w-full max-h-96 border border-github-border rounded mx-auto"
          style={checkerboardStyle}
          onLoad={(e) => void handleImageLoad(e.currentTarget, image.onImageInfo)}
          onError={() => setHasError(true)}
        />
      )}
      {hasError && (
        <div className="text-github-text-muted text-sm mt-2">Image could not be loaded</div>
      )}
      {imageInfo && (
        <div className="text-github-text-muted mt-2" style={{ fontSize: '14px' }}>
          {imageInfo}
        </div>
      )}
    </div>
  );
};

type ImageCompareModeControlProps = {
  mode: ImageCompareMode;
  onModeChange: (mode: ImageCompareMode) => void;
};

const imageCompareModeOptions = [
  { mode: '2-up', label: '2-up', title: 'Two-up image comparison', Icon: Columns2 },
  { mode: 'stacked', label: 'Stacked', title: 'Stacked image comparison', Icon: Rows2 },
  { mode: 'swipe', label: 'Swipe', title: 'Swipe image comparison', Icon: MoveHorizontal },
] as const;

const ImageCompareModeControl = ({ mode, onModeChange }: ImageCompareModeControlProps) => (
  <div className="flex bg-github-bg-tertiary border border-github-border rounded-md p-1">
    {imageCompareModeOptions.map(({ mode: optionMode, label, title, Icon }) => (
      <button
        key={optionMode}
        type="button"
        onClick={() => onModeChange(optionMode)}
        className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
          mode === optionMode
            ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
            : 'text-github-text-secondary hover:text-github-text-primary'
        }`}
        title={title}
      >
        <Icon size={14} />
        {label}
      </button>
    ))}
  </div>
);

type ImagePairProps = {
  previous: ImageVersion;
  current: ImageVersion;
};

const TwoUpImageCompare = ({ previous, current }: ImagePairProps) => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div className="text-center">
      <ImageCard image={previous} />
    </div>
    <div className="text-center">
      <ImageCard image={current} />
    </div>
  </div>
);

const StackedImageCompare = ({ previous, current }: ImagePairProps) => (
  <div className="space-y-6">
    <div className="text-center">
      <ImageCard image={previous} className="inline-block" />
    </div>
    <div className="text-center">
      <ImageCard image={current} className="inline-block" />
    </div>
  </div>
);

const SwipeImageCompare = ({ previous, current }: ImagePairProps) => {
  const [swipePosition, setSwipePosition] = useState(0);
  const [previousHasError, setPreviousHasError] = useState(false);
  const [currentHasError, setCurrentHasError] = useState(false);
  const aspectRatio = getSwipeAspectRatio(previous.info, current.info);
  const previousInfo = formatImageInfo(previous.info);
  const currentInfo = formatImageInfo(current.info);

  return (
    <div className="border border-github-border rounded-md p-4 bg-github-bg-secondary">
      <div
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded"
        data-testid="image-swipe-comparison"
        style={{ ...checkerboardStyle, aspectRatio }}
      >
        {!currentHasError && (
          <img
            src={current.src}
            alt={current.alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => void handleImageLoad(e.currentTarget, current.onImageInfo)}
            onError={() => setCurrentHasError(true)}
          />
        )}
        <div
          className="pointer-events-none absolute inset-0 border-y-2 border-github-accent"
          data-testid="image-swipe-current-border"
        />
        {!previousHasError && (
          <div
            className="absolute inset-0 overflow-hidden"
            data-testid="image-swipe-overlay"
            style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
          >
            <img
              src={previous.src}
              alt={previous.alt}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={(e) => void handleImageLoad(e.currentTarget, previous.onImageInfo)}
              onError={() => setPreviousHasError(true)}
            />
            <div
              className="pointer-events-none absolute inset-0 border-y-2 border-github-danger"
              data-testid="image-swipe-previous-border"
            />
          </div>
        )}
        <div
          className="absolute top-0 bottom-0 w-0 border-l border-black"
          data-testid="image-swipe-divider"
          style={{ left: `${swipePosition}%` }}
        >
          <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-github-border bg-github-bg-primary text-github-text-primary shadow">
            <MoveHorizontal size={18} />
          </div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={swipePosition}
          aria-label="Swipe reveal amount"
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          onChange={(event) => setSwipePosition(Number(event.target.value))}
        />
      </div>
      {(previousHasError || currentHasError) && (
        <div className="text-github-text-muted text-sm mt-2">Image could not be loaded</div>
      )}
      {(previousInfo || currentInfo) && (
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-github-text-muted">
          {previousInfo && <span>Previous: {previousInfo}</span>}
          {currentInfo && <span>Current: {currentInfo}</span>}
        </div>
      )}
    </div>
  );
};

const renderImageCompare = (
  compareMode: ImageCompareMode,
  previous: ImageVersion,
  current: ImageVersion,
) => {
  switch (compareMode) {
    case '2-up':
      return <TwoUpImageCompare previous={previous} current={current} />;
    case 'swipe':
      return <SwipeImageCompare previous={previous} current={current} />;
    case 'stacked':
      return <StackedImageCompare previous={previous} current={current} />;
  }
};

export function ImageDiffViewer({
  file,
  diffMode,
  baseCommitish,
  targetCommitish,
}: DiffViewerBodyProps) {
  const mode = diffMode ?? DEFAULT_DIFF_VIEW_MODE;
  const [compareMode, setCompareMode] = useState<ImageCompareMode>(() =>
    getDefaultCompareMode(mode),
  );
  const isDeleted = file.status === 'deleted';
  const isAdded = file.status === 'added';
  const isModified = file.status === 'modified' || file.status === 'renamed';

  const baseRef = baseCommitish || 'HEAD~1';
  const targetRef = targetCommitish || 'HEAD';
  const [oldImageInfo, setOldImageInfo] = useState<ImageInfo>({});
  const [newImageInfo, setNewImageInfo] = useState<ImageInfo>({});

  useEffect(() => {
    setCompareMode(getDefaultCompareMode(mode));
  }, [mode]);

  if (isDeleted) {
    const previousImage = {
      label: 'Previous version:',
      src: imageBlobUrl(file.oldPath || file.path, baseRef),
      alt: `Previous version of ${file.oldPath || file.path}`,
      info: oldImageInfo,
      onImageInfo: setOldImageInfo,
    };

    return (
      <div className="bg-github-bg-primary p-4">
        <div className="text-center">
          <div className="mb-2">
            <span className="text-github-danger font-medium">Deleted Image</span>
          </div>
          <ImageCard image={previousImage} className="inline-block" />
        </div>
      </div>
    );
  }

  if (isAdded) {
    const newImage = {
      label: 'New file:',
      src: imageBlobUrl(file.path, targetRef),
      alt: `New image ${file.path}`,
      info: newImageInfo,
      onImageInfo: setNewImageInfo,
    };

    return (
      <div className="bg-github-bg-primary p-4">
        <div className="text-center">
          <div className="mb-2">
            <span className="text-github-accent font-medium">Added Image</span>
          </div>
          <ImageCard image={newImage} className="inline-block" />
        </div>
      </div>
    );
  }

  if (isModified) {
    const previousImage = {
      label: 'Previous version:',
      src: imageBlobUrl(file.oldPath || file.path, baseRef),
      alt: `Previous version of ${file.oldPath || file.path}`,
      info: oldImageInfo,
      onImageInfo: setOldImageInfo,
    };
    const currentImage = {
      label: 'Current version:',
      src: imageBlobUrl(file.path, targetRef),
      alt: `Current version of ${file.path}`,
      info: newImageInfo,
      onImageInfo: setNewImageInfo,
    };

    return (
      <div className="bg-github-bg-primary p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-github-text-primary font-medium">Modified Image</span>
          <ImageCompareModeControl mode={compareMode} onModeChange={setCompareMode} />
        </div>
        {renderImageCompare(compareMode, previousImage, currentImage)}
      </div>
    );
  }

  return null;
}
