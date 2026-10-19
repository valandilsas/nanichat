'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import {
  FACEBOOK_PERMISSIONS, PERMISSIONS_CAVEAT, PERMISSIONS_COUNT_NOTE, PERMISSIONS_LINK, PERMISSIONS_LINK_LABEL, PERMISSIONS_NOTE, PERMISSIONS_TITLE,
  USAGE_LABELS, filterPermissions,
} from './permissions-info';
import { externalLinkAttrs } from './tutorial/view';

// Read-only reference card: no API calls and nothing stored. Rows are not rendered while collapsed.
export function PermissionsInfoSection({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState('');
  const rows = filterPermissions(FACEBOOK_PERMISSIONS, query);
  return <section className="perm-block" aria-labelledby="fb-permissions-title">
    <h3 id="fb-permissions-title" className="perm-heading">
      <button type="button" className="perm-toggle" aria-expanded={open} aria-controls="fb-permissions-panel" onClick={() => setOpen((value) => !value)}>
        <ChevronDown size={16} aria-hidden="true" className={open ? 'tutorial-chevron open' : 'tutorial-chevron'} />
        <span>{PERMISSIONS_TITLE}</span>
      </button>
    </h3>
    {open && <div id="fb-permissions-panel" className="perm-panel">
      <p className="hint">{PERMISSIONS_NOTE}</p>
      <p className="hint">{PERMISSIONS_COUNT_NOTE}</p>
      <label className="field"><span>Buscar permiso</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o descripción" autoComplete="off" /></label>
      {rows.length ? <ul className="perm-list">{rows.map((entry) => <li className="perm-row" key={entry.name}>
        <div className="perm-name"><code className="mono">{entry.name}</code><span className={`perm-badge perm-${entry.usage}`}>{USAGE_LABELS[entry.usage]}</span>{!entry.confirmed && <span className="tutorial-unverified">por verificar</span>}</div>
        <p className="perm-desc">{entry.description}</p>
      </li>)}</ul> : <p className="hint" role="status">No hay permisos que coincidan con la búsqueda.</p>}
      <p className="hint">{PERMISSIONS_CAVEAT}</p>
      <a className="btn small perm-link" href={PERMISSIONS_LINK} {...externalLinkAttrs()}><ExternalLink size={13} aria-hidden="true" /> {PERMISSIONS_LINK_LABEL}<span className="sr-only"> (se abre en una pestaña nueva)</span></a>
    </div>}
  </section>;
}
