import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCompany, PRODUCT_NAME } from '../lib/company';
import { ALL_ROLES, ROLE_LABEL, type TeamRole } from '../../../shared/rbac';
import { MENU_ITEMS, menuCell, type MenuHidden, type MenuPage } from '../../../shared/menu';
import { MIN_ACCENT_CONTRAST, isHexColor, readableWithWhite } from '../../../shared/contrast';

/**
 * The Company page (admins): the company's logo and colors, and which menu
 * items each user level sees. See server/company/routes.ts.
 */

interface Customization {
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  menuHidden: MenuHidden;
}

/** What the app uses when the company has not picked a color. */
const DEFAULT_PRIMARY = '#1F3A5F';
const DEFAULT_ACCENT = '#1F2937';
const MAX_LOGO_BYTES = 300 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_SIDE = 512;

const card = 'bg-white rounded-xl border border-gray-200';
const primaryBtn = 'inline-flex items-center justify-center rounded-lg bg-brand text-on-brand px-4 py-2 text-sm font-medium hover:bg-brand-dark transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand';
const secondaryBtn = 'inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';

/** Shrink an image so its long side is at most 512px, and encode it small enough to upload. */
async function resizeLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be opened as an image.'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_LOGO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not resize the image.');
    ctx.drawImage(img, 0, 0, w, h);
    const encode = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    // PNG keeps transparency; a photo-like JPEG stays JPEG. WebP is the smaller fallback.
    const first = file.type === 'image/jpeg' ? await encode('image/jpeg', 0.9) : await encode('image/png');
    if (first && first.size <= MAX_LOGO_BYTES) return first;
    const webp = await encode('image/webp', 0.9);
    if (webp && webp.type === 'image/webp' && webp.size <= MAX_LOGO_BYTES) return webp;
    throw new Error('That logo is still over 300 KB after resizing. Try a simpler image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ColorField({ label, help, value, fallback, onChange }: {
  label: string; help: string; value: string | null; fallback: string; onChange: (v: string | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  useEffect(() => { setText(value ?? ''); }, [value]);
  const shown = value ?? fallback;
  const bad = text !== '' && !isHexColor(text);
  return (
    <div>
      <label htmlFor={`${id}-hex`} className="block text-sm font-medium text-gray-900">{label}</label>
      <p id={`${id}-help`} className="text-xs text-gray-500 mb-2">{help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={shown.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
        />
        <input
          id={`${id}-hex`}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={fallback}
          value={text}
          aria-describedby={`${id}-help${bad ? ` ${id}-err` : ''}`}
          aria-invalid={bad || undefined}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (v === '') onChange(null);
            else if (isHexColor(v)) onChange(v.toUpperCase());
          }}
          className={`w-28 rounded-lg border px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 ${bad ? 'border-red-400' : 'border-gray-300'}`}
        />
        {value ? (
          <button type="button" className="text-sm text-gray-600 underline hover:text-gray-900" onClick={() => onChange(null)}>
            Use {PRODUCT_NAME}&apos;s color
          </button>
        ) : (
          <span className="text-xs text-gray-500">Using {PRODUCT_NAME}&apos;s color</span>
        )}
      </div>
      {bad && <p id={`${id}-err`} className="mt-1 text-xs text-red-600">Enter a color like #1F3A5F.</p>}
    </div>
  );
}

/** The top bar and a button in the chosen colors, before anything is saved. */
function Preview({ primary, accent, logoUrl, name }: { primary: string; accent: string; logoUrl: string | null; name: string }) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden" aria-label="Preview of your colors">
      <div className="h-1.5" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ background: primary }}>
        <div className="flex items-center gap-2 min-w-0">
          {logoUrl ? (
            <span className="bg-white rounded-md px-1.5 py-0.5 flex items-center flex-shrink-0">
              <img src={logoUrl} alt="" className="h-5 w-auto max-w-[6rem] object-contain" />
            </span>
          ) : (
            <span className="h-6 w-6 rounded-md bg-white/20 flex-shrink-0" aria-hidden />
          )}
          {/* Like the real top bar: a logo already says the name. */}
          {!logoUrl && <span className="text-sm font-semibold text-white truncate">{name}</span>}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="rounded-md bg-white px-2 py-1 font-medium" style={{ color: primary }}>Home</span>
          <span className="hidden sm:inline px-2 py-1 text-white/80">Leads</span>
          <span className="hidden sm:inline px-2 py-1 text-white/80">Schedule</span>
        </div>
      </div>
      <div className="bg-canvas px-3 py-3 flex flex-wrap items-center gap-3">
        <span className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: primary }}>Save</span>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>Accent label</span>
      </div>
    </div>
  );
}

