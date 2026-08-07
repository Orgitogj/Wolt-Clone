import useAuthStore from '@/hooks/use-auth-store';
import { profileService } from '@/services/profileService';
import type { Profile } from '@/types/database';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useProfile = () => {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => profileService.get(userId!),
    enabled: !!userId,
  });

  const updateProfile = useMutation({
    mutationFn: (updates: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>) =>
      profileService.update(userId!, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', userId] }),
  });

  return {
    profile: query.data,
    isLoading: query.isLoading,
    updateProfile: updateProfile.mutateAsync,
  };
};
