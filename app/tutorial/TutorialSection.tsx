'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, ExternalLink, ImageOff, RotateCcw, ShieldAlert } from 'lucide-react';
import { COMING_SOON_PLATFORMS, PLACEHOLDER_NOTE, TUTORIALS, type TutorialPlatformId, type TutorialStep } from './content';
import { EMPTY_PROGRESS, type TutorialProgress, goTo, resetPlatform } from './progress';
import { advance, copyText, execCommandCopy, externalLinkAttrs, isSchematic, progressSummary, SCHEMATIC_NOTE, screenshotView, startIndex, stepStatus } from './view';

type Api = (path: string, method?: string, body?: Record<string, unknown>) => Promise<any>;
type Confirm = (options: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;

const BRAND_ICONS: Record<'instagram' | 'facebook' | 'tiktok', ReactNode> = {
  instagram: <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" /></svg>,
  facebook: <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M14 8.5V7c0-.8.2-1.2 1.3-1.2H17V3h-2.6C11.6 3 10.5 4.600 10.500 6.900V8.500H8.500V11.500H10.500V21H14V11.500H16.800L17.200 8.500Z" /></svg>,
  tiktok: <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4v10.500a3.500 3.500 0 1 1-3.500-3.500" /><path d="M14 4c.4 2.300 1.900 3.700 4.500 3.900" /></svg>,
};

export function TutorialSection({ api, confirm }: { api: Api; confirm: Confirm }) {
  const [progress, setProgress] = useState<TutorialProgress>(EMPTY_PROGRESS);
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [platform, setPlatform] = useState<TutorialPlatformId | null>(null);
  const [index, setIndex] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const progressRef = useRef(progress);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const loadedOnce = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Load once on open; any failure falls back to an empty (local) progress and never blocks the tutorial.
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    let cancelled = false;
    void api('/api/tutorial-progress')
      .then((value) => { if (!cancelled && value?.progress) { setProgress(value.progress); progressRef.current = value.progress; } })
      .catch(() => { if (!cancelled) setSaveFailed(true); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; loadedOnce.current = false; };
  }, [api]);

  const commit = useCallback((next: TutorialProgress) => {
    progressRef.current = next;
    setProgress(next);
    // Saves are chained so the last action always wins on the server.
    saveChain.current = saveChain.current
      .then(() => api('/api/tutorial-progress', 'PUT', next as unknown as Record<string, unknown>))
      .then(() => setSaveFailed(false))
      .catch(() => setSaveFailed(true));
  }, [api]);

  const steps: ReadonlyArray<TutorialStep> = platform ? TUTORIALS[platform].steps : [];
  const step = platform ? steps[index] : undefined;

  function open(next: TutorialPlatformId) {
    setPlatform(next);
    setIndex(startIndex(progressRef.current, next, TUTORIALS[next].steps));
    setPromptOpen(false);
    setCopyState('idle');
  }

  function jump(target: number) {
    if (!platform) return;
    setIndex(target);
    setPromptOpen(false);
    setCopyState('idle');
    commit(goTo(progressRef.current, platform, target));
  }

  function next() {
    if (!platform) return;
    const target = Math.min(steps.length - 1, index + 1);
    commit(advance(progressRef.current, platform, steps, index));
    setIndex(target);
    setPromptOpen(false);
    setCopyState('idle');
  }

  async function reset() {
    if (!platform) return;
    const label = TUTORIALS[platform].label;
    if (!(await confirm({ title: `Reiniciar el progreso de ${label}`, body: 'Se borrarán los pasos marcados como hechos de este tutorial y volverá al primer paso. No afecta sus conexiones ni cuentas.', confirmLabel: 'Reiniciar progreso', danger: true }))) return;
    commit(resetPlatform(progressRef.current, platform));
    setIndex(0);
    setPromptOpen(false);
  }

  async function copyPrompt(text: string) {
    const ok = await copyText(text, { clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : undefined, fallback: execCommandCopy });
    setCopyState(ok ? 'copied' : 'failed');
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  const summary = useMemo(() => platform ? progressSummary(progress, platform, steps, index) : null, [progress, platform, steps, index]);

  return <section className="tutorial-block" aria-labelledby="tutorial-title">
    <div className="section-h"><h3 id="tutorial-title">Tutorial</h3><p className="muted">Aprenda paso a paso a conseguir su token de Meta. Su avance se guarda en este equipo.</p></div>
    {saveFailed && <p className="hint tutorial-warning" role="status">No se pudo guardar o leer su avance; el tutorial sigue funcionando, pero podría no recordar dónde se quedó.</p>}
    {!platform || !step || !summary ? <div className="tutorial-cards">
      {(['instagram', 'facebook'] as const).map((id) => {
        const content = TUTORIALS[id];
        const resume = progressSummary(progress, id, content.steps, startIndex(progress, id, content.steps));
        const started = (progress.platforms[id]?.completed.length ?? 0) > 0 || (progress.platforms[id]?.currentStep ?? 0) > 0;
        return <button key={id} type="button" className="tutorial-card" disabled={!loaded} onClick={() => open(id)} aria-label={`Abrir el tutorial de ${content.label}${started ? `, ${resume.percent}% completado` : ''}`}>
          <span className="tutorial-card-icon" aria-hidden="true">{BRAND_ICONS[id]}</span>
          <span className="tutorial-card-text"><strong>{content.label}</strong><span className="muted">{started ? `${resume.label} · ${resume.percent}%` : `${content.steps.length} pasos`}</span></span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>;
      })}
      {COMING_SOON_PLATFORMS.map((soon) => <div key={soon.id} className="tutorial-card disabled" aria-disabled="true">
        <span className="tutorial-card-icon" aria-hidden="true">{BRAND_ICONS[soon.id]}</span>
        <span className="tutorial-card-text"><strong>{soon.label}</strong><span className="muted">Aún no disponible</span></span>
        <span className="tutorial-soon">Próximamente</span>
      </div>)}
    </div> : <div className="tutorial-view">
      <div className="tutorial-toolbar">
        <button type="button" className="btn small" onClick={() => setPlatform(null)}><ArrowLeft size={14} aria-hidden="true" /> Volver a las plataformas</button>
        <button type="button" className="btn small ghost" onClick={() => void reset()}><RotateCcw size={14} aria-hidden="true" /> Reiniciar progreso</button>
      </div>
      <div className="tutorial-progress">
        <div className="tutorial-progress-text"><strong>{TUTORIALS[platform!].label} · {summary.label}</strong><span className="muted">{summary.percent}% completado · {summary.completedCount} de {steps.length} pasos hechos</span></div>
        <div className="tutorial-bar" role="progressbar" aria-label={`Progreso del tutorial de ${TUTORIALS[platform!].label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}><span style={{ width: `${summary.percent}%` }} /></div>
      </div>
      <div className="tutorial-layout">
        <nav aria-label="Pasos del tutorial" className="tutorial-steps">
          <ol>{steps.map((item, position) => {
            const status = stepStatus(progress, platform!, steps, position, index);
            return <li key={item.id}><button type="button" className={`tutorial-step-link ${status}`} aria-current={position === index ? 'step' : undefined} onClick={() => jump(position)}>
              <span className="tutorial-step-mark" aria-hidden="true">{status === 'completed' ? <Check size={12} /> : position + 1}</span>
              <span>{item.title}{status === 'completed' && <span className="sr-only"> (hecho)</span>}</span>
            </button></li>;
          })}</ol>
        </nav>
        <article className="tutorial-step" aria-labelledby="tutorial-step-title">
          <header>
            <h4 id="tutorial-step-title">{step.title}</h4>
            {!step.verified && <span className="tutorial-unverified" title={step.verifyNote}>Paso por verificar</span>}
          </header>
          <p>{step.summary}</p>
          {!step.verified && step.verifyNote && <p className="hint tutorial-warning">{step.verifyNote}</p>}
          <div className="tutorial-why"><strong>Por qué importa</strong><p>{step.whyItMatters}</p></div>
          <h5>Qué hacer</h5>
          <ol className="tutorial-instructions">{step.instructions.map((line) => <li key={line}>{line}</li>)}</ol>
          {step.links.length > 0 && <div className="tutorial-links">{step.links.map((link) => <a key={link.url} className="btn small" href={link.url} {...externalLinkAttrs()}><ExternalLink size={13} aria-hidden="true" /> {link.label}<span className="sr-only"> (se abre en una pestaña nueva)</span></a>)}</div>}
          {step.notes.length > 0 && <div className="tutorial-notes" role="note">{step.notes.map((note) => <p key={note}><ShieldAlert size={14} aria-hidden="true" /> <span>{note}</span></p>)}</div>}
          <p className="tutorial-expected"><Check size={14} aria-hidden="true" /> {step.expectedResult}</p>
          <TutorialScreenshot step={step} />
          <div className="tutorial-help">
            <button type="button" className="btn small" aria-expanded={promptOpen} aria-controls="tutorial-help-panel" onClick={() => setPromptOpen((value) => !value)}><ChevronDown size={14} aria-hidden="true" className={promptOpen ? 'tutorial-chevron open' : 'tutorial-chevron'} /> Prompt de ayuda</button>
            {promptOpen && <div id="tutorial-help-panel" className="tutorial-help-panel">
              <p className="hint">Pegue este texto en cualquier asistente de IA si se atasca. {PLACEHOLDER_NOTE}</p>
              <textarea readOnly rows={12} value={step.helpPrompt} aria-label="Prompt de ayuda para este paso" onFocus={(event) => event.currentTarget.select()} />
              <div className="tutorial-help-actions">
                <button type="button" className="btn-main small" onClick={() => void copyPrompt(step.helpPrompt)}><Copy size={14} aria-hidden="true" /> Copiar prompt</button>
                <span role="status" aria-live="polite" className="hint">{copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'No se pudo copiar; seleccione el texto y cópielo a mano.' : ''}</span>
              </div>
            </div>}
          </div>
          <footer className="tutorial-nav">
            <button type="button" className="btn" disabled={index === 0} onClick={() => jump(index - 1)}><ArrowLeft size={15} aria-hidden="true" /> Anterior</button>
            <button type="button" className="btn-main" onClick={next}>{index === steps.length - 1 ? <><Check size={15} aria-hidden="true" /> Marcar como hecho y terminar</> : <>Siguiente <ArrowRight size={15} aria-hidden="true" /></>}</button>
          </footer>
          {index < steps.length - 1 && <p className="hint">«Siguiente» marca este paso como hecho.</p>}
        </article>
      </div>
    </div>}
  </section>;
}

function TutorialScreenshot({ step }: { step: TutorialStep }) {
  const view = screenshotView(step.screenshot);
  return view.kind === 'image'
    ? <figure className="tutorial-shot"><img src={view.src} alt={view.alt} loading="lazy" /><figcaption>{view.caption}{isSchematic(view.src) && <span className="tutorial-shot-note"> {SCHEMATIC_NOTE}</span>}</figcaption></figure>
    : <figure className="tutorial-shot placeholder"><div role="img" aria-label={`${view.label}: ${step.screenshot.alt}`}><ImageOff size={20} aria-hidden="true" /><strong>{view.label}</strong></div><figcaption>{view.caption}</figcaption></figure>;
}
