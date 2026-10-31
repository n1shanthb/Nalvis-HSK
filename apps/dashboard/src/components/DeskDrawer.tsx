import { useEffect, useRef, type ReactNode } from 'react';
export function DeskDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const trigger =
      document.querySelector<HTMLElement>('[data-desk-trigger]') ??
      (document.activeElement as HTMLElement);
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = panel.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary',
      );
      const first = items?.[0],
        last = items?.[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      trigger?.focus();
    };
  }, []);
  return (
    <div
      className="desk-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={panel}
        className="desk-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="AI desk"
      >
        {children}
      </aside>
    </div>
  );
}
