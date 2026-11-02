import { useEffect, useRef, useState } from 'react';
export function Header({
  demo,
  activeRoute,
}: {
  demo: boolean;
  onDesk?: () => void;
  activeRoute?: string;
}) {
  const [menu, setMenu] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menu) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [menu]);
  const close = () => {
    setMenu(false);
    trigger.current?.focus();
  };
  const entries = [
    ['overview', 'Overview'],
    ['mandate', 'Mandate'],
    ['activity', 'Activity'],
    ['agent', 'Agent'],
    ['operations', 'Operations 3D'],
    ['evidence', 'Market'],
    ['desk', 'Copilot'],
  ];
  const links = (
    <>
      {entries.map(([route, label]) => (
        <a
          key={route}
          href={`#/${route}`}
          aria-current={activeRoute === route ? 'page' : undefined}
          onClick={close}
        >
          {label}
        </a>
      ))}
      <details className="advanced-nav">
        <summary>Advanced</summary>
        <div>
          <a href="#/verify" onClick={close}>
            Verify receipt
          </a>
        </div>
      </details>
    </>
  );
  const modeUrl = new URL(window.location.href);
  modeUrl.searchParams.set('demo', demo ? '0' : '1');
  return (
    <header className="workspace-header">
      <a
        className="skip-link"
        href="#workspace-main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('workspace-main');
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <div className="workspace-topbar">
        <a className="wordmark" href="#/home">
          NALVIS
        </a>
        <nav className="desktop-navigation" aria-label="Dashboard views">
          {links}
        </nav>
        <div className="workspace-tools">
          <a
            className="mode-link"
            href={modeUrl.pathname + modeUrl.search + modeUrl.hash}
          >
            {demo ? 'Switch to Live' : 'Watch Demo'}
          </a>
          <a
            className="text-action desk-top"
            href="#/desk"
          >
            Nalvis Copilot
          </a>
          <a className="button primary-setup" href="#/setup">
            Set mandate
          </a>
          <button
            className="secondary mobile-menu"
            ref={trigger}
            aria-expanded={menu}
            aria-controls="workspace-navigation"
            onClick={() => setMenu(true)}
          >
            Menu
          </button>
        </div>
      </div>
      <dialog
        id="workspace-navigation"
        ref={dialog}
        className="navigation-dialog"
        aria-label="Workspace navigation"
        onCancel={close}
        onClose={close}
      >
        <div className="dialog-heading">
          <span className="wordmark">NALVIS</span>
          <button className="secondary" onClick={close}>
            Close navigation
          </button>
        </div>
        <nav aria-label="Mobile dashboard views">{menu && links}</nav>
      </dialog>
    </header>
  );
}
