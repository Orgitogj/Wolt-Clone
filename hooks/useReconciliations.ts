import {
  RECONCILIATION_PAGE_SIZE,
  reconciliationService,
} from '@/services/reconciliationService';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

export const useAdminReconciliations = () => {
  const query = useInfiniteQuery({
    queryKey: ['admin-reconciliations'],
    queryFn: ({ pageParam }) => reconciliationService.list(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });

  const reconciliations = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.reconciliations),
    [query.data]
  );

  return { ...query, reconciliations, pageSize: RECONCILIATION_PAGE_SIZE };
};

export const useRetryReconciliation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reconciliationService.retry(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reconciliations'] }),
  });
};
