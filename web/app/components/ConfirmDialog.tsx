"use client";

import { useEffect, useId, useRef } from "react";

// A shared popup that asks the visitor to confirm one action, built on the browser's own dialog.
// The safe choice (cancel) has focus first. Escape and a click outside the popup both mean cancel.
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      safe.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={box}
      className="confirmbox"
      aria-labelledby={messageId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => e.target === box.current && onCancel()}
    >
      <p id={messageId} className="confirmbox__msg">
        {message}
      </p>
      <div className="confirmbox__actions">
        <button ref={safe} type="button" className="btn outline" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