function BrandSection({ data, onSaved }: { data: Customization; onSaved: (c: Customization) => void }) {
  const company = useCompany();
  const { refresh } = useAuth();
  const [primary, setPrimary] = useState<string | null>(data.primaryColor);
  const [accent, setAccent] = useState<string | null>(data.accentColor);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();

  useEffect(() => { setPrimary(data.primaryColor); setAccent(data.accentColor); }, [data.primaryColor, data.accentColor]);

  const readable = primary ? readableWithWhite(primary) : null;
  const readableAccent = accent ? readableWithWhite(accent, MIN_ACCENT_CONTRAST) : null;
  const previewPrimary = readable ? readable.color : DEFAULT_PRIMARY;
  const previewAccent = readableAccent ? readableAccent.color : DEFAULT_ACCENT;
  const dirty = primary !== data.primaryColor || accent !== data.accentColor;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null); setNote(null);
    try {
      type Adj = { from: string; to: string };
      const r = await api.put<Customization & { adjusted: { primaryColor?: Adj; accentColor?: Adj } | null }>('/api/company/settings', { primaryColor: primary, accentColor: accent });
      onSaved(r);
      const changed = [
        r.adjusted?.primaryColor && `main color from ${r.adjusted.primaryColor.from} to ${r.adjusted.primaryColor.to}`,
        r.adjusted?.accentColor && `accent color from ${r.adjusted.accentColor.from} to ${r.adjusted.accentColor.to}`,
      ].filter(Boolean);
      setNote(changed.length ? `Saved. We darkened your ${changed.join(' and your ')} so text stays readable.` : 'Colors saved.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the colors.');
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setLogoError(null); setLogoNote(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError('The logo must be a PNG, JPEG or WebP image.');
      return;
    }
    setLogoBusy(true);
    try {
      const blob = await resizeLogo(file);
      const r = await fetch('/api/company/logo', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': blob.type }, body: blob });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not upload the logo.');
      onSaved(body as Customization);
      setLogoNote('Logo saved.');
      await refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Could not upload the logo.');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true); setLogoError(null); setLogoNote(null);
    try {
      onSaved(await api.delete<Customization>('/api/company/logo'));
      setLogoNote('Logo removed.');
      await refresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <section aria-labelledby="brand-title" className={`${card} p-4 sm:p-6 space-y-6`}>
      <div>
        <h2 id="brand-title" className="text-lg font-semibold text-gray-900">Brand</h2>
        <p className="text-sm text-gray-500">Your logo and colors in the top bar, on buttons, and on reports and letters.</p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-900">Logo</h3>
        <p id={`${fileId}-help`} className="text-xs text-gray-500 mb-3">PNG, JPEG or WebP. It is resized to 512 pixels on the long side, and must be 300 KB or less after that.</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-16 min-w-[6rem] max-w-[14rem] rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center px-3">
            {data.logoUrl
              ? <img src={data.logoUrl} alt={`${company.displayName} logo`} className="max-h-12 w-auto max-w-full object-contain" />
              : <span className="text-xs text-gray-500">No logo yet</span>}
          </div>
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby={`${fileId}-help`}
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <button type="button" className={secondaryBtn} disabled={logoBusy} onClick={() => fileRef.current?.click()}>
            {logoBusy ? 'Working…' : data.logoUrl ? 'Upload a new logo' : 'Upload logo'}
          </button>
          {data.logoUrl && (
            <button type="button" className={`${secondaryBtn} text-red-700`} disabled={logoBusy} onClick={removeLogo}>Remove</button>
          )}
        </div>
        {logoError && <p role="alert" className="mt-2 text-sm text-red-700">{logoError}</p>}
        {logoNote && <p role="status" className="mt-2 text-sm text-green-700">{logoNote}</p>}
      </div>

      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <ColorField
            label="Main color"
            help="The top bar and main buttons. White text goes on it."
            value={primary}
            fallback={DEFAULT_PRIMARY}
            onChange={setPrimary}
          />
          <ColorField
            label="Accent color"
            help="Thin strips and small labels."
            value={accent}
            fallback={DEFAULT_ACCENT}
            onChange={setAccent}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900 mb-2">Preview</p>
          <Preview primary={previewPrimary} accent={previewAccent} logoUrl={data.logoUrl} name={company.displayName} />
          {readable?.adjusted && (
            <p className="mt-2 text-sm text-amber-800">White text is hard to read on {primary}, so it will be saved a little darker, as {readable.color}.</p>
          )}
          {readableAccent?.adjusted && (
            <p className="mt-2 text-sm text-amber-800">Small text in {accent} is hard to read on white, so it will be saved a little darker, as {readableAccent.color}.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryBtn} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save colors'}</button>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {note && <p role="status" className="text-sm text-green-700">{note}</p>}
        </div>
      </form>
    </section>
  );
}

function MenuSection({ data, onSaved }: { data: Customization; onSaved: (c: Customization) => void }) {
  const { refresh } = useAuth();
  const toSets = (m: MenuHidden) => Object.fromEntries(ALL_ROLES.map((r) => [r, new Set<MenuPage>(m[r] ?? [])])) as Record<TeamRole, Set<MenuPage>>;
  const [hidden, setHidden] = useState(() => toSets(data.menuHidden));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useMemo(() => JSON.stringify(data.menuHidden), [data.menuHidden]);
  useEffect(() => { setHidden(toSets(JSON.parse(saved))); }, [saved]);

  const current: MenuHidden = useMemo(() => {
    const out: MenuHidden = {};
    for (const r of ALL_ROLES) {
      const pages = MENU_ITEMS.map((m) => m.page).filter((p) => hidden[r].has(p) && menuCell(r, p) === 'switch');
      if (pages.length) out[r] = pages;
    }
    return out;
  }, [hidden]);
  const dirty = JSON.stringify(current) !== saved;

  const toggle = (role: TeamRole, page: MenuPage) => {
    setNote(null);
    setHidden((h) => {
      const next = { ...h, [role]: new Set(h[role]) };
      if (next[role].has(page)) next[role].delete(page);
      else next[role].add(page);
      return next;
    });
  };

  const [level, setLevel] = useState<TeamRole>('sales');
  const levelId = useId();

  /** One cell: a lock for items the level never sees, a locked "On", or a switch. */
  const renderCell = (r: TeamRole, page: MenuPage, label: string) => {
    const cell = menuCell(r, page);
    const name = `${label} for ${ROLE_LABEL[r]}`;
    if (cell === 'never') {
      return (
        <span className="inline-flex items-center text-xs text-gray-400" title={`${ROLE_LABEL[r]} never sees ${label}`}>
          <span aria-hidden>🔒</span><span className="sr-only">{name}: not available to this level</span>
        </span>
      );
    }
    if (cell === 'locked_on') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600" title="Always shown">
          <span aria-hidden>🔒</span>On<span className="sr-only">: {name} is always shown</span>
        </span>
      );
    }
    const on = !hidden[r].has(page);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        onClick={() => toggle(r, page)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${on ? 'bg-brand' : 'bg-gray-300'}`}
      >
        <span aria-hidden className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    );
  };

  async function save() {
    setSaving(true); setError(null); setNote(null);
    try {
      onSaved(await api.put<Customization>('/api/company/settings', { menuHidden: current }));
      setNote('Menu saved. Each person sees the change the next time they open or reload the app.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the menu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="menu-title" className={`${card} p-4 sm:p-6 space-y-4`}>
      <div>
        <h2 id="menu-title" className="text-lg font-semibold text-gray-900">Menu</h2>
        <p className="text-sm text-gray-500">
          Choose which menu items each user level sees. You can only hide items, never add ones a level is not allowed to open.
          A lock means the item cannot be changed for that level.
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Hiding an item tidies the menu for that level. What each level is allowed to open is set by {PRODUCT_NAME} and does not change here.
        </p>
      </div>
      {/* Phones: one level at a time. Six columns of switches do not fit at 390px. */}
      <div className="sm:hidden space-y-3">
        <div>
          <label htmlFor={levelId} className="block text-sm font-medium text-gray-900 mb-1">User level</label>
          <select
            id={levelId}
            value={level}
            onChange={(e) => setLevel(e.target.value as TeamRole)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <ul className="divide-y divide-gray-100 border-y border-gray-200 -mx-4">
          {MENU_ITEMS.filter((m) => menuCell(level, m.page) !== 'never').map((m) => (
            <li key={m.page} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-sm text-gray-900"><span aria-hidden className="mr-1.5">{m.icon}</span>{m.label}</span>
              {renderCell(level, m.page, m.label)}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Items this level can never open are not listed.</p>
      </div>
      <div className="hidden sm:block relative overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Menu items shown to each user level</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium text-gray-700">Menu item</th>
              {ALL_ROLES.map((r) => (
                <th key={r} scope="col" className="px-2 py-2 text-center font-medium text-gray-700 whitespace-nowrap">{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {MENU_ITEMS.filter((m) => ALL_ROLES.some((r) => menuCell(r, m.page) !== 'never')).map((m) => (
              <tr key={m.page}>
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-normal text-gray-900 whitespace-nowrap">
                  <span aria-hidden className="mr-1.5">{m.icon}</span>{m.label}
                </th>
                {ALL_ROLES.map((r) => <td key={r} className="px-2 py-2 text-center">{renderCell(r, m.page, m.label)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryBtn} disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save menu'}</button>
        {dirty && !saving && <span className="text-sm text-gray-500">Unsaved changes</span>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {note && <p role="status" className="text-sm text-green-700">{note}</p>}
      </div>
    </section>
  );
}

export default function CompanyPage() {
  const [data, setData] = useState<Customization | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Customization>('/api/company/settings')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the company settings.'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Company</h1>
        <p className="text-sm text-gray-500">Make {PRODUCT_NAME} look like your company, and choose what your team sees.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {data && (
        <>
          <BrandSection data={data} onSaved={setData} />
          <MenuSection data={data} onSaved={setData} />
        </>
      )}
    </div>
  );
}
