import React, { useEffect, useState, useRef, useCallback } from 'react';
import { APP_CONSTANTS } from '../../helpers/constants';
import FindingsTimeline from './FindingsTimeline';

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  id: string;
  onClose: () => void;
  onViewChange: (view: 'axial' | 'sagittal' | 'coronal' | '3d') => void;
  onOrganHighlight?: (organName: string, centroidMm?: [number, number, number]) => void;
  onClearHighlight?: () => void;
  onHideOrgans?: (organNames: string[]) => void;
};

interface OrganData {
  volume: number;
  mean_hu: number;
  status?: 'normal' | 'check';
  centroid_mm?: [number, number, number];
  dimensions?: [number, number, number];
}

interface ReportData {
  case_id: string;
  patient: { age: number; sex: string };
  imaging: { study_type: string; contrast: string; spacing: number[]; shape: number[] };
  organ_volumes: { [k: string]: OrganData };
  lesions: { [k: string]: { voxels: number; volume: number } };
  comments: string;
  impression: string[];
}

type Lang = 'patient' | 'clinical';
type Step = number;

const cache: { [k: string]: ReportData } = {};

// ─── Styles ───────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes spin { from{transform:rotate(0)}to{transform:rotate(360deg)} }
@keyframes slideR { from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)} }
@keyframes slideL { from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:translateX(0)} }
@keyframes riseIn { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }

.rs-scroll::-webkit-scrollbar { width: 6px; }
.rs-scroll::-webkit-scrollbar-track { background: transparent; }
.rs-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 999px; }

.rs-primary:hover { transform: translateY(-1px); background: rgba(255,255,255,0.16)!important; border-color: rgba(255,255,255,0.24)!important; }
.rs-primary-amber:hover { transform: translateY(-1px); background: rgba(251,191,36,0.18)!important; border-color: rgba(251,191,36,0.34)!important; }
.rs-secondary:hover { background: rgba(255,255,255,0.08)!important; color: rgba(255,255,255,0.9)!important; border-color: rgba(255,255,255,0.18)!important; }
.rs-exit:hover { background: rgba(239,68,68,0.10)!important; border-color: rgba(239,68,68,0.36)!important; color: rgba(248,113,113,0.95)!important; }
.rs-toggle:hover { background: rgba(255,255,255,0.08)!important; }
.rs-link:hover { color: rgba(255,255,255,0.9)!important; }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelize(organ: string): string {
  return organ
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getDetail(organ: string, comments: string): string | null {
  if (!comments) return null;
  const sentences = comments.split(/(?<=[.!?])\s+/).filter(s => s.trim());
  const root = organ.replace(/_(gland|body|tail|head|left|right)$/, '').replace(/_/g, ' ').split(' ')[0];
  const match = sentences.find(s => s.toLowerCase().includes(root.toLowerCase()));
  if (!match) return null;
  let d = match.trim().replace(/^(however|notably|additionally|furthermore|moreover|in addition),?\s+/i, '');
  if (d.length) d = d[0].toUpperCase() + d.slice(1);
  if (d.length > 210) d = d.slice(0, d.lastIndexOf(' ', 207)).trim() + '...';
  return d.endsWith('.') || d.endsWith('...') ? d : d + '.';
}


function organRoot(organ: string): string {
  if (organ.startsWith('pancreas')) return 'pancreas';
  if (organ.startsWith('kidney')) return 'kidney';
  return organ
    .replace(/_(gland|body|tail|head|left|right)$/, '')
    .replace(/_/g, ' ')
    .split(' ')[0]
    .toLowerCase();
}

function getReportSection(organ: string, comments: string): string | null {
  if (!comments) return null;
  const root = organRoot(organ);
  const lines = comments.split(/\r?\n/);
  const start = lines.findIndex(line => {
    const cleaned = line.trim().replace(/:$/, '').toLowerCase();
    return cleaned === root || cleaned === `${root}s` || cleaned.startsWith(`${root}:`);
  });
  if (start === -1) return getDetail(organ, comments);

  const collected: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (i > start && /^[A-Za-z][A-Za-z\s_/-]*:\s*$/.test(trimmed)) break;
    if (i > start && /^IMPRESSION:\s*$/i.test(trimmed)) break;
    if (trimmed) collected.push(trimmed);
  }
  return collected.join(' ').replace(/\s+/g, ' ').trim() || null;
}

