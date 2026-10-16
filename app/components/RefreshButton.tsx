import { RefreshCw } from 'lucide-react';

/** Global "reload data" control for the topbar: icon only, spins and is busy while a refresh is in flight. */
export function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh(): void }) {
  return <button type="button" className="btn-icon refresh-button" aria-label="Actualizar datos" title="Actualizar datos" aria-busy={loading} disabled={loading} onClick={onRefresh}>
    <RefreshCw size={17} aria-hidden="true" className={loading ? 'spinning' : undefined} />
  </button>;
}
