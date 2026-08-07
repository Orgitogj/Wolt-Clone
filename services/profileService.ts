import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

export const profileService = {
  get: async (userId: string): Promise<Profile | undefined> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data ?? undefined;
  },

  update: async (
    userId: string,
    updates: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>
  ): Promise<Profile> => {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};