type ReportMeasurements = {
  section: string | null;
  volumeCc: number | null;
  meanHu: number | null;
  huSd: number | null;
  sizeCm: string | null;
};

function getReportMeasurements(organ: string, comments: string): ReportMeasurements {
  const section = getReportSection(organ, comments);
  const volumeMatch = section?.match(/volume:\s*([\d.]+)\s*cc/i);
  const huMatch = section?.match(/Mean HU value:\s*([\d.]+)(?:\s*\+\/\-\s*([\d.]+))?/i);
  const sizeMatch = section?.match(/Size:\s*([^().]+?)\s*cm/i);

  return {
    section,
    volumeCc: volumeMatch ? Number(volumeMatch[1]) : null,
    meanHu: huMatch ? Number(huMatch[1]) : null,
    huSd: huMatch?.[2] ? Number(huMatch[2]) : null,
    sizeCm: sizeMatch ? sizeMatch[1].trim() : null,
  };
}

function getImpressionText(data: ReportData | null): string {
  if (!data?.impression?.length) return '';
  return data.impression
    .map(t => t.replace(/^\d+\.\s*/, '').replace(/^\[([^\]]+)\]:\s*/, '$1: '))
    .join(' ');
}

function patientFindingText(organ: string, detail: string | null): string {
  const name = labelize(organ).toLowerCase();
  const d = (detail || '').toLowerCase();

  if (d.includes('enlarged')) return `The report says the ${name} appears enlarged.`;
  if (d.includes('mass') || d.includes('lesion') || d.includes('tumor')) return `The report found a finding near the ${name}.`;
  if (d.includes('widened') || d.includes('dilated')) return `The report says the ${name} appears widened.`;
  if (d.includes('normal size')) return `The report mentions the ${name}.`;
  return `The report found something in the ${name} that should be reviewed.`;
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

const glass: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.052), rgba(255,255,255,0.024))',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 28,
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
  boxShadow: '0 30px 90px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.07)',
};

