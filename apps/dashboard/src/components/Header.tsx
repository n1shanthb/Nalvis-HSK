import { useEffect, useRef, useState } from 'react';
import { ConnectLedger } from '../owner/ConnectLedger.js';
export function Header({
  demo,
  onDesk,
  activeRoute,
}: {
  demo: boolean;
  onDesk: () => void;
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
  const links = (
    <>
      <span className="nav-label">WORKSPACE</span>
      {['Agent', 'Mandate', 'Verify'].map((label, i) => (
        <a
          aria-current={
            activeRoute === label.toLowerCase() ? 'page' : undefined
          }
          key={label}
          href={`#/${label.toLowerCase()}`}
          onClick={close}
        >
          <span className="nav-number" aria-hidden="true">
            0{i + 1}
          </span>
          {label}
        </a>
      ))}
    </>
  );
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
      <aside className="workspace-sidebar">
        <a className="wordmark" href="#/home">
          <span className="brand-mark">N</span>NALVIS
        </a>
        <nav aria-label="Dashboard views">{links}</nav>
        <div className="sidebar-note">
          <span className="nav-label">BOUNDED BY YOU</span>
          <p>
            Owner authority.
            <br />
            Verifiable execution.
          </p>
        </div>
        <a className="sidebar-home" href="#/home">
          About the protocol ↗
        </a>
      </aside>
      <div className="workspace-topbar">
        <button
          className="secondary mobile-menu"
          ref={trigger}
          aria-expanded={menu}
          aria-controls="workspace-navigation"
          onClick={() => setMenu(true)}
        >
          Menu
        </button>
        <div className="workspace-context">
          <span className="micro-label">WORKSPACE / {activeRoute}</span>
          <span className="environment-label">
            {demo ? 'Recorded demo · 31337' : 'Testnet · 133'}
          </span>
        </div>
        <div className="workspace-tools">
          <a className="mode-link" href={demo ? '?#/agent' : '?demo=1#/agent'}>
            {demo ? 'Switch to Live' : 'Watch Demo'}
          </a>
          <button className="secondary" data-desk-trigger onClick={onDesk}>
            AI desk
          </button>
          {!demo && <ConnectLedger />}
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
