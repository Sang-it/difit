import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { ImageDiffViewer } from './ImageDiffViewer';
import type { DiffViewerBodyProps } from './types';

describe('ImageDiffViewer', () => {
  const baseProps: Omit<DiffViewerBodyProps, 'file'> = {
    threads: [],
    diffMode: 'unified',
    mergedChunks: [],
    isExpandLoading: false,
    expandHiddenLines: vi.fn().mockResolvedValue(undefined),
    expandAllBetweenChunks: vi.fn().mockResolvedValue(undefined),
    onAddComment: vi.fn().mockResolvedValue(undefined),
    onGenerateThreadPrompt: vi.fn(),
    onRemoveThread: vi.fn(),
    onReplyToThread: vi.fn().mockResolvedValue(undefined),
    onRemoveMessage: vi.fn(),
    onUpdateMessage: vi.fn(),
  };

  const renderViewer = (file: DiffFile, overrides: Partial<DiffViewerBodyProps> = {}) =>
    render(<ImageDiffViewer {...baseProps} file={file} {...overrides} />);

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { __DIFIT_STATIC_BLOB_URLS__?: Record<string, string> })
      .__DIFIT_STATIC_BLOB_URLS__;
    // Mock fetch to return a blob with size
    (global.fetch as any).mockResolvedValue({
      blob: () => Promise.resolve({ size: 1024 }),
    });
  });

  describe('File status handling', () => {
    it('renders deleted image correctly', () => {
      const deletedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'deleted',
        additions: 0,
        deletions: 1,
        chunks: [],
      };

      renderViewer(deletedFile);

      expect(screen.getByText('Deleted Image')).toBeInTheDocument();
      expect(screen.getByText('Previous version:')).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD~1');
    });

    it('renders added image correctly', () => {
      const addedFile: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };

      renderViewer(addedFile);

      expect(screen.getByText('Added Image')).toBeInTheDocument();
      expect(screen.getByText('New file:')).toBeInTheDocument();
      expect(screen.getByRole('img')).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD');
    });

    it('renders modified image correctly in split mode', () => {
      const modifiedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(modifiedFile, { diffMode: 'split' });

      expect(screen.getByText('Modified Image')).toBeInTheDocument();
      expect(screen.getByText('Previous version:')).toBeInTheDocument();
      expect(screen.getByText('Current version:')).toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(2);
    });

    it('shows image compare controls for modified images', () => {
      const modifiedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(modifiedFile);

      expect(screen.getByRole('button', { name: '2-up' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stacked' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Swipe' })).toBeInTheDocument();
    });

    it('does not show image compare controls for added or deleted images', () => {
      const addedFile: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };
      const { rerender } = render(<ImageDiffViewer {...baseProps} file={addedFile} />);

      expect(screen.queryByRole('button', { name: 'Swipe' })).not.toBeInTheDocument();

      const deletedFile: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'deleted',
        additions: 0,
        deletions: 1,
        chunks: [],
      };
      rerender(<ImageDiffViewer {...baseProps} file={deletedFile} />);

      expect(screen.queryByRole('button', { name: 'Swipe' })).not.toBeInTheDocument();
    });

    it('handles renamed image correctly', () => {
      const renamedFile: DiffFile = {
        path: 'new-name.jpg',
        oldPath: 'old-name.jpg',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        chunks: [],
      };

      renderViewer(renamedFile);

      expect(screen.getByText('Modified Image')).toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-name.jpg?ref=HEAD~1');
      expect(images[1]).toHaveAttribute('src', '/api/blob/new-name.jpg?ref=HEAD');
    });
  });

  describe('Swipe image comparison', () => {
    it('renders a swipe comparison frame with both image versions', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file);
      fireEvent.click(screen.getByRole('button', { name: 'Swipe' }));

      const comparison = screen.getByTestId('image-swipe-comparison');
      const overlay = screen.getByTestId('image-swipe-overlay');
      const currentBorder = screen.getByTestId('image-swipe-current-border');
      const previousBorder = screen.getByTestId('image-swipe-previous-border');
      const divider = screen.getByTestId('image-swipe-divider');

      expect(comparison).toBeInTheDocument();
      expect(currentBorder).toHaveClass('inset-0', 'border-y-2', 'border-github-accent');
      expect(currentBorder).not.toHaveClass('border-2');
      expect(previousBorder).toHaveClass('inset-0', 'border-y-2', 'border-github-danger');
      expect(previousBorder).not.toHaveClass('border-2');
      expect(overlay).toHaveClass('inset-0');
      expect(divider).toHaveClass('w-0', 'border-l', 'border-black');
      expect(divider).not.toHaveClass('w-0.5', 'bg-github-text-primary');
      expect(screen.getByLabelText('Swipe reveal amount')).toHaveValue('0');
      expect(screen.queryByText('Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Current')).not.toBeInTheDocument();

      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD');
      expect(images[1]).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD~1');
    });

    it('updates the clipped overlay when the swipe slider changes', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file);
      fireEvent.click(screen.getByRole('button', { name: 'Swipe' }));

      fireEvent.change(screen.getByLabelText('Swipe reveal amount'), {
        target: { value: '70' },
      });

      expect(screen.getByTestId('image-swipe-overlay')).toHaveAttribute(
        'style',
        expect.stringContaining('clip-path: inset(0 30% 0 0)'),
      );
    });

    it('supports SVG files through the same image swipe view', () => {
      const file: DiffFile = {
        path: 'vector.svg',
        oldPath: 'vector.svg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file, { baseCommitish: 'main', targetCommitish: 'feature' });
      fireEvent.click(screen.getByRole('button', { name: 'Swipe' }));

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/vector.svg?ref=feature');
      expect(images[1]).toHaveAttribute('src', '/api/blob/vector.svg?ref=main');
    });
  });

  describe('Image loading with custom refs', () => {
    it('sets correct image src URLs with custom commitish', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'old-test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file, { baseCommitish: 'main', targetCommitish: 'feature' });

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-test.jpg?ref=main');
      expect(images[1]).toHaveAttribute('src', '/api/blob/test.jpg?ref=feature');
    });

    it('uses default refs when not provided', () => {
      const file: DiffFile = {
        path: 'test.jpg',
        oldPath: 'old-test.jpg',
        status: 'modified',
        additions: 1,
        deletions: 1,
        chunks: [],
      };

      renderViewer(file);

      const images = screen.getAllByRole('img');
      expect(images[0]).toHaveAttribute('src', '/api/blob/old-test.jpg?ref=HEAD~1');
      expect(images[1]).toHaveAttribute('src', '/api/blob/test.jpg?ref=HEAD');
    });

    it('uses static blob URLs when available', () => {
      (
        window as Window & { __DIFIT_STATIC_BLOB_URLS__?: Record<string, string> }
      ).__DIFIT_STATIC_BLOB_URLS__ = {
        'abcdef1:test.jpg': '/difit/site-data/blobs/abcdef1/test.jpg',
      };
      const file: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };

      renderViewer(file, { targetCommitish: 'abcdef1234567890' });

      expect(screen.getByRole('img')).toHaveAttribute(
        'src',
        '/difit/site-data/blobs/abcdef1/test.jpg',
      );
    });
  });

  describe('Image information display', () => {
    it('shows image dimensions and file size when available', async () => {
      const file: DiffFile = {
        path: 'test.jpg',
        status: 'added',
        additions: 1,
        deletions: 0,
        chunks: [],
      };

      renderViewer(file);

      const image = screen.getByRole('img');

      // Mock naturalWidth and naturalHeight
      Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
      Object.defineProperty(image, 'naturalHeight', { value: 600, configurable: true });

      // Simulate image load
      const loadEvent = new Event('load');
      image.dispatchEvent(loadEvent);

      // Wait for the state to update and info to be displayed
      await waitFor(() => {
        expect(screen.getByText(/W: 800px \| H: 600px/)).toBeInTheDocument();
        expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
      });
    });
  });
});
