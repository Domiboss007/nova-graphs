import { useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';

/**
 * Returns [ref, downloadFn].
 * Attach `ref` to the DOM element you want to capture.
 * Call `downloadFn()` to trigger a PNG download.
 * The download button itself should be placed OUTSIDE the ref element
 * so it doesn't appear in the exported image.
 */
export function usePngDownload(filename) {
  const ref = useRef(null);

  const download = useCallback(() => {
    if (!ref.current) return;
    toPng(ref.current, { backgroundColor: '#ffffff', pixelRatio: 2 })
      .then(url => {
        const a = document.createElement('a');
        a.download = filename.replace(/[^a-z0-9._-]/gi, '_');
        a.href = url;
        a.click();
      })
      .catch(console.error);
  }, [filename]);

  return [ref, download];
}
