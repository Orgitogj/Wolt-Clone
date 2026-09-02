import { settingsService } from '@/services/settingsService';
import { useQuery } from '@tanstack/react-query';

export const usePlatformSettings = () =>
  useQuery({
    queryKey: ['platform-settings'],
    queryFn: settingsService.get,
    staleTime: 1000 * 60 * 30,
  });
