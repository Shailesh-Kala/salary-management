export type ImportStatus =
  | 'validating'
  | 'awaiting_confirmation'
  | 'applying'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed';

export type ImportCounts = {
  total: number;
  valid: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  rejected: number;
  created?: number;
  updated?: number;
};

export type ImportSummary = {
  id: string;
  status: ImportStatus;
  fileName: string;
  changeType: string;
  effectiveDate: string;
  rowCount: number;
  counts: ImportCounts | null;
  createdAt: string;
  finishedAt: string | null;
  uploadedBy: { id: string; name: string };
};

export type ImportDetails = ImportSummary & {
  note: string;
  previewExpiresAt: string | null;
  error: string | null;
  rejected: { rowNumber: number; employeeCode: string | null; errors: string[] }[];
};

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  validating: 'Checking rows',
  awaiting_confirmation: 'Waiting for confirmation',
  applying: 'Importing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  failed: 'Failed',
};

/** Change types an import can apply (relocation is decided per row). */
export const IMPORT_CHANGE_TYPES = [
  'annual_review',
  'promotion',
  'market_adjustment',
  'correction',
  'other',
] as const;
