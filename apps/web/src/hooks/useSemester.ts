import { useQuery } from '@tanstack/react-query';
import { fetchSemester } from '../api/semester';

export const semesterQueryKey = ['semester'] as const;

/** 当前学期 + 周历 */
export function useSemester() {
  return useQuery({
    queryKey: semesterQueryKey,
    queryFn: fetchSemester,
    staleTime: 60_000,
    retry: 1,
  });
}
