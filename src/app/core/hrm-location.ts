export const HRM_ROOT = '/hrm';

export type DutyKind = 'attendance' | 'leave' | 'overtime' | 'trip';

export type HrmSection = 'employees' | 'organization' | DutyKind;

export interface HrmView {
  section: HrmSection;
  view: 'list' | 'new' | 'edit' | 'person';
  id: string | null;
}

export function isHrmSection(value: string | null): value is HrmSection {
  return value === 'employees' || value === 'organization' || value === 'attendance' || value === 'leave' || value === 'overtime' || value === 'trip';
}

export function isDutySection(section: HrmSection): section is DutyKind {
  return section === 'attendance' || section === 'leave' || section === 'overtime' || section === 'trip';
}

export function hrmPathParts(): string[] {
  const base = new URL(document.baseURI).pathname.replace(/\/+$/, '');
  const path = location.pathname.startsWith(base) ? location.pathname.slice(base.length) : location.pathname;
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  return parts[0] === HRM_ROOT.replace(/^\/+/, '') ? parts.slice(1) : parts;
}

export function hrmPathSection(): HrmSection | null {
  const name = hrmPathParts()[0] ?? '';
  return isHrmSection(name) ? name : null;
}

export function hrmSectionFromLocation(): HrmSection {
  const fromPath = hrmPathSection();
  if (fromPath) return fromPath;
  const legacy = new URLSearchParams(location.search).get('section');
  if (isHrmSection(legacy)) return legacy;
  return 'employees';
}

export function hrmScreenFromLocation(): HrmView {
  const [head, second, third] = hrmPathParts();
  if (!isHrmSection(head)) return { section: 'employees', view: 'list', id: null };
  if (!second) return { section: head, view: 'list', id: null };
  if (second === 'new') return { section: head, view: 'new', id: null };
  if (third === 'edit') return { section: head, view: 'edit', id: second };
  if (head === 'employees') return { section: head, view: 'person', id: second };
  return { section: head, view: 'list', id: null };
}

export function hrmPageQuery(): number | null {
  const page = Number(new URLSearchParams(location.search).get('page'));
  if (!Number.isInteger(page) || page < 2) return null;
  return page;
}

export function hrmPageOffset(pageSize: number): number {
  const page = hrmPageQuery();
  if (page == null) return 0;
  return (page - 1) * pageSize;
}
