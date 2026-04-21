import { useRef, useState } from 'react';

export function DropZone({ label, accept, multiple = false, onFile, currentFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files) {
    const arr = Array.from(files);
    if (!arr.length) return;
    onFile(multiple ? arr[0] : arr[0]);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onInputChange(e) { handleFiles(e.target.files); }

  const fileLabel = currentFile ? currentFile.name : null;

  return (
    <div
      className={`drop-zone${dragging ? ' dragging' : ''}${currentFile ? ' has-file' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={onInputChange}
      />
      <div className="drop-icon">{currentFile ? '✔' : '📂'}</div>
      <div className="drop-label">{label}</div>
      {fileLabel
        ? <div className="drop-filename">{fileLabel}</div>
        : <div className="drop-hint">Click or drag & drop here</div>
      }
    </div>
  );
}
