import type { SemesterOverview } from '@freeshift/shared';
import { api } from './client';

export function fetchSemester(): Promise<SemesterOverview> {
  return api.get<SemesterOverview>('/semester');
}
