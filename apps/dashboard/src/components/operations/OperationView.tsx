import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AgentFeed } from '../../agent/feed-types.js';
import { operationState, stages } from './model.js';
const Scene = lazy(() => import('./OperationScene.js'));
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function OperationView({ feed }: { feed: AgentFeed | null }) {
  const [selected, select] = useState('evidence');
  const [threeD, setThreeD] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const detect = () => {
      if (motion?.matches) {
        setSupported(false);
        setThreeD(false);
        return;
      }
      if (typeof WebGLRenderingContext === 'undefined') return;
      try {
        const canvas = document.createElement('canvas');
        const context =
          canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const ok = !!context;
        context?.getExtension('WEBGL_lose_context')?.loseContext();
        setSupported(ok);
        setThreeD(ok);
      } catch {
        setSupported(false);
      }
    };
    detect();
    motion?.addEventListener('change', detect);
    return () => motion?.removeEventListener('change', detect);
  }, []);
  const node = stages.find((n) => n.id === selected)!;
  const status = operationState(feed, selected);
  const fallback = (
    <div className="operation-map" aria-label="Operations map">
      {stages.map((stage, i) => (
        <button
          className={selected === stage.id ? 'selected' : ''}
          key={stage.id}
          onClick={() => select(stage.id)}
        >
          <span className="micro-label">
            0{i + 1} / {stage.type}
          </span>
          <strong>{stage.label}</strong>
          <small>{operationState(feed, stage.id).label}</small>
        </button>
      ))}
    </div>
  );
  return (
    <section className="operations-section" aria-label="Agent operations">
      <p className="micro-label">COMPANIONS / EXECUTION STAGES</p>
      <div className="role-strip">
        {stages.map((stage) => (
          <button
            className={selected === stage.id ? 'selected' : ''}
            key={stage.id}
            onClick={() => select(stage.id)}
            aria-pressed={selected === stage.id}
          >
            <span>
              {stage.label}
              <small>{stage.type}</small>
            </span>
            <b className="micro-label">
              {operationState(feed, stage.id).label}
            </b>
            <p>{stage.detail}</p>
          </button>
        ))}
      </div>
      <div className="operations-toolbar">
        <span className="micro-label">
          {feed?.state.mode === 'demo'
            ? 'ILLUSTRATIVE ROLE LAYOUT · NOT LIVE EXECUTION'
            : feed
              ? 'OPERATIONS · OBSERVED EVENTS ONLY'
              : 'OPERATIONS · FEED UNAVAILABLE'}
        </span>
        <button
          className="text-action"
          onClick={() => setThreeD((v) => !v)}
          disabled={!supported}
        >
          {threeD ? '2D view' : supported ? '3D view' : '2D fallback'}
        </button>
      </div>
      <div className="operations-visual">
        {threeD ? (
          <SceneBoundary fallback={fallback}>
            <Suspense
              fallback={
                <p className="scene-loading">Loading operations scene…</p>
              }
            >
              <Scene
                selected={selected}
                select={select}
                example={feed?.state.mode === 'demo'}
                onUnavailable={() => {
                  setThreeD(false);
                  setSupported(false);
                }}
                observed={stages.map(
                  (s) => operationState(feed, s.id).observed,
                )}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          fallback
        )}
      </div>
      <div className="operation-detail" aria-live="polite">
        <span className="eyebrow">
          {node.type} / {node.label}
        </span>
        <h3>{status.label}</h3>
        <p>{node.detail}</p>
        <p>{status.detail}</p>
        {selected === 'evidence' && (
          <a href="#/evidence">Inspect market evidence →</a>
        )}
        {selected === 'receipt' && (
          <a href="#/activity">Inspect receipts & verify →</a>
        )}
      </div>
    </section>
  );
}