function PrimaryButton({ children, onClick, amber = false }: { children: React.ReactNode; onClick: () => void; amber?: boolean }) {
  return (
    <button
      className={amber ? 'rs-primary-amber' : 'rs-primary'}
      onClick={onClick}
      style={{
        padding: '13px 22px',
        borderRadius: 999,
        border: amber ? '1px solid rgba(251,191,36,0.30)' : '1px solid rgba(255,255,255,0.16)',
        background: amber ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.11)',
        color: amber ? '#fbbf24' : 'rgba(255,255,255,0.94)',
        fontSize: 15,
        fontWeight: 750,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.22s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="rs-secondary"
      onClick={onClick}
      style={{
        padding: '12px 18px',
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'transparent',
        color: 'rgba(255,255,255,0.62)',
        fontSize: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}

function StatPill({ tone, title, value, sub }: { tone: 'green' | 'amber'; title: string; value: string; sub: string }) {
  const color = tone === 'green' ? '#6ee7b7' : '#fbbf24';
  const bg = tone === 'green' ? 'rgba(110,231,183,0.08)' : 'rgba(251,191,36,0.08)';
  const border = tone === 'green' ? 'rgba(110,231,183,0.20)' : 'rgba(251,191,36,0.22)';
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '15px 16px', borderRadius: 20, background: bg, border: `1px solid ${border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: bg, color, fontWeight: 850, fontSize: 13 }}>
          {tone === 'green' ? '✓' : '!'}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: 720 }}>{title}</span>
      </div>
      <div style={{ color, fontSize: 28, lineHeight: 1, fontWeight: 820, letterSpacing: '-0.04em' }}>{value}</div>
      <div style={{ color: 'rgba(255,255,255,0.54)', fontSize: 14, marginTop: 8 }}>{sub}</div>
    </div>
  );
}

function OrganList({ organs, max = 5 }: { organs: [string, OrganData][]; max?: number }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? organs : organs.slice(0, max);
  return (
    <>
      <div className="rs-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: showAll ? 220 : 'none', overflowY: showAll ? 'auto' : 'visible', paddingRight: showAll ? 6 : 0 }}>
        {visible.map(([organ], i) => (
          <div key={organ} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 16, background: 'rgba(110,231,183,0.075)', border: '1px solid rgba(110,231,183,0.17)', animation: `riseIn 0.25s ease ${i * 26}ms both` }}>
            <span style={{ width: 21, height: 21, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(110,231,183,0.14)', color: '#6ee7b7', fontSize: 12, fontWeight: 850, flexShrink: 0 }}>✓</span>
            <span style={{ color: 'rgba(255,255,255,0.84)', fontSize: 15, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelize(organ)}</span>
          </div>
        ))}
      </div>
      {organs.length > max && (
        <button
          className="rs-link"
          onClick={() => setShowAll(v => !v)}
          style={{ marginTop: 12, background: 'transparent', border: 'none', padding: 0, color: 'rgba(110,231,183,0.78)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {showAll ? 'Show less' : `Show all ${organs.length} healthy organs`}
        </button>
      )}
    </>
  );
}

function MetricRow({ label, value, sub, tone = 'white' }: { label: string; value: string; sub?: string; tone?: 'white' | 'green' | 'amber' }) {
  const color = tone === 'green' ? '#6ee7b7' : tone === 'amber' ? '#fbbf24' : 'rgba(255,255,255,0.92)';
  return (
    <div style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,0.075)' }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginBottom: 5, letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 22, lineHeight: 1.08, fontWeight: 780, color, letterSpacing: '-0.03em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 5, lineHeight: 1.42 }}>{sub}</div>}
    </div>
  );
}

function EvidencePanel({
  step,
  lang,
  flagged,
  normal,
  curOrgan,
  curData,
  data,
  anim,
}: {
  step: Step;
  lang: Lang;
  flagged: [string, OrganData][];
  normal: [string, OrganData][];
  curOrgan: string | null;
  curData: OrganData | null;
  data: ReportData;
  anim: string;
}) {
  const firstFinding = flagged[0]?.[0] ?? null;
  const firstDetail = firstFinding ? getDetail(firstFinding, data.comments) : null;
  const impression = getImpressionText(data);
  const report = curOrgan ? getReportMeasurements(curOrgan, data.comments) : null;
  const reportVolume = report?.volumeCc ?? null;
  
  if (step === 1) {
    // On the healthy-organs page, do not show the finding preview.
    // The left panel is the story; the 3D model shifts right to balance the empty space.
    return null;
  }

  if (step === 0) {
    return (
      <div style={{ ...glass, width: 330, padding: 24, animation: `${anim} 0.36s cubic-bezier(0.22,1,0.36,1) both` }}>
        <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: flagged.length ? 'rgba(251,191,36,0.72)' : 'rgba(110,231,183,0.72)', fontWeight: 800, marginBottom: 18 }}>
          {flagged.length ? 'Finding found' : 'No finding found'}
        </div>
        {flagged.length ? (
          <>
            <div style={{ fontSize: 34, lineHeight: 1.08, fontWeight: 830, letterSpacing: '-0.05em', color: '#fbbf24', marginBottom: 14 }}>
              {labelize(firstFinding!)}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.70)', fontSize: 16, lineHeight: 1.55, margin: 0 }}>
              {lang === 'patient'
                ? patientFindingText(firstFinding!, firstDetail)
                : (firstDetail || impression || 'See the report finding for details.')}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: 30, lineHeight: 1.1, fontWeight: 820, letterSpacing: '-0.045em', color: '#6ee7b7', marginBottom: 14 }}>
              No abnormal finding was marked.
            </div>
            <p style={{ color: 'rgba(255,255,255,0.68)', fontSize: 16, lineHeight: 1.55, margin: 0 }}>
              The report did not mark any organ for review.
            </p>
          </>
        )}
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.075)', color: 'rgba(255,255,255,0.46)', fontSize: 13, lineHeight: 1.5 }}>
          {normal.length} healthy organ{normal.length === 1 ? '' : 's'} · {flagged.length} finding{flagged.length === 1 ? '' : 's'}
        </div>
      </div>
    );
  }

  if (step >= 2 && curOrgan && curData) {
    const detail = getDetail(curOrgan, data.comments);
    return (
      <div style={{ ...glass, width: 350, padding: 24, animation: `${anim} 0.36s cubic-bezier(0.22,1,0.36,1) both` }}>
        <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(251,191,36,0.72)', fontWeight: 800, marginBottom: 18 }}>
          Measurements
        </div>

        <MetricRow label="Organ" value={labelize(curOrgan)} tone="amber" />

        {reportVolume !== null ? (
          <MetricRow label="Volume" value={`${reportVolume.toFixed(1).replace(/\.0$/, '')} cc`} tone="amber" sub="From the report text." />
        ) : (
          <MetricRow label="Volume" value="Not listed" sub="No report volume was found for this organ." />
        )}

        {lang === 'clinical' && report?.meanHu !== null && report?.meanHu !== undefined && (
          <MetricRow
            label="Mean HU"
            value={`${Math.round(report.meanHu)}`}
            sub={report.huSd !== null && report.huSd !== undefined ? `Report value: ${report.meanHu} +/- ${report.huSd}` : 'From the report text.'}
          />
        )}

        {lang === 'clinical' && report?.sizeCm && (
          <MetricRow label="Report size" value={`${report.sizeCm} cm`} sub="From the report text." />
        )}

        {lang === 'clinical' && curData.dimensions && !report?.sizeCm && (
          <MetricRow
            label="Segmented dimensions"
            value={`${curData.dimensions[0]} × ${curData.dimensions[1]} × ${curData.dimensions[2]} cm`}
            sub="Computed from the segmented organ mask."
          />
        )}

        {lang === 'clinical' && (
          <div style={{ paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginBottom: 8 }}>Report text</div>
            <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 1.55, margin: 0 }}>
              {report?.section || detail || impression || 'No report detail available.'}
            </p>
          </div>
        )}

        {lang === 'patient' && (
          <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 14, lineHeight: 1.55, margin: '18px 0 0' }}>
            This panel shows the key measurement from the report. Your doctor can explain what it means for you.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...glass, width: 330, padding: 24, animation: `${anim} 0.36s cubic-bezier(0.22,1,0.36,1) both` }}>
      <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.44)', fontWeight: 800, marginBottom: 18 }}>
        Final note
      </div>
      <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 16, lineHeight: 1.6, margin: 0 }}>
        Bring this result to your doctor. They can interpret the finding with your symptoms, history, and any other tests.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportScreen({ id, onClose, onViewChange, onOrganHighlight, onClearHighlight, onHideOrgans }: Props) {
  void onViewChange;
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>(0);
  const [dir, setDir] = useState<'r' | 'l'>('r');
  const [lang, setLang] = useState<Lang>('patient');
  const [modePromptOpen, setModePromptOpen] = useState(false);
  const [plain2, setPlain2] = useState<string[]>([]);
  const [pLoad, setPLoad] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (cache[id]) { setData(cache[id]); setLoading(false); return; }
    fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-report-data/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { setLoading(false); return; }
        cache[id] = j;
        setData(j);
        setLoading(false);
        startRef.current = Date.now();
      })
      .catch(() => setLoading(false));
  }, [id]);

  const fetchPlain = useCallback(async () => {
    if (plain2.length || !data) return;
    setPLoad(true);
    try {
      const r = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/explain-impressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impression: data.impression }),
      });
      const j = await r.json();
      setPlain2(j.plain_language || []);
    } catch {} finally { setPLoad(false); }
  }, [data, plain2]);

  useEffect(() => { if (data) fetchPlain(); }, [data]);

  const go = useCallback((s: Step) => {
    setDir(s > step ? 'r' : 'l');
    setStep(s);
  }, [step]);

  const all = React.useMemo(() => data ? Object.entries(data.organ_volumes).filter(([_, v]) => v.volume > 5) : [], [data]);
  const flagged = React.useMemo(() => all.filter(([_, v]) => v.status === 'check'), [all]);
  const normal = React.useMemo(() => all.filter(([_, v]) => v.status !== 'check'), [all]);
  const totalSteps = 2 + flagged.length + 1;

  const curOrganName = step >= 2 && step < 2 + flagged.length ? flagged[step - 2]?.[0] : null;
  const curOrganData = step >= 2 && step < 2 + flagged.length ? flagged[step - 2]?.[1] : null;
  const anim = dir === 'r' ? 'slideR' : 'slideL';

  useEffect(() => {
    if (!data) return;
    onClearHighlight?.();
    if (step === 1) {
      onHideOrgans?.(flagged.map(([o]) => o));
    } else if (step >= 2 && step < 2 + flagged.length) {
      const highlightName = curOrganName === 'pancreas' ? 'pancreas_body' : curOrganName;
      if (highlightName && curOrganData) onOrganHighlight?.(highlightName, curOrganData.centroid_mm);
    }
  }, [step, data]);

  const leftContent = React.useMemo(() => {
    if (!data) return null;
    const curOrganLocal = step >= 2 && step < 2 + flagged.length ? flagged[step - 2]?.[0] : null;
    const curDataLocal = step >= 2 && step < 2 + flagged.length ? flagged[step - 2]?.[1] : null;
    const medLocal = curOrganLocal ? getDetail(curOrganLocal, data.comments) : null;
    const patientLocal = curOrganLocal ? patientFindingText(curOrganLocal, medLocal) : '';
    const impressionText = getImpressionText(data);

    if (step === 0) return (
      <div style={{ animation: `${anim} 0.38s cubic-bezier(0.22,1,0.36,1) both` }}>
        <div style={{ fontSize: 12, letterSpacing: '0.13em', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', marginBottom: 18, fontWeight: 800 }}>CT Scan Review</div>
        <h1 style={{ fontSize: 46, lineHeight: 1.02, letterSpacing: '-0.065em', color: '#fff', margin: '0 0 18px', fontWeight: 850 }}>
          Your scan looks mostly healthy.
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.68)', lineHeight: 1.55, margin: '0 0 26px' }}>
          We found {normal.length} healthy organ{normal.length === 1 ? '' : 's'} and {flagged.length} finding{flagged.length === 1 ? '' : 's'} to explain.
        </p>
        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          <StatPill tone="green" title="Healthy" value={`${normal.length}`} sub={`organ${normal.length === 1 ? '' : 's'}`} />
          <StatPill tone="amber" title="Finding" value={`${flagged.length}`} sub={flagged.length === 1 ? 'to explain' : 'to explain'} />
        </div>
        <PrimaryButton onClick={() => { setModePromptOpen(true); go(1); }}>Start review →</PrimaryButton>
      </div>
    );

    if (step === 1) return (
      <div style={{ animation: `${anim} 0.38s cubic-bezier(0.22,1,0.36,1) both` }}>
        <div style={{ fontSize: 12, letterSpacing: '0.13em', color: 'rgba(110,231,183,0.72)', textTransform: 'uppercase', marginBottom: 16, fontWeight: 800 }}>Healthy organs</div>
        <h1 style={{ fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.06em', color: '#6ee7b7', margin: '0 0 14px', fontWeight: 850 }}>
          {normal.length} organs look healthy.
        </h1>
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.66)', lineHeight: 1.5, margin: '0 0 20px' }}>
          These organs looked healthy on this scan.
        </p>
        <OrganList organs={normal} />
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <SecondaryButton onClick={() => go(0)}>← Back</SecondaryButton>
          <PrimaryButton amber={flagged.length > 0} onClick={() => go(flagged.length > 0 ? 2 : totalSteps - 1)}>
            {flagged.length > 0 ? 'Explain finding →' : 'Next →'}
          </PrimaryButton>
        </div>
      </div>
    );

    if (step >= 2 && step < 2 + flagged.length && curOrganLocal && curDataLocal) return (
      <div style={{ animation: `${anim} 0.38s cubic-bezier(0.22,1,0.36,1) both` }}>
        <div style={{ fontSize: 12, letterSpacing: '0.13em', color: 'rgba(251,191,36,0.74)', textTransform: 'uppercase', marginBottom: 16, fontWeight: 800 }}>
          Finding {step - 1} of {flagged.length}
        </div>
        <h1 style={{ fontSize: 44, lineHeight: 1.02, letterSpacing: '-0.065em', color: '#fbbf24', margin: '0 0 16px', fontWeight: 860 }}>
          {labelize(curOrganLocal)}
        </h1>
        <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.78)', lineHeight: 1.56, margin: '0 0 18px' }}>
          {lang === 'patient' ? patientLocal : (medLocal || impressionText || 'This finding is listed in the report.')}
        </p>
        {lang === 'patient' && (
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.50)', lineHeight: 1.55, margin: '0 0 22px' }}>
            Your doctor can explain what this means with your symptoms and medical history.
          </p>
        )}
        {lang === 'clinical' && (
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.48)', lineHeight: 1.55, margin: '0 0 22px' }}>
            Measurements and original report text are shown in the panel on the right.
          </p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <SecondaryButton onClick={() => go(step - 1)}>← Back</SecondaryButton>
          <PrimaryButton onClick={() => go(step + 1)} amber={step < 1 + flagged.length}>
            {step < 1 + flagged.length ? 'Next finding →' : 'Finish →'}
          </PrimaryButton>
        </div>
      </div>
    );

    const allClear = flagged.length === 0;
    return (
      <div style={{ animation: `${anim} 0.42s cubic-bezier(0.22,1,0.36,1) both`, textAlign: 'center' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.14em', color: allClear ? 'rgba(110,231,183,0.72)' : 'rgba(255,255,255,0.44)', textTransform: 'uppercase', marginBottom: 18, fontWeight: 800 }}>Final impressions</div>
        <h1 style={{ fontSize: 46, lineHeight: 1.02, letterSpacing: '-0.065em', color: allClear ? '#6ee7b7' : '#fff', margin: '0 0 20px', fontWeight: 860 }}>
          {allClear ? 'All clear.' : (data.impression?.length === 1 ? 'Final Impressions:' : 'Final findings.')}
        </h1>
        {data.impression?.length > 0 && (
          <div style={{ padding: '20px 22px', borderRadius: 22, background: allClear ? 'rgba(110,231,183,0.075)' : 'rgba(251,191,36,0.075)', border: `1px solid ${allClear ? 'rgba(110,231,183,0.18)' : 'rgba(251,191,36,0.18)'}`, margin: '0 0 22px', textAlign: 'left' }}>
            <div style={{ fontSize: 12, color: allClear ? 'rgba(110,231,183,0.72)' : 'rgba(251,191,36,0.72)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 780 }}>Report impression</div>
            <p style={{ fontSize: 21, color: 'rgba(255,255,255,0.90)', lineHeight: 1.45, margin: 0, fontWeight: 650 }}>
              {getImpressionText(data)}
            </p>
          </div>
        )}
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, margin: '0 auto 26px', maxWidth: 430 }}>
          Final note: discuss this report with your doctor so they can interpret it with your symptoms, history, and other tests.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <SecondaryButton onClick={() => go(step - 1)}>← Back</SecondaryButton>
          <PrimaryButton onClick={() => go(0)}>Start over</PrimaryButton>
        </div>
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, lang, data, plain2, pLoad]);

  if (!loading && !data) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: 'none' }}>
      <style>{STYLES}</style>
      <style>{step === 0
        ? `.render { filter: blur(12px) brightness(0.40) !important; transform: scale(0.96) !important; transition: filter 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1) !important; }`
        : step === 1
          ? `.render { filter: none !important; transform: translateX(180px) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`
          : step === totalSteps - 1
            ? `.render { filter: blur(1.5px) brightness(0.55) !important; transform: scale(1.02) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`
            : `.render { filter: none !important; transform: translateX(0) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`}</style>
      <div style={{ position: 'fixed', inset: 0, zIndex: 10001, pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>Report unavailable.</p>
        <button onClick={onClose} style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '7px 20px', cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: 'none' }}>
      <style>{STYLES}</style>
      <style>{step === 0
        ? `.render { filter: blur(12px) brightness(0.40) !important; transform: scale(0.96) !important; transition: filter 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1) !important; }`
        : step === 1
          ? `.render { filter: none !important; transform: translateX(180px) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`
          : step === totalSteps - 1
            ? `.render { filter: blur(1.5px) brightness(0.55) !important; transform: scale(1.02) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`
            : `.render { filter: none !important; transform: translateX(0) !important; transition: filter 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1) !important; }`}</style>

      {loading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10001, pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <div style={{ position: 'relative', width: 48, height: 48 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.06)' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid transparent', borderTop: '1.5px solid rgba(255,255,255,0.55)', animation: 'spin 1s linear infinite' }} />
              <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', border: '1px solid transparent', borderTop: '1px solid rgba(255,255,255,0.2)', animation: 'spin 1.6s linear infinite reverse' }} />
            </div>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>Preparing your report…</span>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* soft stage lighting behind the scan */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none', background: 'radial-gradient(circle at 52% 50%, rgba(255,255,255,0.055), transparent 34%)' }} />

          {/* Top bar */}
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 76, zIndex: modePromptOpen ? 10006 : 10001, pointerEvents: 'auto', background: 'rgba(6,8,12,0.88)', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderBottom: '0.5px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', padding: '0 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 270 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.36)', letterSpacing: '0.12em', fontWeight: 760 }}>BODYMAPS</span>
              <span style={{ color: 'rgba(255,255,255,0.16)', fontSize: 11 }}>·</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.52)' }}>Case {id} · {data.patient.sex} · {data.patient.age}y</span>
            </div>

            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
              <span style={{ fontSize: 15, color: 'rgba(255,255,255,0.92)', letterSpacing: '0.025em', fontWeight: 720 }}>
                {step === 0 ? 'Your CT Scan' : 'Understanding Your CT Scan'}
              </span>
              {step > 0 && (
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  {Array.from({ length: totalSteps - 1 }).map((_, i) => {
                    const progressIndex = i + 1;
                    return (
                      <button key={i} onClick={() => go(progressIndex)} style={{ height: 3, width: progressIndex === step ? 30 : 9, border: 'none', cursor: 'pointer', padding: 0, borderRadius: 999, transition: 'all 0.35s cubic-bezier(0.22,1,0.36,1)', background: progressIndex === step ? '#fbbf24' : progressIndex < step ? 'rgba(251,191,36,0.42)' : 'rgba(255,255,255,0.18)' }} />
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              {step > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: 3, borderRadius: 999, background: modePromptOpen ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.055)', border: modePromptOpen ? '1px solid rgba(255,255,255,0.32)' : '1px solid rgba(255,255,255,0.10)', boxShadow: modePromptOpen ? '0 0 0 6px rgba(255,255,255,0.06), 0 18px 60px rgba(0,0,0,0.42)' : 'none', transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)' }}>
                  <button className="rs-toggle" onClick={() => { setLang('patient'); setModePromptOpen(false); }} style={{ padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 720, color: lang === 'patient' ? '#08090b' : 'rgba(255,255,255,0.58)', background: lang === 'patient' ? 'rgba(255,255,255,0.86)' : 'transparent', transition: 'all 0.2s' }}>Patient</button>
                  <button className="rs-toggle" onClick={() => { setLang('clinical'); setModePromptOpen(false); }} style={{ padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 720, color: lang === 'clinical' ? '#08090b' : 'rgba(255,255,255,0.58)', background: lang === 'clinical' ? 'rgba(255,255,255,0.86)' : 'transparent', transition: 'all 0.2s' }}>Doctor</button>
                </div>
              )}
              <button className="rs-exit" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid rgba(239,68,68,0.24)', borderRadius: 12, padding: '9px 13px', cursor: 'pointer', fontFamily: 'inherit', color: 'rgba(239,68,68,0.78)', transition: 'all 0.2s' }}>
                <span style={{ fontSize: 14, lineHeight: 1, fontWeight: 300 }}>✕</span>
                <span style={{ fontSize: 11, letterSpacing: '0.04em' }}>Exit</span>
              </button>
            </div>
          </div>

          {/* Intro: cinematic centered card */}
          {step === 0 && (
            <div style={{
              position: 'fixed',
              inset: '76px 0 0',
              zIndex: 10001,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
            }}>
              <div style={{
                ...glass,
                pointerEvents: 'auto',
                width: 560,
                maxWidth: 'calc(100vw - 48px)',
                padding: '38px 42px',
                textAlign: 'center',
                animation: `${anim} 0.42s cubic-bezier(0.22,1,0.36,1) both`,
              }}>
                <div style={{ fontSize: 12, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', marginBottom: 18, fontWeight: 800 }}>CT Scan Review</div>
                <h1 style={{ fontSize: 48, lineHeight: 1.02, letterSpacing: '-0.065em', color: '#fff', margin: '0 0 18px', fontWeight: 860 }}>
                  {flagged.length > 0 ? 'Your scan looks mostly healthy.' : 'Your scan looks healthy.'}
                </h1>
                <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.70)', lineHeight: 1.55, margin: '0 auto 26px', maxWidth: 430 }}>
                  {flagged.length > 0
                    ? `${normal.length} organ${normal.length === 1 ? '' : 's'} look healthy. ${flagged.length} finding${flagged.length === 1 ? '' : 's'} will be explained.`
                    : `All ${normal.length} organ${normal.length === 1 ? '' : 's'} look healthy. No findings to review.`}
                </p>
                <button
                  className="rs-primary"
                  onClick={() => { setModePromptOpen(true); go(1); }}
                  style={{
                    padding: '14px 26px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(255,255,255,0.11)',
                    color: 'rgba(255,255,255,0.94)',
                    fontSize: 15,
                    fontWeight: 760,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 0.22s cubic-bezier(0.22,1,0.36,1)',
                  }}
                >
                  Start walkthrough →
                </button>
              </div>
            </div>
          )}


          {/* Coachmark: after Start walkthrough, point users to the existing Patient / Doctor toggle */}
          {modePromptOpen && step > 0 && (
            <>
              <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10004,
                pointerEvents: 'none',
                background: 'rgba(0,0,0,0.48)',
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                animation: 'riseIn 0.24s ease both',
              }} />

              <div style={{
                position: 'fixed',
                right: 112,
                top: 94,
                zIndex: 10007,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                animation: 'riseIn 0.26s ease both',
              }}>
                <div style={{
                  width: 92,
                  height: 54,
                  borderTop: '2px solid rgba(255,255,255,0.78)',
                  borderRight: '2px solid rgba(255,255,255,0.78)',
                  borderTopRightRadius: 28,
                  transform: 'translateY(4px) rotate(-8deg)',
                  position: 'relative',
                }}>
                  <span style={{
                    position: 'absolute',
                    right: -6,
                    top: -7,
                    width: 12,
                    height: 12,
                    borderTop: '2px solid rgba(255,255,255,0.78)',
                    borderRight: '2px solid rgba(255,255,255,0.78)',
                    transform: 'rotate(45deg)',
                  }} />
                </div>

                <div style={{
                  ...glass,
                  width: 330,
                  padding: '22px 24px',
                  boxShadow: '0 26px 90px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}>
                  <div style={{
                    fontSize: 12,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.44)',
                    fontWeight: 820,
                    marginBottom: 10,
                  }}>
                    Choose your view
                  </div>
                  <div style={{
                    fontSize: 27,
                    lineHeight: 1.06,
                    letterSpacing: '-0.045em',
                    color: '#fff',
                    fontWeight: 850,
                    marginBottom: 10,
                  }}>
                    Are you a patient or a doctor?
                  </div>
                  <p style={{
                    fontSize: 15,
                    lineHeight: 1.48,
                    color: 'rgba(255,255,255,0.64)',
                    margin: 0,
                  }}>
                    Select the role that fits you best. You can switch views anytime.
                  </p>
                </div>
              </div>
            </>
          )}


          {/* LEFT story panel */}
          {step > 0 && step < totalSteps - 1 && (
            <div className="rs-scroll" style={{ ...glass, position: 'fixed', left: 64, top: 'calc(50% + 38px)', transform: 'translateY(-50%)', zIndex: 10001, pointerEvents: 'auto', width: 360, maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', padding: 24 }}>
              {leftContent}
            </div>
          )}

          {/* FINAL centered impression panel */}
          {step === totalSteps - 1 && (
            <div style={{
              position: 'fixed',
              inset: '76px 0 0',
              zIndex: 10001,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}>
              <div className="rs-scroll" style={{ ...glass, pointerEvents: 'auto', width: 560, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', padding: 34 }}>
                {leftContent}
              </div>
            </div>
          )}

          {/* RIGHT evidence panel */}
          {step > 1 && step < totalSteps - 1 && (
            <div style={{ position: 'fixed', right: 72, top: 'calc(50% + 38px)', transform: 'translateY(-50%)', zIndex: 10001, pointerEvents: 'auto' }}>
              <EvidencePanel
                step={step}
                lang={lang}
                flagged={flagged}
                normal={normal}
                curOrgan={curOrganName}
                curData={curOrganData}
                data={data}
                anim={anim}
              />
            </div>
          )}

          {step > 0 && step < totalSteps - 1 && (
            <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10001, pointerEvents: 'auto' }}>
              <FindingsTimeline
              organStatuses={flagged.map(([o, v]) => ({ organ: o, status: v.status || 'check' }))}
              comments={data.comments}
              focusedOrgan={curOrganName}
              onNodeTap={organ => {
                const fi = flagged.findIndex(([o]) => o === organ);
                go(fi >= 0 ? 2 + fi : 1);
              }}
            />
            </div>
          )}
        </>
      )}
    </div>
  );
}
